# MattrMindr — Pilot Deployment Setup Guide

This guide walks through setting up a new MattrMindr pilot deployment (e.g., `andycitrin.mattrmindr.com`) from a cloned Repl.

---

## Prerequisites

- A cloned copy of the MattrMindr Repl
- Access to the AWS Console (Aurora, S3, IAM)
- A SendGrid account with domain authentication
- A Twilio account (for SMS/voice features)
- A Microsoft Azure AD app registration (for Microsoft 365 integration)
- An ONLYOFFICE DocSpace instance (for collaborative document editing)
- DNS management for the pilot's custom domain

---

## 1. Database (Aurora PostgreSQL)

### Option A: Shared Aurora Cluster (Recommended for Pilots)

Create a new database on the existing Aurora cluster:

```bash
psql "postgresql://admin:PASSWORD@your-cluster.cluster-abc123.us-east-1.rds.amazonaws.com:5432/postgres"
CREATE DATABASE pilot_firmname;
```

### Option B: Dedicated Aurora Cluster

Follow the steps in `AWS-RDS-MIGRATION-GUIDE.md` to create a new cluster.

### Configure the Secret

Set `DATABASE_URL` as a Replit secret on the cloned Repl:

```
postgresql://admin:PASSWORD@your-cluster.cluster-abc123.us-east-1.rds.amazonaws.com:5432/pilot_firmname
```

If the password contains special characters (e.g., `%`), URL-encode them (e.g., `%25`).

Set `RDS_SSL_CA=./global-bundle.pem` (the certificate file is already in `server/global-bundle.pem`).

### Seed the Admin User

Start the app once — it will run runtime migrations automatically and create tables. Then insert the admin user:

```sql
INSERT INTO users (name, email, password_hash, role)
VALUES ('Admin', 'admin@firmname.com', '$2b$10$HASHED_PASSWORD', 'App Admin');
```

Generate the bcrypt hash with:
```bash
node -e "require('bcrypt').hash('YourPassword', 10).then(h => console.log(h))"
```

---

## 2. AWS S3 (File Storage)

Create an S3 bucket for this pilot's documents:

1. Create bucket: `mattrmindr-pilot-firmname` in your preferred region
2. Create an IAM user with S3 access to this bucket
3. Set these Replit secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (e.g., `us-east-1`)
   - `S3_BUCKET_NAME` (e.g., `mattrmindr-pilot-firmname`)

---

## 3. Application URL & Domain

### Set APP_URL

Set the `APP_URL` Replit secret to the pilot's public URL:

```
APP_URL=https://andycitrin.mattrmindr.com
```

This is used in password-reset emails and other outbound links.

### Set CORS_ORIGINS

Set `CORS_ORIGINS` to allow the custom domain:

```
CORS_ORIGINS=https://andycitrin.mattrmindr.com
```

Multiple origins can be comma-separated.

### DNS / Custom Domain

Configure the custom domain to point to the Replit deployment:
1. In Replit, go to the Deployments tab and add the custom domain
2. Add the required DNS records (CNAME or A record) at your DNS provider
3. Replit will automatically provision an SSL certificate

---

## 4. SendGrid (Email)

### Connect via Replit Integration

MattrMindr uses the Replit SendGrid integration for outbound email. In the cloned Repl:
1. Go to the Integrations panel
2. Connect SendGrid with the pilot's API key and verified sender email

### Inbound Parse (Case Email)

To receive inbound emails at `case-{id}@yourdomain.com`:

1. **Authenticate the domain** in SendGrid → Settings → Sender Authentication → Domain Authentication for the mail domain (e.g., `andycitrin.mattrmindr.com`)
2. **Add MX record**: Point `andycitrin.mattrmindr.com` → `mx.sendgrid.net` (priority 10)
3. **Configure Inbound Parse** in SendGrid → Settings → Inbound Parse:
   - Hostname: `andycitrin.mattrmindr.com`
   - URL: `https://YOUR-REPL-DOMAIN/api/external/inbound-email`
   - Check "POST the raw, full MIME message"
