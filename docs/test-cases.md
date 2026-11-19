# MediCloud Test Cases & Verification Matrix

| ID | Category | Test Scenario | Expected Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| TC-01 | Unit Logic | Overlapping appointment intervals (`hasAppointmentOverlap`) | Rejects overlapping `REQUESTED`/`APPROVED` slots; allows `CANCELLED` slots | Verified (`src/shared/clinicRules.test.ts`) |
| TC-02 | Unit Logic | Appointment status transitions (`canTransitionAppointmentStatus`) | Enforces role permissions & blocks mutations on `COMPLETED` | Verified (`src/shared/clinicRules.test.ts`) |
| TC-03 | Unit Logic | Magic-byte file validation (`detectFileMimeFromBytes`) | Detects PDF/JPEG/PNG by header bytes; rejects spoofed `.exe` | Verified (`src/shared/clinicRules.test.ts`) |
| TC-04 | Security Rules | Global deny, PII split, least privilege on `medicalRecords` | `firestore.rules` passes ESLint & structural assertions | Verified (`firestore.rules.test.ts`) |
| TC-05 | Functional | Patient registration & login | Creates account, issues HTTP-only cookie, sends welcome notification | Verified via API & Browser |
| TC-06 | Functional | Patient books doctor slot (`Asia/Kolkata`) | Booking created (`REQUESTED`), slot marked booked | Verified via Browser |
| TC-07 | Security | Cross-patient record isolation | Patient B requesting Patient A download URL receives `403` | Verified via API |
| TC-08 | Security | Admin least-privilege isolation | Admin requesting `/api/medical-records` receives `403` | Verified via API |
| TC-09 | Functional | Doctor approves visit & uploads PDF report | Status becomes `APPROVED`; report validated & visible to Patient | Verified via Browser |
| TC-10 | Functional | Consent sharing & revocation | Patient grants 14-day share, then revokes; active flag drops to 0 | Verified via Browser |
