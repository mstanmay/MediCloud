# MediCloud Firestore Security Specification

## 1. Data Invariants
1. No user may self-assign `DOCTOR` or `ADMIN` roles on registration (`users/{userId}` creation is locked to `PATIENT` unless created by a verified Admin).
2. Sensitive PII (`email`, `phone`) is isolated in `users/{userId}/private/{docId}` and is readable only by the owner or verified Admin.
3. Patients can only read and update their own `patients/{patientId}` profile (`userId == request.auth.uid`).
4. Appointments may only be read by the participating `patientUid`, participating `doctorUid`, or an `Admin`. Terminal states (`COMPLETED`, `CANCELLED`, `REJECTED`) cannot be reverted by non-admin users.
5. Medical records may only be read by the owning `patientUid`, the uploading `uploadedByDoctorUid`, or an authorized doctor holding an active sharing permission. Admins do not get blanket access to patient medical records.
6. Audit logs are append-only (`update` and `delete` are forbidden for everyone).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Self-Role Escalation on Create**: Patient creates `/users/{uid}` with `role: "ADMIN"`.
2. **Ghost Field Injection (Shadow Update)**: User updates `/users/{uid}` adding `isSuperAdmin: true`.
3. **Unverified Email Write**: Authenticated token with `email_verified: false` attempts write to `/patients/{id}`.
4. **Cross-Patient Record Read**: Patient A requests `get` on `/medicalRecords/{recordB}` owned by Patient B.
5. **Cross-Patient Appointment List**: Patient A attempts unscoped `list` on `/appointments` without `patientUid == auth.uid`.
6. **ID Poisoning**: Attacker writes `/appointments/<1500-char-invalid-id>` containing spaces or slashes.
7. **PII Blanket Read**: Signed-in non-owner reads `/users/{otherUid}/private/info`.
8. **Doctor Spoofing on Availability**: Non-doctor creates `/doctorAvailability/{id}` with `doctorUid` of another doctor.
9. **Terminal Appointment Mutation**: Patient tries to change `status` from `COMPLETED` back to `APPROVED`.
10. **Admin Medical Record Snooping**: Admin attempts `get` on `/medicalRecords/{recordId}` directly.
11. **Audit Log Tampering**: Any user attempts `update` or `delete` on `/auditLogs/{logId}`.
12. **Consent Hijacking**: Doctor creates `/recordSharingPermissions/{id}` granting themselves access (`patientUid != request.auth.uid`).
