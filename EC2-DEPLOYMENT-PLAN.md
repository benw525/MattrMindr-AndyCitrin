# MattrMindr EC2 Deployment Plan

**Prepared:** March 2026
**Capacity Target:** 50 simultaneous heavy users
**OS:** Ubuntu 22.04 LTS (always)
**SSL/DNS:** Cloudflare (always)

---

## 1. EC2 Instance Specification

### Recommended Instance: **t3.xlarge**

| Resource | Spec | Rationale |
|----------|------|-----------|
| vCPUs | 4 | Node.js is single-threaded but OCR/PDF processing, sharp image compression, and ffmpeg are CPU-intensive. 4 vCPUs provide headroom for concurrent document processing alongside API requests. |
| RAM | 16 GB | 50 heavy users uploading/editing documents, running AI agents, and processing OCR simultaneously. Node.js heap + sharp buffers + PDF parsing can peak at 8-10 GB under heavy load. |
| Storage | 100 GB gp3 EBS | OS + Node.js + npm packages (~500 MB), React build (~50 MB), logs, temp files for document processing. Documents themselves are stored in S3. |
| Network | Up to 5 Gbps | Sufficient for S3 uploads/downloads, ONLYOFFICE communication, and client connections. |

### Alternative (Budget):
- **t3.large** (2 vCPU, 8 GB RAM) — Adequate for 20-30 users with lighter document processing loads.

### Alternative (High Performance):
- **m6i.xlarge** (4 vCPU, 16 GB RAM) — Fixed performance (no burstable credits). Recommended if sustained CPU-intensive OCR/AI workloads are expected throughout the day.

---

## 2. Architecture Overview

```
                    ┌─────────────────┐
                    │   Cloudflare    │
                    │  DNS + SSL      │
                    │  (Flexible SSL) │
                    │  A record → EIP │
                    └────────┬────────┘
                             │ HTTP (port 80)
                    ┌────────▼────────┐
                    │   EC2 Instance  │
                    │   t3.xlarge     │
                    │   Elastic IP    │
                    │                 │
                    │  ┌───────────┐  │
                    │  │ Nginx :80 │  │
                    │  │ → :3001   │  │
                    │  └─────┬─────┘  │
                    │        │        │
                    │  ┌─────▼─────┐  │
                    │  │ Node.js   │  │
                    │  │ :3001     │  │
                    │  │ (Express) │  │
                    │  └───────────┘  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐ ┌────▼────┐ ┌───────▼───────┐
     │ RDS PostgreSQL│ │ S3      │ │ ONLYOFFICE    │
     │ (Aurora)      │ │ Bucket  │ │ DocSpace      │
     └───────────────┘ └─────────┘ └───────────────┘
```

**Key architecture notes:**
- Cloudflare provides DNS and SSL termination using **Flexible SSL** mode (Cloudflare → EC2 is HTTP on port 80)
- No ALB needed — Cloudflare connects directly to the EC2 Elastic IP
- Nginx reverse-proxies to Node.js on port 3001 (production port)
- Node.js serves both the Express API and the React build in production mode

---

## 3. Pre-Deployment Checklist

### 3.1 AWS Resources to Provision

| Resource | Details |
|----------|---------|
| EC2 Instance | t3.xlarge, Ubuntu 22.04 LTS |
| Security Group | See Section 12 |
| Elastic IP | Associate with the EC2 instance — Cloudflare A record points here |
| RDS PostgreSQL | Already provisioned (Aurora PostgreSQL-Compatible) |
| S3 Bucket | Already provisioned (e.g. `mattrmindr-clientname`, us-east-1) |
| IAM Role | EC2 instance role with S3 access to the client's bucket |

### 3.2 Cloudflare DNS Configuration

1. Add the client subdomain (e.g. `clientname.mattrmindr.com`) in Cloudflare
2. Create an **A record** pointing to the EC2 Elastic IP with **Proxy enabled** (orange cloud)
3. Set SSL/TLS encryption mode to **Flexible**

| Record | Type | Value | Proxy |
|--------|------|-------|-------|
| clientname.mattrmindr.com | A | EC2 Elastic IP | Proxied (orange cloud) |

