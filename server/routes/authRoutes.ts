import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db/database';
import { env } from '../config/env';
import {
  AUTH_COOKIE_NAME,
  AuthenticatedRequest,
  AuthTokenPayload,
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signSessionToken,
} from '../middleware/auth';
import { dispatchNotification } from '../services/notificationService';
import { recordAuditLog } from '../services/auditService';
import firebaseConfig from '../../firebase-applet-config.json';

export const authRouter = Router();

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('Valid email address is required').max(160),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100),
  phone: z.string().trim().max(32).optional().default(''),
  dateOfBirth: z.string().trim().max(20).optional().default(''),
  gender: z.string().trim().max(30).optional().default(''),
  bloodGroup: z.string().trim().max(10).optional().default(''),
  allergies: z.string().trim().max(500).optional().default(''),
  emergencyContact: z.string().trim().max(160).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
});

const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

const firebaseLoginSchema = z.object({
  idToken: z.string().min(20, 'Valid Firebase ID token is required'),
});

let cachedFirebaseCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (cachedFirebaseCerts && Date.now() < cachedFirebaseCerts.expiresAt) {
    return cachedFirebaseCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  );
  if (!resp.ok) {
    throw new Error('Failed to fetch Firebase public signing certificates.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cc = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedFirebaseCerts = {
    certs,
    expiresAt: Date.now() + Math.max(60, ttlSeconds) * 1000,
  };
  return certs;
}

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email: string;
  name?: string;
}> {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  const kid =
    decodedHeader && typeof decodedHeader === 'object'
      ? (decodedHeader.header as { kid?: string }).kid
      : undefined;
  if (!kid) {
    throw new Error('Invalid Firebase ID token header.');
  }

  const certs = await getFirebasePublicCerts();
  const cert = certs[kid];
  if (!cert) {
    throw new Error('Unable to match Firebase signing certificate.');
  }

  const projectId = firebaseConfig.projectId;
  const payload = jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  }) as {
    sub?: string;
    email?: string;
    name?: string;
  };

  if (!payload.sub || !payload.email) {
    throw new Error('Firebase token is missing required identity claims.');
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
  };
}

