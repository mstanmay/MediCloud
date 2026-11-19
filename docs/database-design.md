# MediCloud Database Design & Entity Relationships

## 1. Entity-Relationship Diagram

```
[users] 1 --- 0..1 [patients] 1 --- * [appointments] * --- 1 [doctors] 1 --- 0..1 [users]
   |                   |                    |                   |
   |                   +--- * [medical_records] * --------------+
   |                                 |                          |
   |                                 +--- * [record_sharing_permissions] * ---+
   |                                                            |
   +--- * [notifications]                                       +--- * [doctor_availability]
   |
   +--- * [audit_logs]
```

## 2. Tables & Key Constraints
1. **`users`**: Primary authentication & role registry (`PATIENT`, `DOCTOR`, `ADMIN`). Enforces `UNIQUE(email)` and stores bcrypt password hashes only.
2. **`patients`**: Clinical baseline profile (`blood_group`, `allergies`, `emergency_contact`, `date_of_birth`), 1:1 with `users`.
3. **`doctors`**: Specialist directory (`specialization`, `department`, `license_number` unique, `consultation_fee`), 1:1 with `users`.
4. **`doctor_availability`**: Weekly recurring consultation windows (`day_of_week`, `start_time`, `end_time`, `slot_duration_minutes`).
5. **`appointments`**: Links `patient_id` and `doctor_id` with `scheduled_start`, `scheduled_end`, `timezone = 'Asia/Kolkata'`, `status`, `consultation_notes`, and `reminder_sent_at`. Indexed on `(doctor_id, scheduled_start)` and `(patient_id, scheduled_start)`.
6. **`medical_records`**: Stores document metadata (`title`, `category`, `mime_type`, `file_size_bytes`, `storage_key` unique, `checksum_sha256`). File bytes live in private object storage (S3 / local vault), never inside relational rows.
7. **`record_sharing_permissions`**: Time-bound consent grants linking `record_id`, `patient_id`, and `doctor_id` with `expires_at`, `revoked_at`, and `is_active`.
8. **`notifications`**: Tracks both `IN_APP` alerts and `EMAIL` (SES) delivery status.
9. **`audit_logs`**: Immutable event stream recording login, registration, appointment mutations, record uploads, download URL issuance, consent grants/revocations, and 24-hour reminder dispatches.

## 3. Production PostgreSQL Schema
See `/prisma/schema.prisma` for the full PostgreSQL Prisma schema designed for AWS RDS deployment, and `/server/db/database.ts` for the live SQLite schema executed inside the workspace runtime.
