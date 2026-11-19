import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().max(32).optional(),
  bloodGroup: z.string().max(10).optional(),
  dateOfBirth: z.string().max(20).optional(),
  emergencyContact: z.string().max(160).optional(),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function LoginPage() {
  const { loginWithEmail, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const redirectForRole = (role: string) => {
    if (role === 'DOCTOR') navigate('/doctor');
    else if (role === 'ADMIN') navigate('/admin');
    else navigate('/patient');
  };

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      const loggedIn = await loginWithEmail(values.email, values.password);
      redirectForRole(loggedIn.role);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleDemoFill = async (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', 'MediCloud@2026', { shouldValidate: true });
    setServerError(null);
    try {
      const loggedIn = await loginWithEmail(email, 'MediCloud@2026');
      redirectForRole(loggedIn.role);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Demo sign-in failed.');
    }
  };

  const handleGoogleLogin = async () => {
    setServerError(null);
    setGoogleBusy(true);
    try {
      await loginWithGoogle();
      navigate('/patient');
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In did not complete. Use an account form below or try again.',
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to MediCloud</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to MediCloud</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Access your Patient, Doctor, or Administrator workspace.
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {serverError && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800"
            >
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                placeholder="you@medicloud.demo"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                placeholder="Enter your password"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              <span>{isSubmitting ? 'Signing in...' : 'Sign in'}</span>
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-200">
            <button
              type="button"
              disabled={googleBusy}
              onClick={handleGoogleLogin}
              className="w-full py-2.5 px-4 text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
            >
              {googleBusy ? 'Connecting to Google...' : 'Continue with Google (Firebase Cloud)'}
            </button>
          </div>

          {/* Academic Demo Quick Sign-in */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-700 mb-2.5">
              Synthetic Academic Demo Accounts
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => void handleDemoFill('arjun.mehta@medicloud.demo')}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Patient Demo · Arjun Mehta (arjun.mehta@medicloud.demo)
              </button>
              <button
                type="button"
                onClick={() => void handleDemoFill('dr.kavya.sharma@medicloud.demo')}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Doctor Demo · Dr. Kavya Sharma (Cardiology)
              </button>
              <button
                type="button"
                onClick={() => void handleDemoFill('admin@medicloud.demo')}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              >
                Admin Demo · Neha Kulkarni (Operations)
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-slate-600">
            New patient?{' '}
            <Link to="/register" className="font-semibold text-teal-700 hover:text-teal-800">
              Register an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { registerPatient } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    try {
      await registerPatient(values);
      navigate('/patient');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Registration failed.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to MediCloud</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Patient Account Registration
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Create your digital health profile to book appointments and access medical reports.
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {serverError && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800"
            >
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="reg-name" className="block text-sm font-medium text-slate-700 mb-1">
                Full name
              </label>
              <input
                id="reg-name"
                type="text"
                {...register('fullName')}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                placeholder="Rohan Deshmukh"
              />
              {errors.fullName && (
                <p className="mt-1 text-xs text-rose-600">{errors.fullName.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-slate-700 mb-1">
                  Email address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  {...register('email')}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="rohan@example.com"
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-700 mb-1">
                  Phone number
                </label>
                <input
                  id="reg-phone"
                  type="tel"
                  {...register('phone')}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="+91 98000 12345"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Password (min. 8 characters)
              </label>
              <input
                id="reg-password"
                type="password"
                {...register('password')}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="reg-dob" className="block text-sm font-medium text-slate-700 mb-1">
                  Date of birth
                </label>
                <input
                  id="reg-dob"
                  type="date"
                  {...register('dateOfBirth')}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label htmlFor="reg-blood" className="block text-sm font-medium text-slate-700 mb-1">
                  Blood group
                </label>
                <select
                  id="reg-blood"
                  {...register('bloodGroup')}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value="">Select</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-emergency"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Emergency contact
              </label>
              <input
                id="reg-emergency"
                type="text"
                {...register('emergencyContact')}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                placeholder="Name and phone number"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Creating account...' : 'Register Patient Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-teal-700 hover:text-teal-800">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
