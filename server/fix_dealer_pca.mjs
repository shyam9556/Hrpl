// ─── One-off migration: reset dealer password_changed_at ─────────────────────
// Reads DB credentials from server/.env — NEVER hardcode credentials in source.
// Run from the server/ directory:  node fix_dealer_pca.mjs
// ─────────────────────────────────────────────────────────────────────────────
import mysql from 'mysql2/promise';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env from the same directory as this script (server/.env)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const envPath    = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  console.error('ERROR: server/.env not found. Create it from server/.env.example first.');
  process.exit(1);
}

// Minimal dotenv-style parser — avoids adding a dependency just for this script
fs.readFileSync(envPath, 'utf8')
  .split('\n')
  .forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  });

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('ERROR: Missing one or more required DB_* variables in server/.env');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host    : DB_HOST,
  port    : parseInt(DB_PORT || '3306', 10),
  user    : DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
});

// Clear password_changed_at for ALL dealers where it was set by DEFAULT
// (i.e., equal to created_at — meaning the user never explicitly changed it).
// Also clear any non-null value since existing dealers may have been affected.
const [r] = await conn.execute(
  `UPDATE users SET password_changed_at = '1970-01-01 00:00:01' WHERE role = 'dealer'`
);
console.log('Fixed dealer rows:', r.affectedRows);

const [rows] = await conn.execute(
  `SELECT id, email, role, password_changed_at, created_at FROM users WHERE role = 'dealer'`
);
rows.forEach(u =>
  console.log('  ', u.email, '| pca:', u.password_changed_at, '| created:', u.created_at)
);

await conn.end();
console.log('Done.');
