import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileUp } from 'lucide-react';
import { PortalLayout } from '../layouts/PortalLayout';
import { AppointmentStatusLabel } from '../components/StatusText';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  ALLOWED_REPORT_MIME_TYPES,
  MAX_REPORT_SIZE_BYTES,
  formatIstDateTime,
} from '../shared/clinicRules';

interface DoctorAppointmentRow {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_blood_group: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  reason: string;
  consultation_notes: string | null;
}

interface AuthorizedPatientRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  blood_group: string | null;
  allergies: string | null;
  date_of_birth: string | null;
}

interface DoctorRecordRow {
  id: string;
  patient_name: string;
  title: string;
  category: string;
  file_name: string;
  file_size_bytes: number;
  access_source: string;
  created_at: string;
}

export function DoctorDashboardPage() {
  const [data, setData] = useState<{
    profile: Record<string, unknown>;
    appointments: DoctorAppointmentRow[];
    authorizedPatientsCount: number;
    uploadedRecordsCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<typeof data>('/api/dashboard/doctor')
      .then((res) => setData(res))
      .finally(() => setLoading(false));
  }, []);

  const pending = (data?.appointments || []).filter(
    (a) => a.status === 'REQUESTED' || a.status === 'RESCHEDULED',
  );
  const approved = (data?.appointments || []).filter((a) => a.status === 'APPROVED');

  return (
    <PortalLayout title="Physician Overview" breadcrumb="Doctor Portal / Overview">
      {loading ? (
        <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Loading clinical schedule...
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Pending Requests</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {pending.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Approved Visits</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {approved.length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Authorized Patients</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.authorizedPatientsCount ?? 0}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-slate-500">Reports Uploaded</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono-tabular">
                {data?.uploadedRecordsCount ?? 0}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Pending Approval Queue</h2>
                <Link
                  to="/doctor/appointments"
                  className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                  Manage Queue →
                </Link>
              </div>
              {pending.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No pending appointment requests.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pending.map((a) => (
                    <div key={a.id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{a.patient_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{a.reason}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono-tabular text-slate-700">
                          {formatIstDateTime(a.scheduled_start)} IST
                        </p>
                        <AppointmentStatusLabel status={a.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Approved Schedule</h2>
                <Link
                  to="/doctor/patients"
                  className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                >
                  Upload Report →
                </Link>
              </div>
              {approved.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No approved visits scheduled.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {approved.map((a) => (
                    <div key={a.id} className="px-6 py-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{a.patient_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{a.reason}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono-tabular text-slate-700">
                          {formatIstDateTime(a.scheduled_start)} IST
                        </p>
                        <AppointmentStatusLabel status={a.status} />
                      </div>
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

export function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = useState<DoctorAppointmentRow[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notesModal, setNotesModal] = useState<{
    appt: DoctorAppointmentRow;
    targetStatus: 'COMPLETED' | 'APPROVED' | 'NO_SHOW';
  } | null>(null);
  const [notesText, setNotesText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'ALL' ? '' : `?status=${filter}`;
      const res = await apiRequest<{ appointments: DoctorAppointmentRow[] }>(
        `/api/appointments${qs}`,
      );
      setAppointments(res.appointments);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (id: string, status: string, consultationNotes?: string) => {
    setFeedback(null);
    try {
      await apiRequest(`/api/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, consultationNotes }),
      });
      setFeedback(`Appointment updated to ${status}.`);
      setNotesModal(null);
      setNotesText('');
      void load();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  return (
    <PortalLayout title="Appointment Management" breadcrumb="Doctor Portal / Appointments">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {['ALL', 'REQUESTED', 'RESCHEDULED', 'APPROVED', 'COMPLETED', 'REJECTED'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filter === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
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
            <p className="p-8 text-sm text-slate-500 text-center">No appointments in this queue.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Scheduled (IST)</th>
                    <th className="py-3 px-4">Reason &amp; Notes</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {appointments.map((appt) => (
                    <tr key={appt.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-900">{appt.patient_name}</p>
                        <p className="text-xs text-slate-500">
                          Blood: {appt.patient_blood_group || 'N/A'}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono-tabular text-slate-700 whitespace-nowrap">
                        {formatIstDateTime(appt.scheduled_start)}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-slate-800">{appt.reason}</p>
                        {appt.consultation_notes && (
                          <p className="text-xs text-slate-500 mt-1">
                            Notes: {appt.consultation_notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <AppointmentStatusLabel status={appt.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {(appt.status === 'REQUESTED' || appt.status === 'RESCHEDULED') && (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void transition(appt.id, 'APPROVED')}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void transition(appt.id, 'REJECTED')}
                              className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {appt.status === 'APPROVED' && (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNotesModal({ appt, targetStatus: 'COMPLETED' });
                                setNotesText(appt.consultation_notes || '');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md"
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              onClick={() => void transition(appt.id, 'NO_SHOW')}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                            >
                              No-show
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {notesModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Complete consultation with notes"
              className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
            >
              <h2 className="text-base font-semibold text-slate-900">
                Complete Consultation — {notesModal.appt.patient_name}
              </h2>
              <div>
                <label htmlFor="consult-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                  Consultation Notes
                </label>
                <textarea
                  id="consult-notes"
                  rows={4}
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Clinical observations, prescribed follow-up..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNotesModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void transition(notesModal.appt.id, notesModal.targetStatus, notesText)
                  }
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  Save &amp; Complete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export function DoctorPatientsAndUploadPage() {
  const [patients, setPatients] = useState<AuthorizedPatientRow[]>([]);
  const [records, setRecords] = useState<DoctorRecordRow[]>([]);
  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Diagnostic Lab');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    const [patRes, recRes] = await Promise.all([
      apiRequest<{ patients: AuthorizedPatientRow[] }>('/api/patients'),
      apiRequest<{ records: DoctorRecordRow[] }>('/api/medical-records'),
    ]);
    setPatients(patRes.patients);
    setRecords(recRes.records);
    if (patRes.patients[0]) {
      setPatientId((prev) => prev || patRes.patients[0].id);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (!patientId || !file || title.trim().length < 2) {
      setStatusMsg({
        type: 'err',
        text: 'Select an authorized patient, provide a report title, and attach a PDF/JPEG/PNG file.',
      });
      return;
    }

    if (!(ALLOWED_REPORT_MIME_TYPES as readonly string[]).includes(file.type)) {
      setStatusMsg({
        type: 'err',
        text: 'Unsupported file type. Only PDF, JPEG, and PNG reports are permitted.',
      });
      return;
    }
    if (file.size > MAX_REPORT_SIZE_BYTES) {
      setStatusMsg({ type: 'err', text: 'File exceeds the 10 MB maximum upload limit.' });
      return;
    }

    setUploading(true);
    try {
      // Step 1: Request presigned upload grant
      const grant = await apiRequest<{
        storageKey: string;
        uploadUrl: string;
      }>('/api/medical-records/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
        }),
      });

      // Step 2: Upload raw bytes directly to private storage endpoint
      const putRes = await fetch(grant.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        const errJson = (await putRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || 'Private object storage upload failed.');
      }

      // Step 3: Confirm upload & persist metadata
      await apiRequest('/api/medical-records/confirm-upload', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          title: title.trim(),
          category,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          storageKey: grant.storageKey,
          notes: notes.trim(),
        }),
      });

      setStatusMsg({ type: 'ok', text: `Uploaded "${title}" securely to patient vault.` });
      setTitle('');
      setNotes('');
      setFile(null);
      void loadAll();
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Report upload failed.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (recId: string, fileName: string) => {
    try {
      const grant = await apiRequest<{ downloadUrl: string }>(
        `/api/medical-records/${recId}/download-url`,
      );
      const a = document.createElement('a');
      a.href = grant.downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Download failed.',
      });
    }
  };

  return (
    <PortalLayout title="Authorized Patients & Medical Reports" breadcrumb="Doctor Portal / Patients">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Upload Report Form */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 h-fit">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2 mb-4">
            <FileUp className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span>Upload Medical Report</span>
          </h2>

          {statusMsg && (
            <div
              role="alert"
              className={`mb-4 p-3 rounded-lg text-xs border ${
                statusMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label htmlFor="up-patient" className="block text-xs font-semibold text-slate-700 mb-1">
                Authorized Patient
              </label>
              <select
                id="up-patient"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.blood_group || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="up-title" className="block text-xs font-semibold text-slate-700 mb-1">
                Report Title
              </label>
              <input
                id="up-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Echocardiogram Summary"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="up-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                Category
              </label>
              <select
                id="up-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="Diagnostic Lab">Diagnostic Lab</option>
                <option value="Cardiology Lab">Cardiology Lab</option>
                <option value="Radiology / Imaging">Radiology / Imaging</option>
                <option value="Prescription Summary">Prescription Summary</option>
              </select>
            </div>

            <div>
              <label htmlFor="up-file" className="block text-xs font-semibold text-slate-700 mb-1">
                Report File (PDF, JPEG, PNG · max 10 MB)
              </label>
              <input
                id="up-file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-800 hover:file:bg-slate-200"
              />
            </div>

            <div>
              <label htmlFor="up-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                Clinical Notes
              </label>
              <textarea
                id="up-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional interpretation notes..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={uploading || patients.length === 0}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
            >
              {uploading ? 'Encrypting & Uploading...' : 'Upload to Private Vault'}
            </button>
          </form>
        </section>

        {/* Authorized Patients & Accessible Reports */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Authorized Patients</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Scoped strictly to patients with appointments or active consent grants.
              </p>
            </div>
            {patients.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No assigned patients yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {patients.map((p) => (
                  <div key={p.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{p.full_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Blood: {p.blood_group || 'N/A'} · Allergies: {p.allergies || 'None'}
                      </p>
                    </div>
                    <span className="text-xs font-mono-tabular text-slate-500">{p.phone || p.email}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Accessible Patient Reports</h2>
            </div>
            {records.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No reports uploaded or shared yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {records.map((r) => (
                  <div key={r.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.patient_name} · {r.category} ·{' '}
                        {r.access_source === 'SHARED_CONSENT' ? 'Shared via Consent' : 'Uploaded by You'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDownload(r.id, r.file_name)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PortalLayout>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function DoctorAvailabilityPage() {
  const { user } = useAuth();
  const doctorId = user?.doctorProfile?.id;
  const [rules, setRules] = useState<
    Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      slotDurationMinutes: number;
      isAvailable: boolean;
    }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!doctorId) return;
    apiRequest<{
      availability: Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        slotDurationMinutes: number;
        isAvailable: boolean;
      }>;
    }>(`/api/doctors/${doctorId}`).then((res) => setRules(res.availability));
  }, [doctorId]);

  const handleSave = async () => {
    if (!doctorId) return;
    setSaving(true);
    setMsg(null);
    try {
      await apiRequest(`/api/doctors/${doctorId}/availability`, {
        method: 'PUT',
        body: JSON.stringify({ rules }),
      });
      setMsg('Consultation schedule updated in Asia/Kolkata (IST).');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout title="Availability Schedule (IST)" breadcrumb="Doctor Portal / Availability">
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Manage your weekly consultation windows in Asia/Kolkata (IST).
          </p>
          <button
            type="button"
            onClick={() =>
              setRules((prev) => [
                ...prev,
                { dayOfWeek: 1, startTime: '09:30', endTime: '12:30', slotDurationMinutes: 30, isAvailable: true },
              ])
            }
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
          >
            Add Window
          </button>
        </div>

        {msg && (
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
            {msg}
          </div>
        )}

        <div className="space-y-3">
          {rules.map((rule, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center p-3 border border-slate-200 rounded-lg"
            >
              <select
                aria-label="Day of week"
                value={rule.dayOfWeek}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, dayOfWeek: v } : r)));
                }}
                className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
              >
                {DAY_NAMES.map((name, dayIdx) => (
                  <option key={name} value={dayIdx}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Start time"
                type="time"
                value={rule.startTime}
                onChange={(e) => {
                  const v = e.target.value;
                  setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, startTime: v } : r)));
                }}
                className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md font-mono-tabular"
              />
              <input
                aria-label="End time"
                type="time"
                value={rule.endTime}
                onChange={(e) => {
                  const v = e.target.value;
                  setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, endTime: v } : r)));
                }}
                className="px-2.5 py-1.5 text-sm border border-slate-300 rounded-md font-mono-tabular"
              />
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={rule.isAvailable}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setRules((prev) =>
                      prev.map((r, i) => (i === idx ? { ...r, isAvailable: v } : r)),
                    );
                  }}
                />
                <span>Active</span>
              </label>
              <button
                type="button"
                onClick={() => setRules((prev) => prev.filter((_, i) => i !== idx))}
                className="text-xs font-medium text-rose-700 hover:text-rose-800 text-right"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
        >
          {saving ? 'Saving...' : 'Save Weekly Schedule'}
        </button>
      </div>
    </PortalLayout>
  );
}

export function DoctorProfilePage() {
  const { user, refreshUser } = useAuth();
  const doc = user?.doctorProfile;
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [consultationFee, setConsultationFee] = useState(doc?.consultation_fee || 900);
  const [experienceYears, setExperienceYears] = useState(doc?.experience_years || 5);
  const [bio, setBio] = useState(doc?.bio || '');
  const [msg, setMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc?.id) return;
    await apiRequest(`/api/doctors/${doc.id}`, {
      method: 'PUT',
      body: JSON.stringify({ fullName, phone, consultationFee, experienceYears, bio }),
    });
    await refreshUser();
    setMsg('Professional profile updated.');
  };

  return (
    <PortalLayout title="Physician Profile" breadcrumb="Doctor Portal / Profile">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-2xl">
        {msg && (
          <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
            {msg}
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="doc-prof-name" className="block text-sm font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="doc-prof-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="doc-prof-phone" className="block text-sm font-medium text-slate-700 mb-1">
                Phone
              </label>
              <input
                id="doc-prof-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="font-medium text-slate-700 mb-1">Specialization</p>
              <p className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
                {doc?.specialization}
              </p>
            </div>
            <div>
              <label htmlFor="doc-prof-exp" className="block font-medium text-slate-700 mb-1">
                Experience (yrs)
              </label>
              <input
                id="doc-prof-exp"
                type="number"
                value={experienceYears}
                onChange={(e) => setExperienceYears(Number(e.target.value))}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="doc-prof-fee" className="block font-medium text-slate-700 mb-1">
                Consultation Fee (₹)
              </label>
              <input
                id="doc-prof-fee"
                type="number"
                value={consultationFee}
                onChange={(e) => setConsultationFee(Number(e.target.value))}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label htmlFor="doc-prof-bio" className="block text-sm font-medium text-slate-700 mb-1">
              Professional Bio
            </label>
            <textarea
              id="doc-prof-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
          >
            Save Profile
          </button>
        </form>
      </div>
    </PortalLayout>
  );
}
