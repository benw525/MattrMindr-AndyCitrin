# MattrMindr EC2 Deployment Plan

**Target Domain:** andycitrin.mattrmindr.com
**Prepared:** March 2026
**Capacity Target:** 50 simultaneous heavy users

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

### Operating System:
- **Amazon Linux 2023** or **Ubuntu 22.04 LTS**

---

## 2. Architecture Overview

```
                    ┌─────────────────┐
                    │   Route 53      │
                    │ andycitrin.      │
                    │ mattrmindr.com   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ALB (HTTPS)    │
                    │  ACM TLS Cert   │
                    │  Port 443→5000  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   EC2 Instance  │
                    │   t3.xlarge     │
                    │                 │
                    │  ┌───────────┐  │
                    │  │ Nginx     │  │
                    │  │ :80→:5000 │  │
                    │  └─────┬─────┘  │
                    │        │        │
                    │  ┌─────▼─────┐  │
                    │  │ Node.js   │  │
                    │  │ :5000     │  │
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

---

## 3. Pre-Deployment Checklist

### 3.1 AWS Resources to Provision

| Resource | Details |
|----------|---------|
| EC2 Instance | t3.xlarge, Amazon Linux 2023 or Ubuntu 22.04 |
| Security Group | Inbound: 22 (SSH, your IP only), 80 (HTTP from ALB), 443 (HTTPS from ALB). Outbound: All |
| Elastic IP | Associate with the EC2 instance for stable addressing |
| Application Load Balancer | HTTPS listener (443) → target group on port 5000 |
| ACM Certificate | Request for `andycitrin.mattrmindr.com` |
| Route 53 | A record alias pointing to the ALB |
| RDS PostgreSQL | Already provisioned (Aurora PostgreSQL-Compatible) |
| S3 Bucket | Already provisioned: `mattrmindr-andycitrin` (us-east-1) |
| IAM Role | EC2 instance role with S3 access to `mattrmindr-andycitrin` bucket |

### 3.2 DNS Configuration

| Record | Type | Value |
|--------|------|-------|
| andycitrin.mattrmindr.com | A (Alias) | ALB DNS name |

### 3.3 SendGrid Configuration

Update the SendGrid Inbound Parse webhook to point to the new domain:
- **Webhook URL:** `https://andycitrin.mattrmindr.com/api/inbound-email`
- Verify the domain `andycitrin.mattrmindr.com` is authenticated in SendGrid (domain authentication + CNAME records).

---

## 4. EC2 Instance Setup

### 4.1 Install System Dependencies

**Amazon Linux 2023:**
```bash
sudo dnf update -y
sudo dnf install -y git gcc-c++ make

# Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# System packages required by the application
sudo dnf install -y ffmpeg poppler-utils unzip

# Verify installations
node -v        # Should be v20.x
npm -v
ffmpeg -version
pdftoppm -v
```

**Ubuntu 22.04:**
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git build-essential

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# System packages
sudo apt install -y ffmpeg poppler-utils unzip

# Verify
node -v
ffmpeg -version
pdftoppm -v
```

### 4.2 Install Nginx (Reverse Proxy)

```bash
# Amazon Linux 2023
sudo dnf install -y nginx

# Ubuntu 22.04
sudo apt install -y nginx
```

### 4.3 Create Application User

```bash
sudo useradd -m -s /bin/bash mattrmindr
sudo mkdir -p /opt/mattrmindr
sudo chown mattrmindr:mattrmindr /opt/mattrmindr
```

### 4.4 Deploy Application Code

```bash
cd /opt/mattrmindr

# Clone the repository (clones into MattrMindr-AndyCitrin/)
sudo git clone https://github.com/benw525/MattrMindr-AndyCitrin.git

