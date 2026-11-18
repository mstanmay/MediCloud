import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionAppointmentStatus,
  detectFileMimeFromBytes,
  generateAvailableSlotsForDate,
  hasAppointmentOverlap,
  isSharingPermissionActive,
  istDateTimeToIso,
} from './clinicRules';

test('hasAppointmentOverlap detects overlapping active slots and ignores cancelled slots', () => {
  const existing = [
    {
      scheduledStart: istDateTimeToIso('2026-12-01', '10:00'),
      scheduledEnd: istDateTimeToIso('2026-12-01', '10:30'),
      status: 'APPROVED' as const,
    },
    {
      scheduledStart: istDateTimeToIso('2026-12-01', '11:00'),
      scheduledEnd: istDateTimeToIso('2026-12-01', '11:30'),
      status: 'CANCELLED' as const,
    },
  ];

  // Overlaps 10:00-10:30
  assert.equal(
    hasAppointmentOverlap(
      istDateTimeToIso('2026-12-01', '10:15'),
      istDateTimeToIso('2026-12-01', '10:45'),
      existing,
    ),
    true,
  );

  // Adjacent 10:30-11:00 does not overlap
  assert.equal(
    hasAppointmentOverlap(
      istDateTimeToIso('2026-12-01', '10:30'),
      istDateTimeToIso('2026-12-01', '11:00'),
      existing,
    ),
    false,
  );

  // Cancelled slot 11:00-11:30 is open for rebooking
  assert.equal(
    hasAppointmentOverlap(
      istDateTimeToIso('2026-12-01', '11:00'),
      istDateTimeToIso('2026-12-01', '11:30'),
      existing,
    ),
    false,
  );
});

test('canTransitionAppointmentStatus enforces role permissions and terminal states', () => {
  assert.equal(canTransitionAppointmentStatus('REQUESTED', 'APPROVED', 'DOCTOR'), true);
  assert.equal(canTransitionAppointmentStatus('REQUESTED', 'APPROVED', 'PATIENT'), false);
  assert.equal(canTransitionAppointmentStatus('REQUESTED', 'CANCELLED', 'PATIENT'), true);
  assert.equal(canTransitionAppointmentStatus('COMPLETED', 'CANCELLED', 'DOCTOR'), false);
  assert.equal(canTransitionAppointmentStatus('COMPLETED', 'APPROVED', 'ADMIN'), false);
});

test('generateAvailableSlotsForDate marks booked slots in Asia/Kolkata', () => {
  // 2026-12-01 is Tuesday (dayOfWeek = 2)
  const rules = [
    {
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '10:30',
      slotDurationMinutes: 30,
      isAvailable: true,
    },
  ];
  const existing = [
    {
      scheduledStart: istDateTimeToIso('2026-12-01', '09:30'),
      scheduledEnd: istDateTimeToIso('2026-12-01', '10:00'),
      status: 'APPROVED' as const,
    },
  ];
  const fixedNow = Date.parse('2026-11-30T00:00:00Z');
  const slots = generateAvailableSlotsForDate('2026-12-01', rules, existing, fixedNow);
  assert.equal(slots.length, 3);
  assert.equal(slots[0].labelIst, '09:00 – 09:30 IST');
  assert.equal(slots[0].isBooked, false);
  assert.equal(slots[1].labelIst, '09:30 – 10:00 IST');
  assert.equal(slots[1].isBooked, true);
  assert.equal(slots[2].labelIst, '10:00 – 10:30 IST');
  assert.equal(slots[2].isBooked, false);
});

test('detectFileMimeFromBytes inspects magic bytes rather than trusting extensions', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const spoofedExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

  assert.equal(detectFileMimeFromBytes(pdfBytes), 'application/pdf');
  assert.equal(detectFileMimeFromBytes(pngBytes), 'image/png');
  assert.equal(detectFileMimeFromBytes(jpegBytes), 'image/jpeg');
  assert.equal(detectFileMimeFromBytes(spoofedExeBytes), null);
});

test('isSharingPermissionActive honors revocation and expiration timestamps', () => {
  const future = '2026-12-30T00:00:00.000Z';
  const past = '2026-10-01T00:00:00.000Z';
  const now = Date.parse('2026-11-18T12:00:00.000Z');

  assert.equal(
    isSharingPermissionActive({ isActive: true, revokedAt: null, expiresAt: future }, now),
    true,
  );
  assert.equal(
    isSharingPermissionActive({ isActive: false, revokedAt: '2026-11-10T00:00:00Z', expiresAt: future }, now),
    false,
  );
  assert.equal(
    isSharingPermissionActive({ isActive: true, revokedAt: null, expiresAt: past }, now),
    false,
  );
});