4. **Set the MAIL_DOMAIN secret** on the Repl:
   ```
   MAIL_DOMAIN=andycitrin.mattrmindr.com
   ```
   This controls the email addresses displayed in the UI (e.g., `case-123@andycitrin.mattrmindr.com`).

---

## 5. Twilio (SMS & Voice)

1. **Provision a phone number** in your Twilio Console for this pilot
2. **Configure the webhook** for the number:
   - Messaging webhook: `https://YOUR-REPL-DOMAIN/api/external/sms-webhook` (HTTP POST)
3. **Set Replit secrets**:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER` (e.g., `+12055551234`)

Alternatively, each user can configure their own SMS number through the in-app SMS Settings panel, which stores credentials per-configuration in the database.

---

## 6. Microsoft 365 (OAuth / Calendar / OneDrive)

### Register an Azure AD Application

1. Go to Azure Portal → Azure Active Directory → App registrations → New registration
2. Name: `MattrMindr - FirmName`
3. Redirect URI: `https://andycitrin.mattrmindr.com/api/microsoft/callback` (Web platform)
4. Under API Permissions, add:
   - `Calendars.ReadWrite`
   - `Contacts.ReadWrite`
   - `Files.ReadWrite.All`
   - `User.Read`
5. Create a client secret under Certificates & secrets
6. **Set Replit secrets**:
   - `MS_CLIENT_ID`
   - `MS_CLIENT_SECRET`
   - `MS_TENANT_ID` (use `common` for multi-tenant, or the specific tenant ID)

The Microsoft OAuth flow auto-detects the host from the request, so no additional redirect URI configuration is needed beyond the Azure app registration.

---

## 7. ONLYOFFICE DocSpace

1. **Provision a DocSpace instance** (cloud or self-hosted)
2. **Set Replit secrets**:
   - `ONLYOFFICE_URL` — The DocSpace URL (e.g., `https://firmname.onlyoffice.com`)
   - `ONLYOFFICE_PASSWORD` — Admin password for the DocSpace
   - `ONLYOFFICE_USER` — Admin username (default: `admin`)
   - `ONLYOFFICE_ROOM_ID` — (Optional) Default room ID for document storage

---

## 8. AI Integration

MattrMindr uses OpenAI-compatible APIs for AI features. The credentials are managed via the Replit OpenAI integration:

1. Go to the Integrations panel in the cloned Repl
2. Connect the OpenAI integration
3. The following environment variables will be set automatically:
   - `AI_INTEGRATIONS_OPENAI_API_KEY`
   - `AI_INTEGRATIONS_OPENAI_BASE_URL`

---

## 9. Session Secret

Generate a strong random session secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Set it as the `SESSION_SECRET` Replit secret.

---

## 10. Final Checklist

| Step | Secret(s) | Verified |
|------|-----------|----------|
| Aurora database created and seeded | `DATABASE_URL`, `RDS_SSL_CA` | ☐ |
| S3 bucket created | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME` | ☐ |
| App URL set | `APP_URL` | ☐ |
| CORS origins set | `CORS_ORIGINS` | ☐ |
| Mail domain set | `MAIL_DOMAIN` | ☐ |
| SendGrid connected (Replit integration) | — | ☐ |
| SendGrid Inbound Parse configured | — | ☐ |
| Twilio provisioned | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | ☐ |
| Microsoft 365 app registered | `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` | ☐ |
| ONLYOFFICE provisioned | `ONLYOFFICE_URL`, `ONLYOFFICE_PASSWORD` | ☐ |
| AI integration connected | — | ☐ |
| Session secret set | `SESSION_SECRET` | ☐ |
| Custom domain configured in Replit | — | ☐ |
| DNS records verified | — | ☐ |
| Admin user created and login tested | — | ☐ |
| Password reset email tested | — | ☐ |
| Inbound email tested (forward to case-X@domain) | — | ☐ |

---

## Environment Variables Reference

See `.env.example` for the complete list of configurable environment variables with descriptions and defaults.
