const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Make sure the database is provisioned.");
}

function buildSslConfig() {
  if (process.env.DB_SSL === "false" || process.env.RDS_SSL === "false") {
    return false;
  }

  if (process.env.RDS_SSL_CA) {
    const sslConfig = { rejectUnauthorized: true };
    const caPath = path.resolve(process.env.RDS_SSL_CA);
    if (fs.existsSync(caPath)) {
      sslConfig.ca = fs.readFileSync(caPath, "utf8");
    } else {
      sslConfig.ca = process.env.RDS_SSL_CA;
    }
    return sslConfig;
  }

  if (process.env.DB_SSL === "true") {
    return { rejectUnauthorized: true };
  }

  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: true };
  }

  return false;
}

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || "10000", 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || "60000", 10),
};

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

module.exports = pool;