# Move contents into the app/ directory so paths match the service file
sudo mkdir -p /opt/mattrmindr/app
sudo mv /opt/mattrmindr/MattrMindr-AndyCitrin/* /opt/mattrmindr/app/
sudo mv /opt/mattrmindr/MattrMindr-AndyCitrin/.* /opt/mattrmindr/app/ 2>/dev/null
sudo rmdir /opt/mattrmindr/MattrMindr-AndyCitrin

# Set ownership
sudo chown -R mattrmindr:mattrmindr /opt/mattrmindr/app

cd /opt/mattrmindr/app

# Install dependencies
npm install
cd server && npm install && cd ..
cd lextrack && npm install && cd ..

# Build the React frontend
cd lextrack
CI=false npm run build
cd ..
```

### 4.5 Download RDS CA Certificate

```bash
cd /opt/mattrmindr
wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

---

## 5. Environment Configuration

Create `/opt/mattrmindr/app/.env`:

```bash
# Core
NODE_ENV=production
API_PORT=5000
APP_URL=https://andycitrin.mattrmindr.com
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
S3_BUCKET_NAME=mattrmindr-andycitrin

# SendGrid Email
SENDGRID_API_KEY=<your-sendgrid-key>
SENDGRID_FROM_EMAIL=mattrmindr@mattrmindr.com

# OpenAI (AI features)
OPENAI_API_KEY=<your-openai-key>

# ONLYOFFICE Document Editing
ONLYOFFICE_URL=https://docspace-13tl7v.onlyoffice.com
ONLYOFFICE_USER=admin
ONLYOFFICE_PASSWORD=<your-onlyoffice-password>
ONLYOFFICE_ROOM_ID=<your-room-id>

# Twilio SMS (optional)
TWILIO_ACCOUNT_SID=<your-sid>
TWILIO_AUTH_TOKEN=<your-token>
TWILIO_PHONE_NUMBER=<your-number>

# Admin User (auto-created on first start)
ADMIN_EMAIL=ben@mattrmindr.com
ADMIN_NAME=Ben Warren
ADMIN_PASSWORD=<admin-password>

# CORS (not needed if frontend and API are same origin)
# CORS_ORIGINS=https://andycitrin.mattrmindr.com
```

**Load environment in systemd** (see Section 6).

---

## 6. Process Management (systemd)

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
EnvironmentFile=-/opt/mattrmindr/app/.env
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

# Environment
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

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

Create `/etc/nginx/conf.d/mattrmindr.conf`:

```nginx
server {
    listen 80;
    server_name andycitrin.mattrmindr.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout settings for long operations (OCR, AI, document sync)
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_connect_timeout 30s;
    }
}
```

```bash
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

**Note:** If using an ALB with ACM for HTTPS (recommended), Nginx only needs to listen on port 80. The ALB handles TLS termination. If not using an ALB, add Let's Encrypt/Certbot for TLS directly on Nginx.

---

## 8. Database Setup

### 8.1 Initial Schema

On first deployment, run the schema creation script:

```bash
sudo su - mattrmindr
cd /opt/mattrmindr/app
source .env  # or export the vars

node server/schema.js
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
node server/seed.js
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

## 9. ALB + HTTPS Setup

### 9.1 Request ACM Certificate

1. Go to AWS Certificate Manager in us-east-1
2. Request a public certificate for `andycitrin.mattrmindr.com`
3. Validate via DNS (add the CNAME record ACM provides to Route 53)

### 9.2 Create Target Group

- **Target type:** Instance
- **Protocol:** HTTP, Port 5000
- **Health check path:** `/api/auth/me` (returns 401 for unauthenticated, confirming the server is up)
- **Healthy threshold:** 2
- **Interval:** 30 seconds

### 9.3 Create Application Load Balancer

- **Scheme:** Internet-facing
- **Listeners:**
  - HTTPS (443) → Target Group (forward, use ACM cert)
  - HTTP (80) → Redirect to HTTPS 443
- **Security Group:** Allow inbound 80 and 443 from 0.0.0.0/0

### 9.4 Route 53

- Create an A record (Alias) for `andycitrin.mattrmindr.com` pointing to the ALB.

---

## 10. Background Tasks

The application runs two internal scheduled tasks (no external cron needed):

| Task | Frequency | Description |
|------|-----------|-------------|
| SMS Scheduler | Every 60 seconds (production) | Checks `sms_scheduled` table and sends pending SMS via Twilio |
| Auto-Purge | Every 24 hours | Permanently deletes soft-deleted records older than 30 days from DB and S3 |

These run inside the Node.js process automatically. No additional configuration needed.

---

## 11. Monitoring and Logging

### 11.1 Application Logs

Logs are written to stdout/stderr and captured by systemd journal:

```bash
# View live logs
sudo journalctl -u mattrmindr -f

# View last 100 lines
sudo journalctl -u mattrmindr -n 100

# View errors only
sudo journalctl -u mattrmindr -p err
```

### 11.2 CloudWatch (Recommended)

Install the CloudWatch agent to ship logs and metrics:

```bash
sudo dnf install -y amazon-cloudwatch-agent  # Amazon Linux
# or
sudo apt install -y amazon-cloudwatch-agent   # Ubuntu

# Configure to ship journal logs for mattrmindr
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
```

### 11.3 Key Metrics to Monitor

| Metric | Alert Threshold | Source |
|--------|----------------|--------|
| CPU Utilization | > 80% sustained 5 min | CloudWatch EC2 |
| Memory Usage | > 85% | CloudWatch Agent |
| Disk Usage | > 80% | CloudWatch Agent |
| ALB Target Health | Unhealthy count > 0 | CloudWatch ALB |
| 5xx Error Rate | > 1% of requests | CloudWatch ALB |
| RDS CPU | > 70% sustained | CloudWatch RDS |
| RDS Connections | > 80% of max | CloudWatch RDS |

---

## 12. Security Hardening

### 12.1 Security Group Rules

| Direction | Port | Source | Purpose |
|-----------|------|--------|---------|
| Inbound | 22 | Your office IP only | SSH access |
| Inbound | 80 | ALB Security Group | HTTP from load balancer |
| Inbound | 5000 | ALB Security Group | Direct app port (if no Nginx) |
| Outbound | 443 | 0.0.0.0/0 | HTTPS to S3, OpenAI, SendGrid, ONLYOFFICE, etc. |
| Outbound | 5432 | RDS Security Group | PostgreSQL |

### 12.2 Additional Hardening

- Enable automatic security updates on the OS
- Use an IAM instance role for S3 access instead of hardcoded keys (eliminates `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from .env)
- Restrict the `.env` file: `chmod 600 /opt/mattrmindr/app/.env`
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
cd $APP_DIR

echo "Pulling latest code from GitHub..."
git pull origin main

echo "Installing dependencies..."
npm install
cd server && npm install && cd ..
cd lextrack && npm install && cd ..

echo "Building frontend..."
cd lextrack
CI=false npm run build
cd ..

echo "Restarting application..."
sudo systemctl restart mattrmindr

echo "Checking status..."
sleep 5
sudo systemctl status mattrmindr --no-pager

echo "Deployment complete!"
```

```bash
chmod +x /opt/mattrmindr/deploy.sh
```

---

## 14. Rollback Procedure

If a deployment causes issues:

```bash
# 1. Check what went wrong
sudo journalctl -u mattrmindr -n 200

# 2. Rollback to previous code
cd /opt/mattrmindr/app
git log --oneline -5          # Find the last good commit
git checkout <commit-hash>    # Rollback

# 3. Rebuild and restart
cd lextrack && CI=false npm run build && cd ..
sudo systemctl restart mattrmindr
```

---

## 15. Startup Verification Checklist

After first deployment, verify these items in the logs (`sudo journalctl -u mattrmindr -f`):

```
[ ] "Runtime schema migrations applied."
[ ] "MattrMindr API listening on port 5000"
[ ] "Database connected — N users in database"
[ ] "SMS scheduler started"
[ ] No database connection errors
[ ] No missing module errors
```

Then verify in the browser at `https://andycitrin.mattrmindr.com`:

```
[ ] Login page loads
[ ] Can log in with admin credentials (ben@mattrmindr.com)
[ ] Dashboard loads with case data
[ ] Can open a document (ONLYOFFICE viewer works)
[ ] Can edit and save a document
[ ] Can upload a new document (goes to S3)
[ ] AI features work (try a case search)
```

---

## 16. Cost Estimate (Monthly)

| Resource | Spec | Estimated Cost |
|----------|------|---------------|
| EC2 t3.xlarge | On-demand, us-east-1 | ~$120 |
| EBS gp3 100 GB | Storage | ~$8 |
| ALB | Load balancer + data | ~$25 |
| RDS Aurora | Already provisioned | Existing cost |
| S3 Storage | ~50 GB estimate | ~$1.15 |
| S3 Requests | ~100K requests/mo | ~$0.05 |
| Data Transfer | ~50 GB/mo out | ~$4.50 |
| CloudWatch | Basic monitoring | ~$3 |
| **Total (new costs)** | | **~$162/month** |

**Cost optimization:** Use a 1-year Reserved Instance for the EC2 to reduce cost by ~40% (~$72/month instead of $120).

---

## 17. Scaling Considerations

If usage grows beyond 50 users:

1. **Vertical scaling:** Move to m6i.2xlarge (8 vCPU, 32 GB RAM) for up to ~150 users
2. **Horizontal scaling:** Add a second EC2 behind the ALB (requires session affinity via ALB sticky sessions, since sessions are in PostgreSQL this works without issue)
3. **Database scaling:** Aurora auto-scales storage; add read replicas if needed
4. **CDN:** Add CloudFront in front of the ALB to cache static assets and reduce EC2 load
5. **Background processing:** Move OCR/AI processing to a separate worker instance or Lambda functions if document processing creates CPU contention
