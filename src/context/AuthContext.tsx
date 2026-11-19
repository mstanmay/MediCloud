import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, setAuthToken } from '../lib/api';
import { signInWithGoogleCloud, signOutFirebase } from '../lib/firebase';
import type { UserRole } from '../shared/clinicRules';

export interface PatientProfileData {
  id: string;
  user_id: string;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string | null;
  allergies: string | null;
  emergency_contact: string | null;
  address: string | null;
}

export interface DoctorProfileData {
  id: string;
  user_id: string;
  specialization: string;
  license_number: string;
  department: string;
  experience_years: number;
  consultation_fee: number;
  bio: string | null;
  avatar_url: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  patientProfile?: PatientProfileData | null;
  doctorProfile?: DoctorProfileData | null;
  authSource?: 'api' | 'firebase';
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<SessionUser>;
  registerPatient: (payload: Record<string, unknown>) => Promise<SessionUser>;
  loginWithGoogle: () => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiRequest<{ user: SessionUser | null }>('/api/auth/session');
      if (res.user) {
        setUser({ ...res.user, authSource: 'api' });
      } else {
        setAuthToken(null);
        setUser(null);
      }
    } catch {
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    const res = await apiRequest<{ user: SessionUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    const sessionUser: SessionUser = { ...res.user, authSource: 'api' };
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const registerPatient = useCallback(async (payload: Record<string, unknown>) => {
    const res = await apiRequest<{ user: SessionUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(res.token);
    const sessionUser: SessionUser = { ...res.user, authSource: 'api' };
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const fbUser = await signInWithGoogleCloud();
    const res = await apiRequest<{ user: SessionUser; token: string }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken: fbUser.idToken }),
    });
    setAuthToken(res.token);
    const sessionUser: SessionUser = { ...res.user, authSource: 'api' };
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore API logout error
    }
    try {
      await signOutFirebase();
    } catch {
      // Ignore if not signed into Firebase
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refreshUser,
        loginWithEmail,
        registerPatient,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