**Why Flexible SSL:** Cloudflare terminates HTTPS at its edge and forwards HTTP to the EC2. This avoids managing certificates on the server. The trade-off is that the Cloudflare → EC2 hop is unencrypted, but the EC2 security group restricts inbound to Cloudflare IPs only (see Section 12).

### 3.3 SendGrid Configuration

Update the SendGrid Inbound Parse webhook to point to the new domain:
- **Webhook URL:** `https://clientname.mattrmindr.com/api/inbound-email`
- Verify the domain `clientname.mattrmindr.com` is authenticated in SendGrid (domain authentication + CNAME records)

---

## 4. EC2 Instance Setup

### 4.1 Install System Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git build-essential

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# System packages required by the application
sudo apt install -y ffmpeg poppler-utils unzip nginx

# Verify installations
node -v        # Should be v20.x
npm -v
ffmpeg -version
pdftoppm -v
nginx -v
```

### 4.2 Create Application User

```bash
sudo useradd -m -s /bin/bash mattrmindr
sudo mkdir -p /opt/mattrmindr
sudo chown mattrmindr:mattrmindr /opt/mattrmindr
```

### 4.3 Deploy Application Code

```bash
cd /opt/mattrmindr

# Clone the repository directly into the app/ directory
sudo git clone https://github.com/<org>/<repo>.git app

# IMPORTANT: Mark the directory as safe for git operations
sudo git config --global --add safe.directory /opt/mattrmindr/app

# Set ownership
sudo chown -R mattrmindr:mattrmindr /opt/mattrmindr/app

cd /opt/mattrmindr/app

# Install dependencies (run as mattrmindr user)
sudo -u mattrmindr npm install
sudo -u mattrmindr bash -c "cd server && npm install"
sudo -u mattrmindr bash -c "cd lextrack && npm install"

# Build the React frontend
# CI=false is REQUIRED — react-scripts treats ESLint warnings as errors when CI=true
sudo -u mattrmindr bash -c "cd lextrack && CI=false npm run build"
```

### 4.4 Download RDS CA Certificate

```bash
cd /opt/mattrmindr
sudo wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
sudo chown mattrmindr:mattrmindr global-bundle.pem
```

---

## 5. Environment Configuration

Create `/opt/mattrmindr/app/.env`:

```bash
# Core
NODE_ENV=production
API_PORT=3001
APP_URL=https://clientname.mattrmindr.com
SESSION_SECRET=<generate-with: openssl rand -hex 64>

# Database (Aurora PostgreSQL)
DATABASE_URL=postgresql://<user>:<password>@<rds-endpoint>:5432/<dbname>
DB_SSL=true
RDS_SSL_CA=/opt/mattrmindr/global-bundle.pem
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=10000
DB_STATEMENT_TIMEOUT=60000

# AWS S3
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-1
S3_BUCKET_NAME=mattrmindr-clientname

# SendGrid Email
SENDGRID_API_KEY=<your-sendgrid-key>
SENDGRID_FROM_EMAIL=mattrmindr@mattrmindr.com
MAIL_DOMAIN=clientname.mattrmindr.com

# OpenAI (AI features — required for AI search, agents, medical record parsing)
OPENAI_API_KEY=<your-openai-key>

# Gemini (OCR pipeline — required for document text extraction)
GEMINI_API_KEY=<your-gemini-key>

# ONLYOFFICE Document Editing
ONLYOFFICE_URL=https://<docspace-instance>.onlyoffice.com
ONLYOFFICE_USER=<onlyoffice-login-email>
ONLYOFFICE_PASSWORD=<your-onlyoffice-password>
ONLYOFFICE_ROOM_ID=<your-room-id>

# Twilio SMS (optional)
TWILIO_ACCOUNT_SID=<your-sid>
TWILIO_AUTH_TOKEN=<your-token>
TWILIO_PHONE_NUMBER=<your-number>

