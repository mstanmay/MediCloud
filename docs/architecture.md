# MediCloud Cloud & System Architecture

## 1. Architectural Overview
MediCloud is a layered, containerized healthcare management application built with a React + TypeScript SPA frontend, an Express + TypeScript REST API backend, a persistent SQLite runtime database for immediate local/sandbox execution alongside a PostgreSQL Prisma schema (`prisma/schema.prisma`) for AWS RDS production, Firebase Firestore cloud sync for Google-authenticated sessions, and pluggable AWS S3 + AWS SES adapters.

```
+-------------------------------------------------------------------+
|                        End Users (Browser)                        |
|        Patient Portal  |  Doctor Portal  |  Admin Console         |
+-------------------------------------------------------------------+
                                 |
                           HTTPS (443)
                                 v
+-------------------------------------------------------------------+
|                Nginx Reverse Proxy (AWS EC2 / VPC)                |
+-------------------------------------------------------------------+
                                 |
                           HTTP (3000)
                                 v
+-------------------------------------------------------------------+
|         MediCloud Express Server + 24h Reminder Worker            |
|  - JWT Cookie / Bearer Auth + bcryptjs Password Hashing           |
|  - RBAC Middleware (PATIENT / DOCTOR / ADMIN)                     |
|  - Appointment Conflict Engine (Asia/Kolkata IST)                 |
|  - Magic-Byte File Validator (PDF / JPEG / PNG)                   |
|  - Rate Limiter & Helmet Security Headers                         |
+-------------------------------------------------------------------+
         |                       |                        |
         v                       v                        v
+-----------------+     +------------------+     +------------------+
| Relational DB   |     | Object Storage   |     | Notifications    |
| - AWS RDS PG    |     | - AWS S3 Private |     | - AWS SES Email  |
| - SQLite Dev    |     | - Pre-signed URL |     | - In-App Alerts  |
+-----------------+     +------------------+     +------------------+
         |
         v
+-------------------------------------------------------------------+
|               Firebase Auth & Cloud Firestore (Optional)          |
|        Protected by Eight-Pillar Security Rules (firestore.rules) |
+-------------------------------------------------------------------+
```

## 2. AWS Infrastructure & Networking Design
- **VPC**: Public subnets host the Application Load Balancer / EC2 Nginx reverse proxy (`ports 80, 443`). Private subnets host AWS RDS PostgreSQL (`port 5432`, accessible strictly from the EC2 security group).
- **AWS S3**: Private bucket with Block Public Access enabled, SSE-S3/KMS encryption at rest, and short-lived pre-signed PUT/GET URLs generated only after backend ownership verification.
- **AWS SES**: Verified domain/sender identity for registration, booking, status updates, and automated 24-hour pre-visit reminders. (Sandbox accounts must verify recipient addresses before moving to production access.)
- **AWS IAM & CloudWatch**: EC2 instance profile grants least-privilege `s3:PutObject`, `s3:GetObject`, `ses:SendEmail`, and `logs:PutLogEvents` without embedding static IAM credentials in code.
