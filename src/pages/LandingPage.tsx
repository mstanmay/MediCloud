import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, FileLock2, ShieldCheck, UserCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface PublicDoctor {
  id: string;
  fullName: string;
  specialization: string;
  department: string;
  experienceYears: number;
  consultationFee: number;
  bio: string | null;
  avatarUrl: string | null;
}

export function LandingPage() {
  const { user } = useAuth();
  const [doctors, setDoctors] = useState<PublicDoctor[]>([]);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiRequest<{ doctors: PublicDoctor[] }>('/api/doctors')
      .then((res) => setDoctors(res.doctors.slice(0, 3)))
      .catch(() => setDoctors([]));
  }, []);

  const portalTarget =
    user?.role === 'DOCTOR'
      ? '/doctor'
      : user?.role === 'ADMIN'
        ? '/admin'
        : user?.role === 'PATIENT'
          ? '/patient'
          : '/login';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            MediCloud
          </Link>

          <nav
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
            aria-label="Primary Navigation"
          >
            <a
              href="#workflows"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Workflows
            </a>
            <a
              href="#specialists"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Specialists
            </a>
            <a
              href="#security"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Security
            </a>
          </nav>

          <div className="shrink-0">
            <Link
              to={portalTarget}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>{user ? 'Open Portal' : 'Sign In'}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Split */}
        <section className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-teal-700 tracking-wide mb-3">
                Cloud Patient Monitoring · Asia/Kolkata IST · Role-Based Vault
              </p>
              <h1
                className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12] max-w-xl"
                style={{ textWrap: 'balance' }}
              >
                Centralized clinical records and conflict-free patient care.
              </h1>
              <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-xl">
                MediCloud unifies digital medical reports, doctor slot scheduling, automated 24-hour
                visit reminders, and patient-controlled consent sharing across a secure cloud
                architecture.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to={user ? portalTarget : '/register'}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>{user ? 'Go to Dashboard' : 'Create Patient Account'}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center px-6 py-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                >
                  Explore Demo Portals
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[300px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <img
                  src="/src/assets/images/hero_clinical_facility_1795016749246.jpg"
                  alt="Modern outpatient MediCloud clinic reception and physician reviewing digital patient telemetry"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Full-width 4-column metric bar below hero */}
          <div className="border-t border-slate-200 bg-slate-50">
            <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 lg:grid-cols-4 gap-8">
              <div>
                <p className="text-2xl font-bold text-slate-900 font-mono-tabular">3 Roles</p>
                <p className="text-sm text-slate-600 mt-1">
                  Isolated Patient, Doctor &amp; Admin portals
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 font-mono-tabular">24 Hours</p>
                <p className="text-sm text-slate-600 mt-1">
                  Automated pre-visit reminder sweep
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 font-mono-tabular">PDF · JPG · PNG</p>
                <p className="text-sm text-slate-600 mt-1">
                  Magic-byte verified private report vault
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 font-mono-tabular">Time-Bound</p>
                <p className="text-sm text-slate-600 mt-1">
                  Revocable patient record sharing consent
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Core Workflows */}
        <section id="workflows" className="max-w-7xl mx-auto px-6 py-16">
          <div className="max-w-2xl mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              End-to-End Clinical Workflows
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Designed to eliminate scattered paper records, double-booked slots, and missed
              outpatient follow-ups.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 lg:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <CalendarCheck2 className="h-5 w-5 text-teal-700" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-slate-900">
                  01. Transactional Slot Scheduling
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Doctors configure weekly recurring consultation windows in Asia/Kolkata (IST).
                Patients browse open intervals in real time while database transactions block
                overlapping bookings and enforce the full Requested → Approved → Completed
                lifecycle.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <FileLock2 className="h-5 w-5 text-teal-700" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-slate-900">
                  02. Encrypted Report Vault
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Authorized physicians upload verified PDFs or diagnostic images via short-lived
                pre-signed grants. Reports are never exposed on permanent public URLs.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <UserCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-slate-900">
                  03. Consent-Driven Sharing
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Patients grant temporary, expirable access to specific diagnostic reports for
                referring specialists and can revoke access instantly with full audit history.
              </p>
            </div>

            <div id="security" className="bg-white border border-slate-200 rounded-xl p-6 lg:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-slate-900">
                  04. Least-Privilege Access &amp; Immutable Audit Trail
                </h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Every API route validates session identity and resource ownership. Patients see only
                their own charts, doctors see only assigned or consented patients, and clinic
                administrators oversee operational analytics without direct access to clinical file
                bytes.
              </p>
            </div>
          </div>
        </section>

        {/* Specialist Directory Preview */}
        <section id="specialists" className="bg-white border-y border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-16">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Verified Specialists
                </h2>
                <p className="mt-2 text-base text-slate-600">
                  Browse active clinical departments and book directly into open IST slots.
                </p>
              </div>
              <Link
                to="/login"
                className="text-sm font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap"
              >
                Sign in to book consultation →
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {doctors.map((doc) => (
                <article
                  key={doc.id}
                  className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 flex flex-col"
                >
                  <div className="aspect-square bg-slate-200 overflow-hidden">
                    {doc.avatarUrl && !imageErrors[doc.id] ? (
                      <img
                        src={doc.avatarUrl}
                        alt={doc.fullName}
                        referrerPolicy="no-referrer"
                        onError={() => setImageErrors((prev) => ({ ...prev, [doc.id]: true }))}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-200 text-slate-600 font-semibold text-xl">
                        {doc.fullName}
                      </div>
                    )}
                  </div>
                  <div className="p-6 bg-white flex-1 flex flex-col">
                    <h3 className="text-lg font-semibold text-slate-900">{doc.fullName}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {doc.specialization} · {doc.experienceYears} yrs exp · ₹{doc.consultationFee}
                    </p>
                    <p className="text-sm text-slate-600 mt-3 leading-relaxed flex-1">
                      {doc.bio || `${doc.department} specialist available for outpatient consultations.`}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>MediCloud · Academic Cloud Computing Healthcare Prototype (Synthetic Demonstration Data)</p>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-slate-900">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-slate-900">
              Patient Registration
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