# Admin User (auto-created on first start)
ADMIN_EMAIL=<admin-email>
ADMIN_NAME=<Admin Full Name>
ADMIN_PASSWORD=<admin-password>
```

**Secure the .env file immediately:**
```bash
sudo chmod 600 /opt/mattrmindr/app/.env
sudo chown mattrmindr:mattrmindr /opt/mattrmindr/app/.env
```

### 5.1 Critical Environment Variable Notes

| Variable | Notes |
|----------|-------|
| `API_PORT` | Must be `3001` — this is the production Express port. Nginx proxies from 80 → 3001. |
| `APP_URL` | Used in login/password-reset emails. Must include `https://`. |
| `MAIL_DOMAIN` | Controls the From domain for correspondence emails. Set to the client's subdomain. |
| `ONLYOFFICE_USER` | This is the **login email** for the ONLYOFFICE DocSpace account, NOT necessarily `admin`. Verify the actual login email in DocSpace admin panel. |
| `GEMINI_API_KEY` | Required for the OCR pipeline. Get from Google AI Studio. Without this, document text extraction will fall back to tesseract.js only. |
| `SESSION_SECRET` | Passwords and other env values with special characters (`%`, `!`, `$`, `#`, `&`, etc.) must be handled carefully — see Section 6 for why we use dotenv instead of systemd EnvironmentFile. |

---

## 6. Process Management (systemd)

### 6.1 Critical: Environment Variable Loading

**systemd's `EnvironmentFile` does NOT reliably parse `.env` files** with values containing special characters (`%`, `$`, `!`, `#`, `&`, spaces, etc.). Passwords, API keys, and secrets routinely contain these characters. During deployment, this caused silent auth failures and session cookie issues.

**Solution:** The application uses the `dotenv` npm package to load `.env` at startup. The server entry point (`server/index.js`) includes:

```javascript
try { require("dotenv").config(); } catch {}
```

This runs before any other code and reliably handles all special characters. The systemd `EnvironmentFile` directive is kept as optional (prefixed with `-`) as a fallback but should not be relied upon.

### 6.2 Service File

Create `/etc/systemd/system/mattrmindr.service`:

```ini
[Unit]
Description=MattrMindr Application
After=network.target

[Service]
Type=simple
User=mattrmindr
Group=mattrmindr
WorkingDirectory=/opt/mattrmindr/app

# EnvironmentFile is OPTIONAL (- prefix = don't fail if missing/broken)
# Environment variables are primarily loaded by dotenv in server/index.js
EnvironmentFile=-/opt/mattrmindr/app/.env

# Only NODE_ENV is set here to ensure production mode even if dotenv somehow fails
Environment=NODE_ENV=production

ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mattrmindr

# Performance tuning for 50 users
LimitNOFILE=65536

# Memory safety
MemoryMax=14G

[Install]
WantedBy=multi-user.target
```

### 6.3 Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable mattrmindr
sudo systemctl start mattrmindr

# Check status
sudo systemctl status mattrmindr
sudo journalctl -u mattrmindr -f
```

---

## 7. Nginx Configuration

### 7.1 Critical: X-Forwarded-Proto Must Be Hardcoded

When using Cloudflare Flexible SSL, Cloudflare terminates HTTPS and sends HTTP to the origin. Nginx sees `$scheme` as `http`, but the Express app needs to know the original request was HTTPS — otherwise:
- Session cookies with `secure: true` won't be set (login fails silently)
- CSRF protections may fail
- Redirect URLs will use `http://` instead of `https://`

**The fix:** Hardcode `X-Forwarded-Proto https` in the Nginx config. Do NOT use `$scheme`.

### 7.2 Configuration File

Create `/etc/nginx/sites-available/mattrmindr` (and symlink to `sites-enabled`):

```nginx
server {
    listen 80;
    server_name clientname.mattrmindr.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # CRITICAL: Hardcode https — do NOT use $scheme
        # Cloudflare Flexible SSL sends HTTP to origin, but the app
        # needs to know the client connection was HTTPS for session
        # cookies and redirects to work correctly
        proxy_set_header X-Forwarded-Proto https;

        proxy_cache_bypass $http_upgrade;

        # Timeout settings for long operations (OCR, AI agents, document sync)
        proxy_read_timeout 300s;
        proxy_send_timeout 120s;
        proxy_connect_timeout 30s;
    }
}
```

