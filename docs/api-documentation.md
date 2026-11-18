# MediCloud REST API Documentation

Base URL: `/api` (Cookie `medicloud_session` or `Authorization: Bearer <jwt>`)

## Authentication
- `POST /api/auth/register` — Register a new Patient account (`fullName`, `email`, `password`, optional demographics).
- `POST /api/auth/login` — Authenticate Patient, Doctor, or Admin; sets `httpOnly` session cookie.
- `POST /api/auth/logout` — Clear session cookie.
- `GET /api/auth/me` — Return current authenticated user and role profile.

## Doctors & Patients
- `GET /api/doctors?q=&specialization=` — Public active doctor directory with search and specialization filters.
- `GET /api/doctors/:id` — Doctor details + weekly availability rules.
- `GET /api/doctors/:id/slots?date=YYYY-MM-DD` — Computed 30-minute open/booked intervals in `Asia/Kolkata`.
- `POST /api/doctors` *(Admin only)* — Onboard a new verified doctor account.
- `PUT /api/doctors/:id` *(Doctor self or Admin)* — Update professional profile.
- `PUT /api/doctors/:id/availability` *(Doctor self or Admin)* — Replace weekly availability schedule.
- `GET /api/patients` *(Doctor: assigned/consented only; Admin: all)* — List authorized patients.
- `GET /api/patients/:id` — Fetch single patient profile with ownership/relationship verification.
- `PUT /api/patients/:id` *(Patient self or Admin)* — Update patient demographics & emergency contact.

## Appointments
- `POST /api/appointments` *(Patient only)* — Book appointment slot inside a database transaction (`409` on overlap).
- `GET /api/appointments?status=` — Role-scoped appointment list.
- `GET /api/appointments/:id` — Single appointment detail with participant check.
- `PATCH /api/appointments/:id/status` — Transition status (`APPROVED`, `REJECTED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) with state-machine validation.
- `PATCH /api/appointments/:id/reschedule` — Move appointment to a new conflict-free slot (`RESCHEDULED`).
- `DELETE /api/appointments/:id` — Cancel an active appointment.

## Medical Records & Consent Sharing
- `POST /api/medical-records/upload-url` *(Doctor only)* — Verify patient authorization and issue short-lived S3/vault PUT URL.
- `POST /api/medical-records/confirm-upload` *(Doctor only)* — Verify stored object & save metadata row.
- `GET /api/medical-records` *(Patient or Doctor; `403` for Admin)* — List authorized medical reports.
- `GET /api/medical-records/:id/download-url` *(Patient owner, uploader Doctor, or consented Doctor; `403` for Admin)* — Issue time-limited signed download URL & log access.
- `GET /api/medical-records/:id/access-history` *(Patient owner)* — View audit events for a specific report.
- `GET /api/sharing` / `POST /api/sharing` / `PATCH /api/sharing/:id/revoke` — Grant and revoke time-bound report access.

## Notifications, Dashboards & Operations
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`
- `GET /api/dashboard/patient`, `GET /api/dashboard/doctor`, `GET /api/dashboard/admin`
- `GET /api/admin/users`, `PATCH /api/admin/users/:id/status`, `GET /api/admin/audit-logs`, `POST /api/admin/run-reminders`
- `GET /api/health` — Liveness probe.
