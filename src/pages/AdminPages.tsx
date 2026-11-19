import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, ShieldAlert, UserPlus } from 'lucide-react';
import { PortalLayout } from '../layouts/PortalLayout';
import { AppointmentStatusLabel } from '../components/StatusText';
import { apiRequest } from '../lib/api';
import { formatIstDateTime } from '../shared/clinicRules';

interface AdminDashboardData {
  summary: {
    totalPatients: number;
    totalDoctors: number;
    totalAppointments: number;
    totalRecords: number;
    statusBreakdown: Array<{ status: string; count: number }>;
  };
  byDepartment: Array<{ specialization: string; count: number }>;
  emailLogs: Array<{
    id: string;
    type: string;
    subject: string;
    delivery_status: string;
    sent_at: string;
    recipient_email: string;
  }>;
}

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  full_name: string;
  phone: string | null;
  is_active: number;
  specialization: string | null;
  license_number: string | null;
  blood_group: string | null;
}

interface AdminAppointmentRow {
  id: string;
  patient_name: string;
  doctor_name: string;
  doctor_specialization: string;
  scheduled_start: string;
  status: string;
  reason: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata_json: string | null;
  ip_address: string | null;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<AdminDashboardData>('/api/dashboard/admin');
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const triggerReminderSweep = async () => {
    setSweepMsg(null);
    try {
      const res = await apiRequest<{ remindersSent: number; checkedAt: string }>(
        '/api/admin/run-reminders',
        { method: 'POST' },
      );
      setSweepMsg(
        `24-hour reminder sweep executed at ${formatIstDateTime(res.checkedAt)} IST: ${res.remindersSent} reminder(s) dispatched.`,
      );
      void load();
    } catch (err) {
      setSweepMsg(err instanceof Error ? err.message : 'Sweep failed.');
    }
  };

  const countFor = (status: string) =>
    data?.summary.statusBreakdown.find((s) => s.status === status)?.count ?? 0;

