# MediCloud — Cloud-Based Patient Monitoring & Healthcare Management System

MediCloud is an academic cloud computing healthcare platform designed to centralize patient medical records, prevent appointment scheduling conflicts, enforce role-based access control, and automate 24-hour pre-visit reminders.

## Key Features
- **Role-Based Portals**: Dedicated workflows for **Patients**, **Doctors**, and **Administrators**.
- **Appointment Engine (`Asia/Kolkata`)**: Weekly doctor availability, live slot generation, transactional overlap protection, and full lifecycle (`REQUESTED` → `APPROVED` → `COMPLETED`, `REJECTED`, `CANCELLED`, `RESCHEDULED`, `NO_SHOW`).
- **Private Medical Report Vault**: Two-step pre-signed upload/download architecture (`PDF`, `JPEG`, `PNG`) with magic-byte verification, SHA-256 checksums, and zero permanent public file URLs.
- **Consent-Based Record Sharing & Access History**: Patients grant time-limited report access to specialists, revoke consent at any time, and inspect access audit trails.
- **Automated 24-Hour Reminder Worker**: Scheduled backend sweep sending idempotent pre-visit reminders without duplicates.

## Synthetic Demo Accounts
All seeded accounts use password `MediCloud@2026` (synthetic academic data only):
- **Patient**: `arjun.mehta@medicloud.demo`
- **Doctor**: `dr.kavya.sharma@medicloud.demo`
- **Administrator**: `admin@medicloud.demo`

## Quick Start
```bash
npm install
npm test
npm run dev
```

## Documentation
- [Architecture Overview](docs/architecture.md)
- [Database Design & ER Diagram](docs/database-design.md)
- [REST API Reference](docs/api-documentation.md)
- [AWS & Vercel Deployment Guide](docs/deployment-guide.md)
- [Test Cases](docs/test-cases.md)
