# MediCloud Deployment Guide (Local, AWS EC2/RDS/S3/SES, and Vercel)

## 1. Implementation Status Transparency
- **Fully Implemented in Workspace**:
  - React + TypeScript + Tailwind frontend (Landing, Auth, Patient/Doctor/Admin portals).
  - Express + TypeScript REST API, bcryptjs, JWT HTTP-only cookies, Zod validation, helmet, rate limiting.
  - Persistent SQLite database (`node:sqlite`) with transactional booking & seed data.
  - Magic-byte verified private file vault + AWS S3 pre-signed URL adapter (`@aws-sdk/client-s3`).
  - Automated 24-hour reminder worker + AWS SES email adapter (`@aws-sdk/client-ses`).
  - Firebase Google Sign-In + Firestore rules (`firestore.rules` deployed in workspace project).
  - Production artifacts: `prisma/schema.prisma`, `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `vercel.json`, `.github/workflows/ci-cd.yml`.
- **Requires Manual Cloud Account Provisioning**:
  - Creating an AWS EC2 instance, AWS RDS PostgreSQL instance, private AWS S3 bucket, AWS SES verified sender, IAM instance profile, and DNS/TLS certificates in your own AWS account.

## 2. Local Development Execution
```bash
npm install
npm test
npm run dev
# Open http://localhost:3000
```

## 3. AWS EC2 + Docker + Nginx Production Deployment
1. Provision an **AWS RDS PostgreSQL** instance inside a private VPC subnet (port `5432` open only to the EC2 security group).
2. Create a private **AWS S3** bucket with Block Public Access enabled and default SSE-S3 encryption.
3. Verify your sender domain/email in **AWS SES** (`ap-south-1` recommended for `Asia/Kolkata` deployments). Note: while in SES sandbox mode, recipient emails must also be verified in SES.
4. Launch an **AWS EC2** Ubuntu instance with an IAM Role attached granting `s3:PutObject`, `s3:GetObject`, `ses:SendEmail`, and CloudWatch log permissions.
5. Install Docker & Docker Compose on EC2, clone the repository into `/opt/medicloud`, create `.env` from `.env.example`, and start containers:
   ```bash
   docker compose build
   docker compose up -d
   ```
6. Configure TLS certificates with Certbot (`certbot --nginx -d your-domain.com`) and verify `https://your-domain.com/api/health`.

## 4. Vercel Hosting Notes
- `vercel.json` is configured for deploying the Vite React SPA (`dist/`). Point frontend API requests to your AWS EC2/ECS HTTPS backend or deploy the Express API on AWS while Vercel serves the static frontend edge bundle.
- Note: **Streamlit** is a Python framework and is not applicable to this TypeScript/React/Node.js codebase.
