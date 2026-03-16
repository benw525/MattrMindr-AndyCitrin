# AWS RDS PostgreSQL Migration Guide

Complete walkthrough for migrating MattrMindr from Replit's database to AWS RDS PostgreSQL.

---

## Prerequisites

- An AWS account with permissions to create RDS instances
- AWS CLI installed on your local machine (`aws --version`)
- `psql` client installed locally (`psql --version`)
- Access to this Replit project's shell

---

## Phase 1: Create the RDS Instance

### Step 1: Log into AWS Console

1. Go to https://console.aws.amazon.com
2. Make sure you're in the **us-east-1 (N. Virginia)** region (top-right dropdown) — this matches your S3 bucket region

### Step 2: Create the Database

1. Navigate to **RDS** (search "RDS" in the top search bar)
2. Click **Create database**
3. Choose these settings:

| Setting | Value |
|---|---|
| Creation method | Standard create |
| Engine | PostgreSQL |
| Engine version | 16.x (latest 16) |
| Templates | **Free tier** (for testing) or **Production** (for go-live) |
| DB instance identifier | `mattrmindr-prod` |
| Master username | `mattrmindr_admin` |
| Master password | Choose a strong password and save it somewhere safe |
| DB instance class | `db.t3.micro` (free tier) or `db.t3.medium` (production) |
| Storage type | gp3 |
| Allocated storage | 20 GB (can grow later) |
| Storage autoscaling | Enable, max 100 GB |

