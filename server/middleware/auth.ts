import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { db } from '../db/database';
import type { UserRole } from '../../src/shared/clinicRules';

export const AUTH_COOKIE_NAME = 'medicloud_session';

export interface AuthTokenPayload {
  userId: string;
  role: UserRole;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

export function signSessionToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h' });
}

function isHttpsRequest(req: Request): boolean {
  return (
    env.cookieSecure ||
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https'
  );
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 12 * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;

  const token = cookieToken || bearerToken;
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const userRow = db
      .prepare('SELECT id, role, email, is_active FROM users WHERE id = ?')
      .get(decoded.userId) as
      | { id: string; role: UserRole; email: string; is_active: number }
      | undefined;

    if (!userRow || userRow.is_active !== 1) {
      res.status(401).json({ error: 'Account is inactive or no longer valid.' });
      return;
    }

    req.auth = {
      userId: userRow.id,
      role: userRow.role,
      email: userRow.email,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient role permissions for this resource.' });
      return;
    }
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed.',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  console.error('[API Error]', err);
  res.status(500).json({
    error: 'An unexpected server error occurred. Please try again.',
  });
}
