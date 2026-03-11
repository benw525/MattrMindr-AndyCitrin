#!/bin/bash
set -e

cd /home/runner/workspace

npm install --ignore-scripts < /dev/null
cd server && npm install --ignore-scripts < /dev/null
cd ../lextrack && npm install --ignore-scripts < /dev/null
cd ..

node -e "
const pool = require('./server/db');
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('Database connection OK');
  } catch (e) {
    console.error('Database check failed:', e.message);
    process.exit(1);
  }
  pool.end();
})();
"

echo "Post-merge setup complete"