4. Under **Connectivity**:
   - VPC: Default VPC (or your custom one)
   - **Public access**: Yes (needed so Replit/your server can connect — you'll restrict by security group)
   - VPC security group: Create new → name it `mattrmindr-rds-sg`
   - Availability zone: No preference
   - Database port: `5432`

5. Under **Database authentication**: Password authentication

6. Under **Additional configuration**:
   - Initial database name: `mattrmindr`
   - Enable automated backups: Yes
   - Backup retention: 7 days
   - Enable encryption: Yes

7. Click **Create database** — this takes 5-10 minutes

### Step 3: Configure Security Group

Once the instance is created:

1. Click on the database instance name in the RDS dashboard
2. Under **Connectivity & security**, click the VPC security group link
3. Click **Inbound rules** → **Edit inbound rules**
4. Add a rule:
   - Type: PostgreSQL
   - Port: 5432
   - Source: `0.0.0.0/0` (allows all IPs — you can restrict later once you know your server's IP)
5. Click **Save rules**

### Step 4: Get Your Connection Details

From the RDS instance details page, note:
- **Endpoint**: something like `mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com`
- **Port**: `5432`
- **Database name**: `mattrmindr`
- **Username**: `mattrmindr_admin`
- **Password**: the one you chose

Your connection string (DATABASE_URL) will be:
```
postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com:5432/mattrmindr
```

### Step 5: Verify You Can Connect

From your local terminal (or the Replit shell):
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com:5432/mattrmindr"
```

You should see a `mattrmindr=>` prompt. Type `\q` to exit.

If it times out, double-check the security group allows your IP on port 5432.

---

## Phase 2: Export Your Current Database

### Step 1: Run the Export Script

In the Replit shell, run:
```bash
cd server && node export-data.js
```

This will:
- Use `pg_dump` to export the full schema (all tables, indexes, constraints, sequences)
- Export all data from every table (55+ tables) as INSERT statements
- Save everything to `server/export.sql`

You'll see output like:
```
Schema exported via pg_dump --schema-only
users: 2 rows exported
cases: 15 rows exported
...
Exported 500 total rows across 30 tables
Saved to export.sql (2.5 MB) — includes schema + data
```

### Step 2: Verify the Export

Check the file was created:
```bash
ls -la server/export.sql
```

You can peek at the contents:
```bash
head -50 server/export.sql
```

You should see `CREATE TABLE` statements followed by `INSERT INTO` statements.

---

## Phase 3: Import Into RDS

### Step 1: Import the SQL Dump

From the Replit shell (or your local terminal):
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com:5432/mattrmindr" < server/export.sql
```

This will:
- Create all tables, indexes, and constraints
- Import all data
- Reset sequences so new IDs continue from the right number

It may take a few minutes depending on data size.

### Step 2: Verify the Import

Connect to the RDS database and check:
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com:5432/mattrmindr"
```

Then run:
```sql
-- Count all tables
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

-- Check some key tables
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM cases;
SELECT COUNT(*) FROM tasks;

-- Exit
\q
```

The counts should match what the export script reported.

---

## Phase 4: Connect the App to RDS

### Step 1: Download the RDS SSL Certificate

AWS RDS requires SSL for secure connections. Download the certificate bundle:

```bash
curl -o server/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

### Step 2: Update Environment Variables

In your Replit project (or wherever you deploy the app), set these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.abc123xyz.us-east-1.rds.amazonaws.com:5432/mattrmindr` |
| `RDS_SSL_CA` | `./server/global-bundle.pem` (path to the cert you downloaded) |

The pool settings can stay at defaults, or you can tune them:

| Variable | Default | Description |
|---|---|---|
| `DB_POOL_MAX` | `20` | Max connections (20 is good for most setups) |
| `DB_CONNECTION_TIMEOUT` | `10000` | 10 seconds to connect (reasonable for cross-region) |
| `DB_IDLE_TIMEOUT` | `30000` | Close idle connections after 30 seconds |
| `DB_STATEMENT_TIMEOUT` | `60000` | Kill queries running longer than 60 seconds |

### Step 3: Restart the App

After updating the environment variables, restart the application. You should see the same startup output:
```
MattrMindr API listening on port 3001
Database connected — X users in database
```

### Step 4: Verify Everything Works

1. Log into the app through the browser
2. Check that your cases, contacts, and documents all appear
3. Try creating a test task or note to confirm writes work
4. Check that file downloads work (these come from S3, not the database)

---

## Phase 5: Post-Migration Checklist

### Security Hardening

Once everything is running on RDS:

1. **Restrict the security group**: Replace `0.0.0.0/0` with only the IP addresses of your server(s)
2. **Rotate the database password**: Change it in AWS, then update `DATABASE_URL`
3. **Enable deletion protection**: In the RDS console, modify the instance and enable "Deletion protection"

### Monitoring

1. In the RDS console, check **Monitoring** tab for CPU, memory, and connection counts
2. Set up **CloudWatch alarms** for:
   - CPU > 80% sustained
   - Free storage < 5 GB
   - Database connections > 80% of max

### Backups

AWS RDS automatically creates daily backups (you configured 7-day retention). You can also:
- Create manual snapshots before major changes
- Enable **Point-in-time recovery** for granular restore

---

## Rollback Plan

If something goes wrong after switching to RDS:

1. Change `DATABASE_URL` back to the Replit database URL
2. Remove `RDS_SSL_CA` (or set `DB_SSL=false`)
3. Restart the app

The Replit database will still have all your data until you explicitly delete it.

---

## Environment Variables Reference

Here's the complete list for a fully AWS-connected setup:

```bash
# Database
DATABASE_URL=postgresql://mattrmindr_admin:PASSWORD@your-rds-endpoint.us-east-1.rds.amazonaws.com:5432/mattrmindr
RDS_SSL_CA=./server/global-bundle.pem

# Optional pool tuning
DB_POOL_MAX=20
DB_CONNECTION_TIMEOUT=10000
DB_IDLE_TIMEOUT=30000
DB_STATEMENT_TIMEOUT=60000

# S3 (already configured)
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket

# App
SESSION_SECRET=your-session-secret
NODE_ENV=production
```

---

## Troubleshooting

### "Connection timed out"
- Check the RDS security group allows inbound on port 5432 from your IP
- Make sure "Public access" is enabled on the RDS instance
- Verify the endpoint URL is correct (no typos)

### "SSL connection required" / SSL errors
- Make sure `RDS_SSL_CA` is set and points to the downloaded `global-bundle.pem`
- Verify the cert file exists at that path

### "Password authentication failed"
- Double-check the password in your `DATABASE_URL`
- Special characters in the password may need URL encoding (e.g., `@` → `%40`)

### "Relation does not exist"
- The import may not have completed. Re-run the import command
- Check for errors in the import output

### App works but is slow
- Check RDS instance CPU/memory in CloudWatch — you may need a larger instance class
- Consider increasing `DB_POOL_MAX` if you see connection queuing
- The S3 bucket and RDS are both in us-east-1, so file operations should be fast. Latency is mainly between your app server and us-east-1.
