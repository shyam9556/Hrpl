/**
 * Database Migration Runner (MySQL)
 * ─────────────────────────────────────────────────────────────
 * Runs all .sql files in server/migrations/ in sequential order.
 * Tracks which migrations have already run in the schema_migrations table.
 * Safe to run multiple times — already-run migrations are skipped.
 *
 * Usage:  node server/scripts/migrate.js
 *    or:  npm run migrate   (from server/ directory)
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  database: process.env.DB_NAME || "highlight_pro",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,   // Required to execute multi-statement SQL files
  waitForConnections: true,
  connectionLimit: 5,
  timezone: "+00:00",
});

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

async function migrate() {
  const conn = await pool.getConnection();

  try {
    console.log("🚀 Starting MySQL migration runner...\n");

    // 1. Create tracking table if it doesn't exist
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename    VARCHAR(255) NOT NULL,
        applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Read which migrations have already been applied
    const [applied] = await conn.query(
      "SELECT filename FROM schema_migrations ORDER BY filename"
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    // 3. Read all .sql files sorted by name (001_, 002_, ...)
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("⚠️  No migration files found in", MIGRATIONS_DIR);
      return;
    }

    let ranCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`   ⏭  Skipped  ${file}`);
        skippedCount++;
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, "utf8");

      await conn.beginTransaction();
      try {
        // Execute entire SQL file (multipleStatements: true handles multi-statement files)
        await conn.query(sql);
        await conn.query(
          "INSERT INTO schema_migrations (filename) VALUES (?)",
          [file]
        );
        await conn.commit();
        console.log(`   ✅  Applied  ${file}`);
        ranCount++;
      } catch (err) {
        await conn.rollback();
        console.error(`\n❌  FAILED on ${file}:`);
        console.error(`   ${err.message}\n`);
        console.error("   ⛔ Migration aborted. Fix the error and re-run.");
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\n─────────────────────────────────────────────`);
    console.log(`✅  Migrations complete.`);
    console.log(`   Applied : ${ranCount}`);
    console.log(`   Skipped : ${skippedCount} (already run)`);
    console.log(`   Total   : ${files.length} files`);
    console.log(`─────────────────────────────────────────────\n`);
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Fatal migration error:", err.message);
  process.exit(1);
});