  return (
    <PortalLayout title="Operations & Analytics" breadcrumb="Admin Portal / Overview">
      {loading ? (
        <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Loading operational analytics...
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Automated 24-Hour Appointment Reminder Worker
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Runs automatically on schedule and prevents duplicate email alerts via database
                tracking.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void triggerReminderSweep()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap shrink-0"
            >
              <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Run Reminder Sweep Now</span>
            </button>
          </div>

          {sweepMsg && (
            <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
              {sweepMsg}
            </div>
          )}

          {/* Primary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Patients</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.summary.totalPatients ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Doctors</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.summary.totalDoctors ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Total Visits</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.summary.totalAppointments ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Pending</p>
              <p className="text-2xl font-bold text-amber-700 mt-1 font-mono-tabular">
                {countFor('REQUESTED') + countFor('RESCHEDULED')}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Completed</p>
              <p className="text-2xl font-bold text-teal-700 mt-1 font-mono-tabular">
                {countFor('COMPLETED')}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Cancelled</p>
              <p className="text-2xl font-bold text-rose-700 mt-1 font-mono-tabular">
                {countFor('CANCELLED')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Appointments by Specialization
              </h2>
              <div className="space-y-3">
                {data?.byDepartment.map((dept) => {
                  const max = Math.max(1, ...(data?.byDepartment.map((d) => d.count) || [1]));
                  const widthPct = Math.round((dept.count / max) * 100);
                  return (
                    <div key={dept.specialization}>
                      <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>{dept.specialization}</span>
                        <span className="font-mono-tabular">{dept.count}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-700 rounded-full"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">
                  SES Email Notification Log
                </h2>
              </div>
              {(data?.emailLogs.length ?? 0) === 0 ? (
                <p className="p-6 text-sm text-slate-500">No email notifications logged yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {data?.emailLogs.map((log) => (
                    <div key={log.id} className="px-6 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">{log.subject}</span>
                        <span className="font-mono-tabular text-teal-700 shrink-0">
                          {log.delivery_status}
                        </span>
                      </div>
                      <p className="text-slate-500 mt-0.5">
                        To: {log.recipient_email} · {formatIstDateTime(log.sent_at)} IST
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [specialization, setSpecialization] = useState('Dermatology');
  const [department, setDepartment] = useState('Clinical Dermatology');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [fee, setFee] = useState(1000);

  const load = useCallback(async () => {
    const res = await apiRequest<{ users: AdminUserRow[] }>('/api/admin/users');
    setUsers(res.users);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleStatus = async (u: AdminUserRow) => {
    setMsg(null);
    try {
      await apiRequest(`/api/admin/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: u.is_active !== 1 }),
      });
      setMsg(`Updated account status for ${u.full_name}.`);
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const handleOnboardDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await apiRequest('/api/doctors', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          password,
          specialization,
          department,
          licenseNumber,
          consultationFee: fee,
        }),
      });
      setMsg(`Onboarded ${fullName} (${specialization}) successfully.`);
      setModalOpen(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setLicenseNumber('');
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Doctor onboarding failed.');
    }
  };

  const filtered = users.filter((u) => (roleFilter === 'ALL' ? true : u.role === roleFilter));

  return (
    <PortalLayout title="Doctor & Patient Accounts" breadcrumb="Admin Portal / Users">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {['ALL', 'DOCTOR', 'PATIENT', 'ADMIN'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  roleFilter === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {r === 'ALL' ? 'All Users' : r.charAt(0) + r.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Register Doctor</span>
          </button>
        </div>

        {msg && (
          <div className="p-3.5 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
            {msg}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Clinical Metadata</th>
                  <th className="py-3 px-4">Account State</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{u.full_name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700">{u.role}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {u.role === 'DOCTOR'
                        ? `${u.specialization} · ${u.license_number}`
                        : u.role === 'PATIENT'
                          ? `Blood: ${u.blood_group || 'N/A'}`
                          : 'Clinic Operations'}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium">
                      {u.is_active === 1 ? (
                        <span className="text-emerald-700">Active</span>
                      ) : (
                        <span className="text-rose-700">Deactivated</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void toggleStatus(u)}
                        className="px-3 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        {u.is_active === 1 ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Register new doctor"
              className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
            >
              <h2 className="text-base font-semibold text-slate-900">Onboard New Physician</h2>
              <form onSubmit={handleOnboardDoctor} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Full Name (e.g. Dr. Rohan Joshi)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="email"
                  required
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Initial password (min 8 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Specialization"
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="License No. (MCI-...)"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <input
                    type="number"
                    required
                    min={100}
                    placeholder="Fee (₹)"
                    value={fee}
                    onChange={(e) => setFee(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                  >
                    Create Doctor Account
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

export function AdminAppointmentsPage() {
  const [appointments, setAppointments] = useState<AdminAppointmentRow[]>([]);
  const [status, setStatus] = useState('ALL');

  useEffect(() => {
    const qs = status === 'ALL' ? '' : `?status=${status}`;
    apiRequest<{ appointments: AdminAppointmentRow[] }>(`/api/appointments${qs}`).then((res) =>
      setAppointments(res.appointments),
    );
  }, [status]);

  return (
    <PortalLayout title="Clinic-Wide Appointments" breadcrumb="Admin Portal / Appointments">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {['ALL', 'REQUESTED', 'APPROVED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setStatus(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                status === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Physician</th>
                  <th className="py-3 px-4">Scheduled (IST)</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 px-4 font-medium text-slate-900">{a.patient_name}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {a.doctor_name} ·{' '}
                      <span className="text-xs text-slate-500">{a.doctor_specialization}</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono-tabular text-slate-600">
                      {formatIstDateTime(a.scheduled_start)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{a.reason}</td>
                    <td className="py-3 px-4">
                      <AppointmentStatusLabel status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);

  useEffect(() => {
    apiRequest<{ logs: AuditLogRow[] }>('/api/admin/audit-logs').then((res) => setLogs(res.logs));
  }, []);

  return (
    <PortalLayout title="Operational Audit Trail" breadcrumb="Admin Portal / Audit Logs">
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-teal-700 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Least-Privilege Medical Data Isolation</p>
            <p className="text-xs text-slate-600 mt-1">
              Administrators can inspect operational audit logs and manage user activation, but are
              programmatically blocked (<span className="font-mono-tabular">403 Forbidden</span>)
              from browsing or downloading private patient medical report contents.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Timestamp (IST)</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-3 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatIstDateTime(log.created_at)}
                    </td>
                    <td className="py-3 px-4 text-slate-800">
                      {log.actor_name || 'Scheduler Worker'} ({log.actor_role || 'SYSTEM'})
                    </td>
                    <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-600">
                      {log.resource_type} · {log.resource_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
