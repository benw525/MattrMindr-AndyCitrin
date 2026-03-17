# AWS Aurora PostgreSQL Migration Guide

Complete walkthrough for migrating MattrMindr from Replit's database to AWS Aurora PostgreSQL-Compatible.

---

## Why Aurora Instead of Standard RDS?

Aurora PostgreSQL-Compatible offers several advantages over standard RDS PostgreSQL:

- **Up to 3x faster** than standard PostgreSQL on RDS
- **Auto-scaling storage** from 10 GB to 128 TB — no need to pre-provision or worry about running out
- **Built-in high availability** with 6-way replication across 3 Availability Zones
- **Automatic failover** in under 30 seconds (vs. 60-120 seconds on standard RDS)
- **Reader endpoints** for load balancing read-heavy queries across replicas
- **Backtrack** — rewind the database to a specific point in time without restoring from backup
- **Serverless v2 option** — scales compute capacity automatically based on load

The connection protocol is identical to standard PostgreSQL — no code changes needed.

---

## Prerequisites

- An AWS account with permissions to create Aurora clusters
- AWS CLI installed on your local machine (`aws --version`)
- `psql` client installed locally (`psql --version`)
- Access to this Replit project's shell

### Installing AWS CLI

**On Mac:**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
aws --version
```

It will ask for your Mac password — you won't see characters as you type, that's normal.

**On Windows:**
1. Download the installer from https://awscli.amazonaws.com/AWSCLIV2.msi
2. Right-click the .msi file → **Run as administrator** (required for permissions)
3. Follow the installer prompts
4. Open a **new** Command Prompt and run `aws --version`

If you get "permission denied" on Windows without admin access, install for your user only:
```
msiexec /i AWSCLIV2.msi INSTALL_ROOT="C:\Users\YOUR_USERNAME\aws-cli"
```

**After installing, configure with your AWS credentials:**
```bash
aws configure
```
It will prompt for:
- **AWS Access Key ID** — from AWS console (IAM → Users → Security credentials → Create access key)
- **AWS Secret Access Key** — shown once when you create the key, save it
- **Default region** — `us-east-1`
- **Default output format** — `json`

### Installing psql (PostgreSQL Client)

You only need the client tools, not the full database server.

**On Mac (with Homebrew):**
```bash
brew install libpq
brew link --force libpq
psql --version
```

If Homebrew is not installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

If Homebrew fails with a git error, use **Postgres.app** instead:
1. Download from https://postgresapp.com/downloads.html
2. Open the .dmg and drag Postgres into Applications
3. Open it once, then add to PATH:
   ```bash
   sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
   ```
4. Close and reopen terminal, then `psql --version`

**On Windows:**
1. Download from https://www.postgresql.org/download/windows/
2. During installation, you can uncheck everything except **"Command Line Tools"**
3. Open a new Command Prompt and run `psql --version`

**On Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install postgresql-client
psql --version
```

### Testing the Replit Shell Connection

The Replit shell is the **Shell** tab at the bottom of your Replit workspace. Test your current database connection:
```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS total_users FROM users;"
```

If you see a count returned, the shell is working.

### Quick Verification Checklist

Run these three to confirm you're ready:
```bash
aws --version          # Should show "aws-cli/2.x.x ..."
psql --version         # Should show "psql (PostgreSQL) 14.x" or similar
echo "Replit shell OK"  # You're in the shell if you see this
```

---

## Phase 1: Create the Aurora Cluster

### Step 1: Log into AWS Console

1. Go to https://console.aws.amazon.com
2. Make sure you're in the **us-east-1 (N. Virginia)** region (top-right dropdown) — this matches your S3 bucket region

### Step 2: Create the Database Cluster

1. Navigate to **RDS** (search "RDS" in the top search bar)
2. Click **Create database**
3. Choose these settings:

| Setting | Value |
|---|---|
| Creation method | Standard create |
| Engine type | **Amazon Aurora** |
| Edition | **Amazon Aurora PostgreSQL-Compatible** |
| Engine version | Aurora PostgreSQL 16.x (latest 16) |
| Templates | **Production** (or **Dev/Test** for testing) |
| DB cluster identifier | `mattrmindr-prod` |
| Master username | `mattrmindr_admin` |
| Master password | Choose a strong password and save it somewhere safe |

4. Under **Instance configuration**:

   **Option A — Provisioned (predictable workload):**
   - `db.r6g.large` (production) or `db.t4g.medium` (dev/test)

   **Option B — Aurora Serverless v2 (variable workload):**
   - Check "Include Aurora Serverless v2 reader" or select Serverless v2 capacity
   - Set minimum ACUs: `0.5` (scales down when idle)
   - Set maximum ACUs: `4` (dev) or `16` (production)

