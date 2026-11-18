import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarPlus,
  Download,
  Eye,
  FileText,
  History,
  Search,
  Share2,
  ShieldOff,
} from 'lucide-react';
import { PortalLayout } from '../layouts/PortalLayout';
import { AppointmentStatusLabel } from '../components/StatusText';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatIstDateTime,
  getTodayIstYmd,
  type GeneratedSlot,
} from '../shared/clinicRules';

interface AppointmentRow {
  id: string;
  doctor_id: string;
  doctor_name: string;
  doctor_specialization: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  reason: string;
  consultation_notes: string | null;
}

interface RecordRow {
  id: string;
  title: string;
  category: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  notes: string | null;
  created_at: string;
  doctor_name: string;
  doctor_specialization?: string;
}

interface DoctorOption {
  id: string;
  fullName: string;
  specialization: string;
  department: string;
  experienceYears: number;
  consultationFee: number;
  bio: string | null;
  avatarUrl: string | null;
}

interface SharingPermissionRow {
  id: string;
  record_id: string;
  record_title: string;
  doctor_name: string;
  doctor_specialization: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  is_active: number;
}

interface AccessHistoryRow {
  id: string;
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

export function PatientDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    profile: Record<string, string | null>;
    appointments: AppointmentRow[];
    recentRecords: RecordRow[];
    unreadNotifications: number;
    activeShares: number;
  } | null>(null);

  useEffect(() => {
    if (user?.authSource === 'firebase') {
      setLoading(false);
      return;
    }
    apiRequest<typeof data>('/api/dashboard/patient')
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'))
      .finally(() => setLoading(false));
  }, [user]);

  const upcoming = (data?.appointments || []).filter((a) =>
    ['REQUESTED', 'APPROVED', 'RESCHEDULED'].includes(a.status),
  );

  return (
    <PortalLayout title="Patient Overview" breadcrumb="Patient Portal / Overview">
      {user?.authSource === 'firebase' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900">Firebase Cloud Session Active</h2>
          <p className="text-sm text-slate-600 mt-2">
            Signed in via Google ({user.email}). Your patient profile is synchronized to Cloud
            Firestore. For full multi-role appointment and S3 vault testing, you can also sign in
            with the clinic REST portal accounts.
          </p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
          {error}
        </div>
      ) : (
        <div className="space-y-8">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Upcoming Visits</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {upcoming.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Medical Reports</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.recentRecords.length ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Active Consent Shares</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.activeShares ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Unread Alerts</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.unreadNotifications ?? 0}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upcoming Appointments */}
            <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold text-slate-900">Upcoming Appointments</h2>
                <Link
                  to="/patient/doctors"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
                >
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Book Appointment</span>
                </Link>
              </div>
              {upcoming.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-slate-500">No upcoming consultations scheduled.</p>
                  <Link
                    to="/patient/doctors"
                    className="inline-block mt-3 text-sm font-semibold text-teal-700 hover:text-teal-800"
                  >
                    Browse specialists →
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {upcoming.slice(0, 5).map((appt) => (
                    <div key={appt.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{appt.doctor_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {appt.doctor_specialization} · {appt.reason}
                        </p>
                      </div>
                      <div className="flex sm:flex-col items-start sm:items-end gap-2 sm:gap-1">
                        <span className="text-xs font-mono-tabular text-slate-700">
                          {formatIstDateTime(appt.scheduled_start)} IST
                        </span>
                        <AppointmentStatusLabel status={appt.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Basic Clinical Profile Summary */}
            <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 mb-4">Clinical Summary</h2>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Blood Group</dt>
                    <dd className="font-semibold text-slate-900 font-mono-tabular">
                      {data?.profile.blood_group || 'Not set'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Date of Birth</dt>
                    <dd className="font-medium text-slate-900 font-mono-tabular">
                      {data?.profile.date_of_birth || 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Known Allergies</dt>
                    <dd className="font-medium text-slate-900">
                      {data?.profile.allergies || 'None recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Emergency Contact</dt>
                    <dd className="font-medium text-slate-900">
                      {data?.profile.emergency_contact || 'Not set'}
                    </dd>
                  </div>
                </dl>
              </div>
              <Link
                to="/patient/profile"
                className="mt-6 text-sm font-semibold text-teal-700 hover:text-teal-800"
              >
                Update medical profile →
              </Link>
            </section>
          </div>

          {/* Recent Medical Records */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Recent Medical Reports</h2>
              <Link
                to="/patient/records"
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap"
              >
                Open Records Vault →
              </Link>
            </div>
            {(data?.recentRecords.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-slate-500">No medical reports uploaded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data?.recentRecords.map((rec) => (
                  <div key={rec.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{rec.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {rec.category} · Uploaded by {rec.doctor_name} ·{' '}
                        {formatIstDateTime(rec.created_at)} IST
                      </p>
                    </div>
                    <Link
                      to="/patient/records"
                      className="text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap shrink-0"
                    >
                      View &amp; Share
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PortalLayout>
  );
}

export function DoctorDirectoryBookingPage() {
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [search, setSearch] = useState('');
  const [specialization, setSpecialization] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const [selectedDoctor, setSelectedDoctor] = useState<DoctorOption | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayIstYmd());
  const [slots, setSlots] = useState<GeneratedSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [reason, setReason] = useState('');
  const [bookingMsg, setBookingMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchDoctors = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('q', search.trim());
      if (specialization !== 'ALL') qs.set('specialization', specialization);
      const res = await apiRequest<{ doctors: DoctorOption[] }>(`/api/doctors?${qs.toString()}`);
      setDoctors(res.doctors);
    } finally {
      setLoading(false);
    }
  }, [search, specialization]);

  useEffect(() => {
    void fetchDoctors();
  }, [fetchDoctors]);

  const loadSlots = useCallback(async (doctorId: string, dateYmd: string) => {
    setSlotsLoading(true);
    setSelectedSlot(null);
    try {
      const res = await apiRequest<{ slots: GeneratedSlot[] }>(
        `/api/doctors/${doctorId}/slots?date=${dateYmd}`,
      );
      setSlots(res.slots);
    } catch {
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDoctor) {
      void loadSlots(selectedDoctor.id, selectedDate);
    }
  }, [selectedDoctor, selectedDate, loadSlots]);

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctor || !selectedSlot) return;
    if (reason.trim().length < 3) {
      setBookingMsg({ type: 'err', text: 'Please enter a consultation reason (min 3 characters).' });
      return;
    }

    setSubmitting(true);
    setBookingMsg(null);
    try {
      await apiRequest('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          scheduledStart: selectedSlot.startIso,
          scheduledEnd: selectedSlot.endIso,
          reason: reason.trim(),
        }),
      });
      setBookingMsg({
        type: 'ok',
        text: `Appointment requested with ${selectedDoctor.fullName} (${selectedSlot.labelIst}).`,
      });
      setReason('');
      setSelectedSlot(null);
      void loadSlots(selectedDoctor.id, selectedDate);
    } catch (err) {
      setBookingMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to book slot.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalLayout title="Find Doctors & Book Slot" breadcrumb="Patient Portal / Doctor Directory">
      <div className="space-y-6">
        {/* Search & Filter Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
            <label htmlFor="doc-search" className="sr-only">
              Search doctors by name or department
            </label>
            <input
              id="doc-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search specialist name or department..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="doc-spec-filter" className="sr-only">
              Filter by specialization
            </label>
            <select
              id="doc-spec-filter"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="w-full sm:w-52 px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="ALL">All Specializations</option>
              <option value="Cardiology">Cardiology</option>
              <option value="Neurology">Neurology</option>
              <option value="General Medicine">General Medicine</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Doctor Cards */}
          <div className="lg:col-span-7 space-y-4">
            {loading ? (
              <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
                Loading specialist directory...
              </div>
            ) : doctors.length === 0 ? (
              <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
                No doctors matched your filter criteria.
              </div>
            ) : (
              doctors.map((doc) => {
                const isSelected = selectedDoctor?.id === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={`bg-white border rounded-xl p-5 flex flex-col sm:flex-row gap-5 transition-colors ${
                      isSelected ? 'border-teal-600 ring-1 ring-teal-600' : 'border-slate-200'
                    }`}
                  >
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                      {doc.avatarUrl ? (
                        <img
                          src={doc.avatarUrl}
                          alt={doc.fullName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover object-top"
                        />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h2 className="text-base font-semibold text-slate-900">{doc.fullName}</h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {doc.specialization} · {doc.department} · {doc.experienceYears} yrs · ₹
                            {doc.consultationFee}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctor(doc);
                            setBookingMsg(null);
                          }}
                          className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-teal-700 text-white'
                              : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Check Slots'}
                        </button>
                      </div>
                      <p className="text-sm text-slate-600 mt-3 leading-relaxed">{doc.bio}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Slot Picker & Booking Form */}
          <div className="lg:col-span-5">
            <div className="bg-white border border-slate-200 rounded-xl p-6 sticky top-24">
              {!selectedDoctor ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-slate-700">Select a specialist</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click &ldquo;Check Slots&rdquo; on any physician to view available Asia/Kolkata
                    (IST) windows.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleBookAppointment} className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Book with {selectedDoctor.fullName}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedDoctor.specialization} · Fee ₹{selectedDoctor.consultationFee}
                    </p>
                  </div>

                  {bookingMsg && (
                    <div
                      role="alert"
                      className={`p-3 rounded-lg text-xs border ${
                        bookingMsg.type === 'ok'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {bookingMsg.text}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="slot-date"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Consultation Date (IST)
                    </label>
                    <input
                      id="slot-date"
                      type="date"
                      min={getTodayIstYmd()}
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <p className="block text-xs font-semibold text-slate-700 mb-2">
                      Available 30-Min Windows (Asia/Kolkata)
                    </p>
                    {slotsLoading ? (
                      <p className="text-xs text-slate-500">Checking doctor availability...</p>
                    ) : slots.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No open slots remaining on this date. Try another day.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                        {slots.map((slot) => {
                          const active = selectedSlot?.startIso === slot.startIso;
                          return (
                            <button
                              key={slot.startIso}
                              type="button"
                              disabled={slot.isBooked}
                              onClick={() => setSelectedSlot(slot)}
                              className={`px-2.5 py-2 text-xs font-mono-tabular rounded-lg border text-center transition-colors ${
                                slot.isBooked
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 line-through cursor-not-allowed'
                                  : active
                                    ? 'bg-teal-700 border-teal-700 text-white font-semibold'
                                    : 'bg-white border-slate-300 text-slate-800 hover:border-teal-600'
                              }`}
                            >
                              {slot.labelIst.replace(' IST', '')}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="visit-reason"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Reason for Visit
                    </label>
                    <textarea
                      id="visit-reason"
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Describe symptoms or follow-up details..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !selectedSlot}
                    className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {submitting ? 'Confirming slot...' : 'Request Appointment'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

export function PatientAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentRow | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(getTodayIstYmd());
  const [rescheduleSlots, setRescheduleSlots] = useState<GeneratedSlot[]>([]);
  const [chosenSlot, setChosenSlot] = useState<GeneratedSlot | null>(null);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'ALL' ? '' : `?status=${filter}`;
      const res = await apiRequest<{ appointments: AppointmentRow[] }>(`/api/appointments${qs}`);
      setAppointments(res.appointments);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    if (!rescheduleTarget) return;
    apiRequest<{ slots: GeneratedSlot[] }>(
      `/api/doctors/${rescheduleTarget.doctor_id}/slots?date=${rescheduleDate}`,
    )
      .then((res) => setRescheduleSlots(res.slots.filter((s) => !s.isBooked)))
      .catch(() => setRescheduleSlots([]));
  }, [rescheduleTarget, rescheduleDate]);

  const handleCancel = async (apptId: string) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/appointments/${apptId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      setFeedback('Appointment cancelled.');
      void loadAppointments();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to cancel appointment.');
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget || !chosenSlot) return;
    try {
      await apiRequest(`/api/appointments/${rescheduleTarget.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledStart: chosenSlot.startIso,
          scheduledEnd: chosenSlot.endIso,
        }),
      });
      setFeedback('Appointment rescheduled and sent to doctor for confirmation.');
      setRescheduleTarget(null);
      setChosenSlot(null);
      void loadAppointments();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Reschedule failed.');
    }
  };

  const tabs = ['ALL', 'REQUESTED', 'APPROVED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED'];

  return (
    <PortalLayout title="My Appointments" breadcrumb="Patient Portal / Appointments">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <Link
            to="/patient/doctors"
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
          >
            New Appointment
          </Link>
        </div>

        {feedback && (
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
            {feedback}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading appointments...</p>
          ) : appointments.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-slate-600">No appointments found in this view.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Specialist</th>
                    <th className="py-3 px-4">Scheduled (IST)</th>
                    <th className="py-3 px-4">Reason &amp; Notes</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {appointments.map((appt) => {
                    const mutable = ['REQUESTED', 'APPROVED', 'RESCHEDULED'].includes(appt.status);
                    return (
                      <tr key={appt.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-4">
                          <p className="font-semibold text-slate-900">{appt.doctor_name}</p>
                          <p className="text-xs text-slate-500">{appt.doctor_specialization}</p>
                        </td>
                        <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-700 whitespace-nowrap">
                          {formatIstDateTime(appt.scheduled_start)}
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="text-slate-800">{appt.reason}</p>
                          {appt.consultation_notes && (
                            <p className="text-xs text-slate-500 mt-1">
                              Doctor notes: {appt.consultation_notes}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <AppointmentStatusLabel status={appt.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {mutable ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setRescheduleTarget(appt);
                                  setChosenSlot(null);
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCancel(appt.id)}
                                className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Closed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Reschedule Modal */}
        {rescheduleTarget && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Reschedule appointment"
              className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
            >
              <h2 className="text-base font-semibold text-slate-900">
                Reschedule with {rescheduleTarget.doctor_name}
              </h2>
              <form onSubmit={handleRescheduleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="resched-date" className="block text-xs font-semibold text-slate-700 mb-1">
                    New Date (IST)
                  </label>
                  <input
                    id="resched-date"
                    type="date"
                    min={getTodayIstYmd()}
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-2">Open Slots</p>
                  <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto">
                    {rescheduleSlots.length === 0 ? (
                      <p className="text-xs text-slate-500 col-span-2">No open slots on this day.</p>
                    ) : (
                      rescheduleSlots.map((slot) => (
                        <button
                          key={slot.startIso}
                          type="button"
                          onClick={() => setChosenSlot(slot)}
                          className={`px-2 py-1.5 text-xs font-mono-tabular rounded-lg border ${
                            chosenSlot?.startIso === slot.startIso
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'border-slate-300 text-slate-700 hover:border-teal-600'
                          }`}
                        >
                          {slot.labelIst.replace(' IST', '')}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRescheduleTarget(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={!chosenSlot}
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
                  >
                    Confirm Reschedule
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export function PatientRecordsPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [permissions, setPermissions] = useState<SharingPermissionRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [shareRecord, setShareRecord] = useState<RecordRow | null>(null);
  const [shareDoctorId, setShareDoctorId] = useState('');
  const [shareDays, setShareDays] = useState(14);

  const [historyRecord, setHistoryRecord] = useState<RecordRow | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AccessHistoryRow[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, shareRes, docRes] = await Promise.all([
        apiRequest<{ records: RecordRow[] }>('/api/medical-records'),
        apiRequest<{ permissions: SharingPermissionRow[] }>('/api/sharing'),
        apiRequest<{ doctors: DoctorOption[] }>('/api/doctors'),
      ]);
      setRecords(recRes.records);
      setPermissions(shareRes.permissions);
      setDoctors(docRes.doctors);
      if (docRes.doctors[0]) {
        setShareDoctorId((prev) => prev || docRes.doctors[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleDownload = async (rec: RecordRow) => {
    setMessage(null);
    try {
      const grant = await apiRequest<{ downloadUrl: string; expiresInSeconds: number }>(
        `/api/medical-records/${rec.id}/download-url`,
      );
      const a = document.createElement('a');
      a.href = grant.downloadUrl;
      a.download = rec.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMessage(`Issued time-limited (${grant.expiresInSeconds}s) download link for ${rec.file_name}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Download authorization failed.');
    }
  };

  const handleOpenHistory = async (rec: RecordRow) => {
    setHistoryRecord(rec);
    try {
      const res = await apiRequest<{ history: AccessHistoryRow[] }>(
        `/api/medical-records/${rec.id}/access-history`,
      );
      setHistoryLogs(res.history);
    } catch {
      setHistoryLogs([]);
    }
  };

  const handleGrantShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareRecord || !shareDoctorId) return;
    try {
      await apiRequest('/api/sharing', {
        method: 'POST',
        body: JSON.stringify({
          recordId: shareRecord.id,
          doctorId: shareDoctorId,
          durationDays: shareDays,
        }),
      });
      setMessage(`Granted ${shareDays}-day access to "${shareRecord.title}".`);
      setShareRecord(null);
      void loadAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to grant consent.');
    }
  };

  const handleRevokeShare = async (permId: string) => {
    try {
      await apiRequest(`/api/sharing/${permId}/revoke`, { method: 'PATCH' });
      setMessage('Consent permission revoked immediately.');
      void loadAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to revoke consent.');
    }
  };

  return (
    <PortalLayout title="Medical Records & Consent Sharing" breadcrumb="Patient Portal / Records">
      <div className="space-y-8">
        {message && (
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
            {message}
          </div>
        )}

        {/* Encrypted Vault Table */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Your Medical Reports</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Stored in private encrypted cloud storage; downloads use short-lived signed URLs.
              </p>
            </div>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading medical records...</p>
          ) : records.length === 0 ? (
            <p className="p-8 text-sm text-slate-500 text-center">No medical reports found.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="h-5 w-5 text-teal-700 mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {rec.category} · {rec.doctor_name} ·{' '}
                        <span className="font-mono-tabular">
                          {Math.max(1, Math.round(rec.file_size_bytes / 1024))} KB
                        </span>{' '}
                        · {formatIstDateTime(rec.created_at)} IST
                      </p>
                      {rec.notes && <p className="text-xs text-slate-600 mt-1">{rec.notes}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDownload(rec)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShareRecord(rec)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Share</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenHistory(rec)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Access Log</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Active & Revoked Sharing Consents */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Consent-Based Record Sharing Permissions
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Control which specialists can view specific reports and revoke access at any time.
            </p>
          </div>
          {permissions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              You have not shared any medical reports yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Report</th>
                    <th className="py-3 px-4">Authorized Doctor</th>
                    <th className="py-3 px-4">Expires (IST)</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {permissions.map((perm) => {
                    const active = perm.is_active === 1 && !perm.revoked_at;
                    return (
                      <tr key={perm.id}>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {perm.record_title}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          {perm.doctor_name} ·{' '}
                          <span className="text-xs text-slate-500">{perm.doctor_specialization}</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono-tabular text-slate-600">
                          {formatIstDateTime(perm.expires_at)}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium">
                          {active ? (
                            <span className="text-emerald-700">Active Consent</span>
                          ) : (
                            <span className="text-rose-700">Revoked</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {active ? (
                            <button
                              type="button"
                              onClick={() => void handleRevokeShare(perm.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md"
                            >
                              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Revoke</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Inactive</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Share Modal */}
        {shareRecord && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Share medical record"
              className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
            >
              <h2 className="text-base font-semibold text-slate-900">
                Grant Access: {shareRecord.title}
              </h2>
              <form onSubmit={handleGrantShare} className="space-y-4">
                <div>
                  <label htmlFor="share-doc" className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Specialist
                  </label>
                  <select
                    id="share-doc"
                    value={shareDoctorId}
                    onChange={(e) => setShareDoctorId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.specialization})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="share-days" className="block text-xs font-semibold text-slate-700 mb-1">
                    Access Duration (Days)
                  </label>
                  <input
                    id="share-days"
                    type="number"
                    min={1}
                    max={365}
                    value={shareDays}
                    onChange={(e) => setShareDays(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShareRecord(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                  >
                    Grant Consent
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Access History Modal */}
        {historyRecord && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Medical record access history"
              className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Eye className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Access History: {historyRecord.title}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setHistoryRecord(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {historyLogs.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">No recorded access events yet.</p>
                ) : (
                  historyLogs.map((h) => (
                    <div key={h.id} className="py-3 text-xs">
                      <p className="font-semibold text-slate-900">
                        {h.action} · {h.actor_name || 'System'} ({h.actor_role || 'SYSTEM'})
                      </p>
                      <p className="text-slate-500 mt-0.5 font-mono-tabular">
                        {formatIstDateTime(h.created_at)} IST
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export function PatientProfilePage() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.patientProfile?.date_of_birth || '');
  const [gender, setGender] = useState(user?.patientProfile?.gender || '');
  const [bloodGroup, setBloodGroup] = useState(user?.patientProfile?.blood_group || '');
  const [allergies, setAllergies] = useState(user?.patientProfile?.allergies || '');
  const [emergencyContact, setEmergencyContact] = useState(
    user?.patientProfile?.emergency_contact || '',
  );
  const [address, setAddress] = useState(user?.patientProfile?.address || '');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.patientProfile?.id) return;
    setSaving(true);
    setStatus(null);
    try {
      await apiRequest(`/api/patients/${user.patientProfile.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName,
          phone,
          dateOfBirth,
          gender,
          bloodGroup,
          allergies,
          emergencyContact,
          address,
        }),
      });
      await refreshUser();
      setStatus('Patient profile updated successfully.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout title="Profile & Medical Baseline" breadcrumb="Patient Portal / Profile">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-2xl">
        {status && (
          <div className="mb-5 p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-sm text-teal-900">
            {status}
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="prof-name" className="block text-sm font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="prof-phone" className="block text-sm font-medium text-slate-700 mb-1">
                Phone
              </label>
              <input
                id="prof-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="prof-dob" className="block text-sm font-medium text-slate-700 mb-1">
                Date of Birth
              </label>
              <input
                id="prof-dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="prof-gender" className="block text-sm font-medium text-slate-700 mb-1">
                Gender
              </label>
              <input
                id="prof-gender"
                type="text"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="prof-blood" className="block text-sm font-medium text-slate-700 mb-1">
                Blood Group
              </label>
              <input
                id="prof-blood"
                type="text"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label htmlFor="prof-allergies" className="block text-sm font-medium text-slate-700 mb-1">
              Known Allergies
            </label>
            <input
              id="prof-allergies"
              type="text"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="prof-emergency" className="block text-sm font-medium text-slate-700 mb-1">
              Emergency Contact
            </label>
            <input
              id="prof-emergency"
              type="text"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="prof-address" className="block text-sm font-medium text-slate-700 mb-1">
              Residential Address
            </label>
            <textarea
              id="prof-address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </PortalLayout>
  );
}