### 7.3 Enable the Site

```bash
# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Enable MattrMindr site
sudo ln -sf /etc/nginx/sites-available/mattrmindr /etc/nginx/sites-enabled/mattrmindr

# Test and restart
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

---

## 8. Database Setup

### 8.1 Initial Schema

On first deployment, run the schema creation script:

```bash
sudo -u mattrmindr bash -c "cd /opt/mattrmindr/app && node server/schema.js"
```

### 8.2 Runtime Migrations

The application automatically runs runtime migrations (`ensureColumns()`) on every startup. This handles:
- Creating additional tables (custom reports, task flows, dashboard widgets, etc.)
- Adding new columns to existing tables
- Auto-creating the admin user from `ADMIN_EMAIL`/`ADMIN_NAME`/`ADMIN_PASSWORD`

No manual migration step is needed after the initial schema creation.

### 8.3 Seed Data (Optional)

If starting with sample data:
```bash
sudo -u mattrmindr bash -c "cd /opt/mattrmindr/app && node server/seed.js"
```

### 8.4 Data Migration from Replit

If migrating existing data from the Replit instance:
```bash
# On Replit, export the database
node server/export-data.js > mattrmindr-export.sql

# On EC2, import
psql $DATABASE_URL < mattrmindr-export.sql
```

---

## 9. Background Tasks

The application runs two internal scheduled tasks (no external cron needed):

| Task | Frequency | Description |
|------|-----------|-------------|
| SMS Scheduler | Every 300 seconds (production) | Checks `sms_scheduled` table and sends pending SMS via Twilio |
| Auto-Purge | Every 24 hours | Permanently deletes soft-deleted records older than 30 days from DB and S3 |

These run inside the Node.js process automatically. No additional configuration needed.

---

## 10. Monitoring and Logging

### 10.1 Application Logs

Logs are written to stdout/stderr and captured by systemd journal:

```bash
# View live logs
sudo journalctl -u mattrmindr -f

# View last 100 lines
sudo journalctl -u mattrmindr -n 100

# View errors only
sudo journalctl -u mattrmindr -p err