5. Under **Availability & durability**:
   - **Multi-AZ deployment**: Create an Aurora Replica in a different AZ (recommended for production)
   - For dev/test: "Don't create an Aurora Replica" is fine

6. Under **Connectivity**:
   - VPC: Default VPC (or your custom one)
   - **Public access**: Yes (needed so Replit/your server can connect — you'll restrict by security group)
   - VPC security group: Create new → name it `mattrmindr-aurora-sg`
   - Database port: `5432`

7. Under **Credential Settings** (may also appear as "Database authentication"):
   - Enter your master username and a strong password
   - Password authentication is the default — no changes needed here

8. Under **Additional configuration**:
   - Initial database name: `mattrmindr`
   - Enable **Backtrack** if available: Yes, backtrack window `24` hours (Aurora-exclusive feature — lets you rewind the DB). Note: Backtrack may not be available for all Aurora PostgreSQL versions/regions — if you don't see the option, skip it. You still have automated backups and point-in-time recovery.
   - Enable automated backups: Yes
   - Backup retention: 7 days
   - Enable encryption: Yes
   - Enable Enhanced Monitoring: Yes (1-second granularity)

9. Click **Create database** — this takes 5-15 minutes

### Step 3: Configure Security Group

Once the cluster is created:

1. Click on the cluster name `mattrmindr-prod` in the RDS dashboard
2. Under **Connectivity & security**, click the VPC security group link
3. Click **Inbound rules** → **Edit inbound rules**
4. Add a rule:
   - Type: PostgreSQL
   - Port: 5432
   - Source: `0.0.0.0/0` (allows all IPs — restrict this later once you know your server's IP)
5. Click **Save rules**

### Step 4: Get Your Connection Details

From the Aurora cluster details page, note these **two endpoints**:

| Endpoint | Purpose |
|---|---|
| **Writer endpoint** | `mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com` — for all reads and writes |
| **Reader endpoint** | `mattrmindr-prod.cluster-ro-abc123.us-east-1.rds.amazonaws.com` — for read-only queries (load balanced across replicas) |

Your primary connection string (DATABASE_URL) uses the **writer endpoint**:
```
postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr
```

### Step 5: Verify You Can Connect

From your local terminal (or the Replit shell):
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr"
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

## Phase 3: Import Into Aurora

### Step 1: Import the SQL Dump

From the Replit shell (or your local terminal), use the **writer endpoint**:
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr" < server/export.sql
```

This will:
- Create all tables, indexes, and constraints
- Import all data
- Reset sequences so new IDs continue from the right number

It may take a few minutes depending on data size.

### Step 2: Verify the Import

Connect to the Aurora cluster and check:
```bash
psql "postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr"
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

## Phase 4: Connect the App to Aurora

### Step 1: Download the RDS/Aurora SSL Certificate

Aurora uses the same SSL certificate bundle as RDS. Download it:

```bash
curl -o server/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

### Step 2: Update Environment Variables

In your Replit project (or wherever you deploy the app), set these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://mattrmindr_admin:YOUR_PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr` |
| `RDS_SSL_CA` | `./server/global-bundle.pem` (path to the cert you downloaded) |

The pool settings can stay at defaults, or you can tune them:

| Variable | Default | Description |
|---|---|---|
| `DB_POOL_MAX` | `20` | Max connections (Aurora supports more than RDS — up to 1000+ depending on instance size) |
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

Once everything is running on Aurora:

1. **Restrict the security group**: Replace `0.0.0.0/0` with only the IP addresses of your server(s)
2. **Rotate the database password**: Change it in AWS, then update `DATABASE_URL`
3. **Enable deletion protection**: In the RDS console, modify the cluster and enable "Deletion protection"
4. **Consider IAM authentication**: Aurora supports IAM-based authentication (no passwords in connection strings)

### Monitoring

1. In the RDS console, check the **Monitoring** tab for CPU, memory, and connection counts
2. Use **Performance Insights** (Aurora-exclusive) for detailed query-level performance analysis
3. Set up **CloudWatch alarms** for:
   - CPU > 80% sustained
   - Database connections > 80% of max
   - Replica lag > 100ms (if using reader replicas)
   - Aurora-specific: Volume bytes used, buffer cache hit ratio

### Backups & Recovery

Aurora provides multiple recovery options:

- **Automated backups**: Daily snapshots retained for 7 days (configured above)
- **Backtrack**: Rewind the database to any point within the 24-hour backtrack window — no restore needed, takes seconds
- **Point-in-time recovery**: Restore to any second within the backup retention period (creates a new cluster)
- **Manual snapshots**: Create before major changes (retained indefinitely until you delete them)

### Optional: Aurora Serverless v2 Auto-Scaling

If you chose Serverless v2, Aurora automatically scales compute capacity:
- Scales down to minimum ACUs during off-hours (reduces cost)
- Scales up within seconds when load increases
- You only pay for the capacity you use

Monitor scaling activity in CloudWatch under the `ServerlessDatabaseCapacity` metric.

---

## Rollback Plan

If something goes wrong after switching to Aurora:

1. Change `DATABASE_URL` back to the Replit database URL
2. Remove `RDS_SSL_CA` (or set `DB_SSL=false`)
3. Restart the app

The Replit database will still have all your data until you explicitly delete it.

If you need to undo a recent change on Aurora itself, use **Backtrack** (if enabled) to rewind to before the problem occurred — no restore or downtime needed. If Backtrack isn't available, use **point-in-time recovery** to restore to a new cluster from before the problem.

---

## Environment Variables Reference

Here's the complete list for a fully AWS-connected setup:

```bash
# Database (use Aurora writer endpoint)
DATABASE_URL=postgresql://mattrmindr_admin:PASSWORD@mattrmindr-prod.cluster-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr
RDS_SSL_CA=./server/global-bundle.pem

# Optional: Aurora reader endpoint for read-heavy queries (future use)
# DATABASE_READ_URL=postgresql://mattrmindr_admin:PASSWORD@mattrmindr-prod.cluster-ro-abc123.us-east-1.rds.amazonaws.com:5432/mattrmindr

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

### "Connection timed out" (most common issue)

This almost always means network traffic isn't reaching Aurora. Check these three things in order:

**1. Public access must be enabled on the instance (not just the cluster):**
- Go to RDS → Databases → click the **writer instance** (listed under the cluster)
- Click **Modify**
- Under **Connectivity** → **Additional configuration** → **Public access**: select **Yes**
- Click **Continue** → **Apply immediately** → **Modify DB instance**
- Wait 1-2 minutes for the change to apply

**2. Security group must allow inbound traffic on port 5432:**
- Search **"Security Groups"** in the top AWS search bar (under EC2 — you don't need an EC2 instance)
- Find the group attached to your Aurora cluster (e.g., `mattrmindr-aurora-sg`)
- Click **Inbound rules** → **Edit inbound rules**
- Ensure there is a rule: Type = **PostgreSQL**, Port = **5432**, Source = **Anywhere-IPv4** (`0.0.0.0/0`)
- If the source is set to a specific IP (e.g., `208.72.131.98/32`), Replit won't be able to connect — change it to `0.0.0.0/0`
- Click **Save rules**

**3. The VPC route table must have an Internet Gateway route:**
- Go to **VPC** → **Route Tables** in the AWS console
- Find the route table associated with your Aurora subnets (check the **Subnet associations** tab)
- Click the **Routes** tab — look for a route with destination `0.0.0.0/0` pointing to an Internet Gateway (`igw-...`)
- If that route is missing, click **Edit routes** → **Add route**:
  - Destination: `0.0.0.0/0`
  - Target: **Internet Gateway** → select the `igw-` entry
- Click **Save changes**

All three must be in place for Replit (or any external connection) to reach Aurora.

### "invalid percent-encoded token" in connection string
- Special characters in the password need URL encoding in the connection string
- `%` → `%25`, `@` → `%40`, `#` → `%23`, `!` → `%21`
- Example: password `100%Warrior92` becomes `100%25Warrior92` in the URL
```bash
psql "postgresql://mattrmindr_admin:100%25Warrior92@your-endpoint:5432/mattrmindr"
```

### "SSL connection required" / SSL errors
- Make sure `RDS_SSL_CA` is set and points to the downloaded `global-bundle.pem`
- Verify the cert file exists at that path

### "Password authentication failed"
- Double-check the password in your `DATABASE_URL`
- Remember to URL-encode special characters (see above)

### "Relation does not exist"
- The import may not have completed. Re-run the import command
- Check for errors in the import output

### App works but is slow
- Check Aurora cluster CPU/memory in CloudWatch
- Use **Performance Insights** to identify slow queries
- If using Serverless v2, check if minimum ACUs is too low — increase from 0.5 to 1 or 2
- Consider adding a **reader replica** and routing read-heavy queries to the reader endpoint
- The S3 bucket and Aurora cluster are both in us-east-1, so file operations should be fast

### Failover behavior
- Aurora automatically fails over to a read replica if the writer instance fails (under 30 seconds)
- Your app may see a brief connection error during failover — the pg Pool will automatically reconnect
- Consider setting `DB_CONNECTION_TIMEOUT=15000` (15s) to allow time for failover reconnection

### Using Backtrack
If you need to undo a mistake (accidental delete, bad migration, etc.):
1. Go to the RDS console → your Aurora cluster
2. Click **Actions** → **Backtrack**
3. Choose a timestamp before the problem occurred
4. Confirm — the cluster rewinds in seconds with no downtime
