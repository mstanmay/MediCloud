export type UserRole = 'PATIENT' | 'DOCTOR' | 'ADMIN';

export type AppointmentStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'NO_SHOW';

export const CLINIC_TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30

export const ALLOWED_REPORT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedReportMimeType = (typeof ALLOWED_REPORT_MIME_TYPES)[number];

export const MAX_REPORT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface TimeInterval {
  scheduledStart: string;
  scheduledEnd: string;
  status: AppointmentStatus;
}

export interface AvailabilityRule {
  dayOfWeek: number;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  slotDurationMinutes: number;
  isAvailable: boolean;
}

const ACTIVE_OCCUPYING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'REQUESTED',
  'APPROVED',
  'RESCHEDULED',
]);

export function hasAppointmentOverlap(
  candidateStartIso: string,
  candidateEndIso: string,
  existingAppointments: ReadonlyArray<TimeInterval>,
): boolean {
  const startA = Date.parse(candidateStartIso);
  const endA = Date.parse(candidateEndIso);
  if (!Number.isFinite(startA) || !Number.isFinite(endA) || endA <= startA) {
    return true;
  }

  return existingAppointments.some((appt) => {
    if (!ACTIVE_OCCUPYING_STATUSES.has(appt.status)) {
      return false;
    }
    const startB = Date.parse(appt.scheduledStart);
    const endB = Date.parse(appt.scheduledEnd);
    return startA < endB && endA > startB;
  });
}

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, ReadonlyArray<AppointmentStatus>> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED', 'RESCHEDULED'],
  APPROVED: ['COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'],
  RESCHEDULED: ['APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransitionAppointmentStatus(
  from: AppointmentStatus,
  to: AppointmentStatus,
  actorRole: UserRole,
): boolean {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return false;
  }
  if (actorRole === 'PATIENT') {
    return to === 'CANCELLED' || to === 'RESCHEDULED';
  }
  if (actorRole === 'DOCTOR') {
    return ['APPROVED', 'REJECTED', 'COMPLETED', 'NO_SHOW'].includes(to);
  }
  return actorRole === 'ADMIN';
}

export function getIstDayOfWeek(dateYmd: string): number {
  const [year, month, day] = dateYmd.split('-').map(Number);
  if (!year || !month || !day) return -1;
  // Construct UTC midnight for that IST calendar date
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return utcDate.getUTCDay();
}

export function istDateTimeToIso(dateYmd: string, timeHm: string): string {
  // Explicitly encode Asia/Kolkata (+05:30) and normalize to ISO UTC string
  const parsed = new Date(`${dateYmd}T${timeHm}:00+05:30`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid IST date/time: ${dateYmd} ${timeHm}`);
  }
  return parsed.toISOString();
}

export interface GeneratedSlot {
  startIso: string;
  endIso: string;
  labelIst: string;
  isBooked: boolean;
}

export function generateAvailableSlotsForDate(
  dateYmd: string,
  rules: ReadonlyArray<AvailabilityRule>,
  existingAppointments: ReadonlyArray<TimeInterval>,
  nowMs: number = Date.now(),
): GeneratedSlot[] {
  const dayOfWeek = getIstDayOfWeek(dateYmd);
  if (dayOfWeek < 0) return [];

  const matchingRules = rules.filter((r) => r.isAvailable && r.dayOfWeek === dayOfWeek);
  const slots: GeneratedSlot[] = [];

  for (const rule of matchingRules) {
    const [startH, startM] = rule.startTime.split(':').map(Number);
    const [endH, endM] = rule.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const duration = Math.max(10, rule.slotDurationMinutes);

    for (let m = startMinutes; m + duration <= endMinutes; m += duration) {
      const sh = String(Math.floor(m / 60)).padStart(2, '0');
      const sm = String(m % 60).padStart(2, '0');
      const eh = String(Math.floor((m + duration) / 60)).padStart(2, '0');
      const em = String((m + duration) % 60).padStart(2, '0');

      const startIso = istDateTimeToIso(dateYmd, `${sh}:${sm}`);
      const endIso = istDateTimeToIso(dateYmd, `${eh}:${em}`);
      const startMs = Date.parse(startIso);
      if (startMs <= nowMs) {
        continue;
      }

      const isBooked = hasAppointmentOverlap(startIso, endIso, existingAppointments);
      slots.push({
        startIso,
        endIso,
        labelIst: `${sh}:${sm} – ${eh}:${em} IST`,
        isBooked,
      });
    }
  }

  return slots.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

export function detectFileMimeFromBytes(bytes: Uint8Array): AllowedReportMimeType | null {
  if (bytes.length < 4) return null;
  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export function isSharingPermissionActive(
  permission: { isActive: boolean; revokedAt: string | null; expiresAt: string },
  nowMs: number = Date.now(),
): boolean {
  if (!permission.isActive || permission.revokedAt) {
    return false;
  }
  const expiresMs = Date.parse(permission.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

export function formatIstDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: CLINIC_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function getTodayIstYmd(nowMs: number = Date.now()): string {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