# View logs since last restart
sudo journalctl -u mattrmindr --since "$(systemctl show -p ActiveEnterTimestamp mattrmindr | cut -d= -f2)"
```

### 10.2 CloudWatch (Recommended)

```bash
sudo apt install -y amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
```

### 10.3 Key Metrics to Monitor

| Metric | Alert Threshold | Source |
|--------|----------------|--------|
| CPU Utilization | > 80% sustained 5 min | CloudWatch EC2 |
| Memory Usage | > 85% | CloudWatch Agent |
| Disk Usage | > 80% | CloudWatch Agent |
| 5xx Error Rate | > 1% of requests | Cloudflare Analytics |
| RDS CPU | > 70% sustained | CloudWatch RDS |
| RDS Connections | > 80% of max | CloudWatch RDS |

---

## 11. Cloudflare Settings

### 11.1 SSL/TLS

- **Encryption mode:** Flexible
- **Always Use HTTPS:** On
- **Automatic HTTPS Rewrites:** On
- **Minimum TLS Version:** 1.2

### 11.2 Recommended Settings

| Setting | Value | Why |
|---------|-------|-----|
| SSL Mode | Flexible | No cert management on EC2 |
| Always Use HTTPS | On | Force HTTPS for all visitors |
| Browser Cache TTL | Respect Existing Headers | Let Express control caching |
| Caching Level | Standard | Default is fine |
| Under Attack Mode | Off (toggle on if needed) | DDoS protection |

### 11.3 Cloudflare Page Rules (Optional)

If you want to cache static assets aggressively:
- **URL pattern:** `clientname.mattrmindr.com/static/*`
- **Setting:** Cache Level: Cache Everything, Edge Cache TTL: 1 month

---

## 12. Security Hardening

### 12.1 Security Group Rules

Since there is no ALB, the EC2 is accessed directly through Cloudflare. Restrict inbound traffic to Cloudflare's IP ranges only.

| Direction | Port | Source | Purpose |
|-----------|------|--------|---------|
| Inbound | 22 | Your office IP only | SSH access |
| Inbound | 80 | Cloudflare IP ranges | HTTP from Cloudflare proxy |
| Inbound | 443 | Cloudflare IP ranges | HTTPS from Cloudflare proxy (if upgrading to Full SSL later) |
| Outbound | 443 | 0.0.0.0/0 | HTTPS to S3, OpenAI, SendGrid, ONLYOFFICE, Gemini, etc. |
| Outbound | 5432 | RDS Security Group | PostgreSQL |

**Cloudflare IP ranges:** https://www.cloudflare.com/ips/ — add all IPv4 and IPv6 ranges to the security group. Cloudflare publishes these ranges and they rarely change, but check periodically.

### 12.2 Additional Hardening

```bash
# Enable automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Secure the .env file
sudo chmod 600 /opt/mattrmindr/app/.env
sudo chown mattrmindr:mattrmindr /opt/mattrmindr/app/.env
```

- Use an IAM instance role for S3 access instead of hardcoded keys (eliminates `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from .env)
- Enable RDS encryption at rest (Aurora supports this by default)
- Enable S3 bucket encryption (SSE-S3 or SSE-KMS)
- Set up AWS Backup for automated RDS snapshots

---

## 13. Deployment Script

Create `/opt/mattrmindr/deploy.sh` for future updates:

```bash
#!/bin/bash
set -e

APP_DIR="/opt/mattrmindr/app"

# Ensure git trusts this directory
sudo git config --global --add safe.directory $APP_DIR

cd $APP_DIR

echo "Pulling latest code from GitHub..."
sudo -u mattrmindr git pull origin main

echo "Installing dependencies..."
sudo -u mattrmindr npm install
sudo -u mattrmindr bash -c "cd server && npm install"
sudo -u mattrmindr bash -c "cd lextrack && npm install"

echo "Building frontend..."
# CI=false is REQUIRED — react-scripts treats ESLint warnings as errors when CI=true
sudo -u mattrmindr bash -c "cd lextrack && CI=false npm run build"

echo "Restarting application..."
sudo systemctl restart mattrmindr

echo "Waiting for startup..."
sleep 5

echo "Checking status..."
sudo systemctl status mattrmindr --no-pager

echo ""
echo "Recent logs:"
sudo journalctl -u mattrmindr -n 20 --no-pager

echo ""
echo "Deployment complete!"
```

```bash
sudo chmod +x /opt/mattrmindr/deploy.sh
```

**Quick deploy command:** `sudo /opt/mattrmindr/deploy.sh`

---

## 14. Rollback Procedure

If a deployment causes issues:

```bash
# 1. Check what went wrong
sudo journalctl -u mattrmindr -n 200

# 2. Rollback to previous code
cd /opt/mattrmindr/app
sudo git config --global --add safe.directory /opt/mattrmindr/app
git log --oneline -5          # Find the last good commit
sudo -u mattrmindr git checkout <commit-hash>

# 3. Rebuild and restart
sudo -u mattrmindr bash -c "cd lextrack && CI=false npm run build"
sudo systemctl restart mattrmindr
```

---

## 15. Startup Verification Checklist

After first deployment, verify these items in the logs (`sudo journalctl -u mattrmindr -f`):

```
[ ] "Runtime schema migrations applied."
[ ] "MattrMindr API listening on port 3001"
[ ] "Database connected — N users in database"
[ ] "SMS scheduler started"
[ ] No database connection errors
[ ] No missing module errors
```

Then verify in the browser at `https://clientname.mattrmindr.com`:

```
[ ] Login page loads (not a Cloudflare error page)
[ ] Can log in with admin credentials
[ ] Session persists (refresh page — should stay logged in)
[ ] Dashboard loads with case data
[ ] Can open a document (ONLYOFFICE viewer works)
[ ] Can edit and save a document
[ ] Can upload a new document (goes to S3)
[ ] AI features work (try a case search)
[ ] Correspondence emails send correctly (check From domain)
```

---

## 16. Cost Estimate (Monthly)

| Resource | Spec | Estimated Cost |
|----------|------|---------------|
| EC2 t3.xlarge | On-demand, us-east-1 | ~$120 |
| EBS gp3 100 GB | Storage | ~$8 |
| Elastic IP | Associated with running instance | $0 |
| Cloudflare | Free plan (DNS + SSL + DDoS) | $0 |
| RDS Aurora | Already provisioned | Existing cost |
| S3 Storage | ~50 GB estimate | ~$1.15 |
| S3 Requests | ~100K requests/mo | ~$0.05 |
| Data Transfer | ~50 GB/mo out | ~$4.50 |
| CloudWatch | Basic monitoring | ~$3 |
| **Total (new costs)** | | **~$137/month** |

**Cost savings vs ALB approach:** ~$25/month saved by using Cloudflare instead of an ALB.

**Cost optimization:** Use a 1-year Reserved Instance for the EC2 to reduce cost by ~40% (~$72/month instead of $120).

---

## 17. Scaling Considerations

If usage grows beyond 50 users:

1. **Vertical scaling:** Move to m6i.2xlarge (8 vCPU, 32 GB RAM) for up to ~150 users
2. **Horizontal scaling:** Add a second EC2 — use Cloudflare Load Balancing ($5/mo) or switch to an ALB at that point. Sessions are stored in PostgreSQL so any instance can handle any request.
3. **Database scaling:** Aurora auto-scales storage; add read replicas if needed
4. **Cloudflare caching:** Enable caching for `/static/*` paths to reduce EC2 load
5. **Background processing:** Move OCR/AI processing to a separate worker instance or Lambda functions if document processing creates CPU contention
6. **Upgrade to Full SSL:** If security requirements increase, install a certificate on the EC2 (via Let's Encrypt/Certbot) and switch Cloudflare to Full (Strict) mode

---

## 18. Troubleshooting Guide

### Login fails silently (no error, page just reloads)

**Cause:** Session cookies not being set because Express thinks the connection is HTTP.
**Fix:** Verify Nginx has `proxy_set_header X-Forwarded-Proto https;` (hardcoded, NOT `$scheme`). Restart Nginx after changing.

### Environment variables not loading (DB connection fails, API keys missing)

**Cause:** systemd `EnvironmentFile` can't parse special characters in passwords/keys.
**Fix:** Ensure `server/index.js` has `try { require("dotenv").config(); } catch {}` at the very top, before any other imports. The `.env` file in `/opt/mattrmindr/app/` is loaded by dotenv, not systemd.

### `git pull` fails with "dubious ownership"

**Cause:** Git security check — the repo is owned by `mattrmindr` but you're running as root.
**Fix:** `sudo git config --global --add safe.directory /opt/mattrmindr/app`

### React build fails with ESLint errors

**Cause:** `CI` environment variable is set (defaults to `true` in some environments), making `react-scripts build` treat warnings as errors.
**Fix:** Always prefix with `CI=false`: `CI=false npm run build`

### ONLYOFFICE document editing doesn't work

**Cause:** Wrong login credentials. The ONLYOFFICE_USER is the **email used to log in** to DocSpace, which may not be `admin`.
**Fix:** Log in to the DocSpace admin panel, check the actual login email, and update `ONLYOFFICE_USER` in `.env`.

### Cloudflare shows 502 Bad Gateway

**Cause:** Nginx is not running, or Node.js app crashed, or Nginx is proxying to the wrong port.
**Fix:**
```bash
sudo systemctl status nginx        # Is Nginx running?
sudo systemctl status mattrmindr   # Is the app running?
sudo journalctl -u mattrmindr -n 50  # Check app errors
# Verify Nginx proxies to port 3001 (the production API port)
```

### Correspondence emails come from wrong domain

**Cause:** `MAIL_DOMAIN` not set in `.env`.
**Fix:** Add `MAIL_DOMAIN=clientname.mattrmindr.com` to `.env` and restart the service.