function getFullUserSessionView(userId: string) {
  const user = db
    .prepare(
      'SELECT id, email, role, full_name, phone, is_active, created_at FROM users WHERE id = ?',
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
        full_name: string;
        phone: string | null;
        is_active: number;
        created_at: string;
      }
    | undefined;
  if (!user) return null;

  let patientProfile = null;
  let doctorProfile = null;

  if (user.role === 'PATIENT') {
    patientProfile = db
      .prepare('SELECT * FROM patients WHERE user_id = ?')
      .get(user.id);
  } else if (user.role === 'DOCTOR') {
    doctorProfile = db
      .prepare('SELECT * FROM doctors WHERE user_id = ?')
      .get(user.id);
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
    phone: user.phone || '',
    isActive: user.is_active === 1,
    createdAt: user.created_at,
    patientProfile,
    doctorProfile,
  };
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const normalizedEmail = input.email.toLowerCase();

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const patientId = `pat_${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const passwordHash = await bcrypt.hash(input.password, 10);

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 'PATIENT', ?, ?, 1, ?, ?)
      `).run(
        userId,
        normalizedEmail,
        passwordHash,
        input.fullName,
        input.phone || null,
        nowIso,
        nowIso,
      );

      db.prepare(`
        INSERT INTO patients (id, user_id, date_of_birth, gender, blood_group, allergies, emergency_contact, address, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        patientId,
        userId,
        input.dateOfBirth || null,
        input.gender || null,
        input.bloodGroup || null,
        input.allergies || null,
        input.emergencyContact || null,
        input.address || null,
        nowIso,
        nowIso,
      );
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    await dispatchNotification({
      userId,
      recipientEmail: normalizedEmail,
      type: 'REGISTRATION_WELCOME',
      subject: 'Welcome to MediCloud — Patient Account Verified',
      message: `Hello ${input.fullName}, your MediCloud patient portal is active. You can now book appointments and manage encrypted medical reports.`,
      sendEmail: true,
    });

    recordAuditLog({
      actorUserId: userId,
      action: 'PATIENT_REGISTERED',
      resourceType: 'User',
      resourceId: userId,
      ipAddress: req.ip,
    });

    const token = signSessionToken({ userId, role: 'PATIENT', email: normalizedEmail });
    setSessionCookie(req, res, token);

    res.status(201).json({
      user: getFullUserSessionView(userId),
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const normalizedEmail = input.email.toLowerCase();

    const userRow = db
      .prepare('SELECT id, email, password_hash, role, is_active FROM users WHERE email = ?')
      .get(normalizedEmail) as
      | {
          id: string;
          email: string;
          password_hash: string;
          role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
          is_active: number;
        }
      | undefined;

    if (!userRow) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (userRow.is_active !== 1) {
      res.status(403).json({
        error: 'This account has been deactivated by an administrator.',
      });
      return;
    }

    const passwordValid = await bcrypt.compare(input.password, userRow.password_hash);
    if (!passwordValid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signSessionToken({
      userId: userRow.id,
      role: userRow.role,
      email: userRow.email,
    });
    setSessionCookie(req, res, token);

    recordAuditLog({
      actorUserId: userRow.id,
      action: 'USER_LOGIN',
      resourceType: 'User',
      resourceId: userRow.id,
      metadata: { role: userRow.role },
      ipAddress: req.ip,
    });

    res.json({
      user: getFullUserSessionView(userRow.id),
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/firebase', async (req, res, next) => {
  try {
    const input = firebaseLoginSchema.parse(req.body);
    let verified: { uid: string; email: string; name?: string };
    try {
      verified = await verifyFirebaseIdToken(input.idToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired Google sign-in token.' });
      return;
    }

    let userRow = db
      .prepare('SELECT id, email, role, is_active FROM users WHERE email = ?')
      .get(verified.email) as
      | { id: string; email: string; role: 'PATIENT' | 'DOCTOR' | 'ADMIN'; is_active: number }
      | undefined;

    if (!userRow) {
      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const patientId = `pat_${crypto.randomUUID().slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const displayName = verified.name?.trim() || verified.email.split('@')[0];

      db.exec('BEGIN');
      try {
        db.prepare(`
          INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, created_at, updated_at)
          VALUES (?, ?, ?, 'PATIENT', ?, NULL, 1, ?, ?)
        `).run(userId, verified.email, randomHash, displayName, nowIso, nowIso);

        db.prepare(`
          INSERT INTO patients (id, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(patientId, userId, nowIso, nowIso);
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      await dispatchNotification({
        userId,
        recipientEmail: verified.email,
        type: 'REGISTRATION_WELCOME',
        subject: 'Welcome to MediCloud — Google Account Connected',
        message: `Hello ${displayName}, your MediCloud patient portal is active via Google Sign-In.`,
        sendEmail: false,
      });

      userRow = {
        id: userId,
        email: verified.email,
        role: 'PATIENT',
        is_active: 1,
      };
    }

    if (userRow.is_active !== 1) {
      res.status(403).json({
        error: 'This account has been deactivated by an administrator.',
      });
      return;
    }

    const token = signSessionToken({
      userId: userRow.id,
      role: userRow.role,
      email: userRow.email,
    });
    setSessionCookie(req, res, token);

    recordAuditLog({
      actorUserId: userRow.id,
      action: 'USER_GOOGLE_LOGIN',
      resourceType: 'User',
      resourceId: userRow.id,
      metadata: { role: userRow.role, firebaseUid: verified.uid },
      ipAddress: req.ip,
    });

    res.json({
      user: getFullUserSessionView(userRow.id),
      token,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req: AuthenticatedRequest, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

authRouter.get('/session', (req: AuthenticatedRequest, res) => {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;
  const token = cookieToken || bearerToken;

  if (!token) {
    res.json({ user: null });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const userRow = db
      .prepare('SELECT id, is_active FROM users WHERE id = ?')
      .get(decoded.userId) as { id: string; is_active: number } | undefined;

    if (!userRow || userRow.is_active !== 1) {
      res.json({ user: null });
      return;
    }

    const user = getFullUserSessionView(userRow.id);
    res.json({ user: user || null });
  } catch {
    res.json({ user: null });
  }
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = getFullUserSessionView(req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: 'User profile not found.' });
    return;
  }
  res.json({ user });
});
