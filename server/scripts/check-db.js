import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

/**
 * check-db.js
 *
 * GAP-08 fix: Improved error reporting when the database is not set up.
 * Distinguishes between:
 *  - Connection errors (wrong host/user/password)
 *  - Missing table errors (migrations not run yet)
 *  - Other query errors
 */
async function checkDb() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "highlight_pro",
    });
    console.log("[check-db] Connected to database successfully.");
  } catch (connErr) {
    console.error("[check-db] ERROR: Cannot connect to database.");
    console.error("  Message:", connErr.message);
    if (connErr.code === "ECONNREFUSED") {
      console.error("  -> MySQL server is not running or the host/port is wrong.");
      console.error(`     HOST: ${process.env.DB_HOST || "localhost"}  PORT: ${process.env.DB_PORT || "3306"}`);
    } else if (connErr.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("  -> Wrong DB_USER or DB_PASSWORD in .env");
    } else if (connErr.code === "ER_BAD_DB_ERROR") {
      console.error(`  -> Database '${process.env.DB_NAME || "highlight_pro"}' does not exist.`);
      console.error("     Create it with: CREATE DATABASE highlight_pro;");
    }
    process.exit(1);
  }

  try {
    // Check if migrations have been run
    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
    );

    if (tables.length === 0) {
      console.error("[check-db] ERROR: No tables found in the database.");
      console.error("  -> Migrations have not been run. Execute:");
      console.error("     node server/scripts/migrate.js");
      process.exit(1);
    }

    console.log(`[check-db] Found ${tables.length} table(s):`, tables.map(t => t.TABLE_NAME).join(", "));

    // Check system_settings specifically
    const hasSettings = tables.some(t => t.TABLE_NAME === "system_settings");
    if (!hasSettings) {
      console.error("[check-db] ERROR: 'system_settings' table does not exist.");
      console.error("  -> Run migrations first: node server/scripts/migrate.js");
      process.exit(1);
    }

    const [rows] = await connection.query("SELECT `key`, value FROM system_settings ORDER BY `key`");
    console.log(`\n[check-db] system_settings (${rows.length} rows):`);
    rows.forEach(r => console.log(`  ${r.key.padEnd(35)} = ${r.value}`));

  } catch (err) {
    console.error("[check-db] Query error:", err.message);
    console.error("  Code:", err.code);
  } finally {
    await connection.end();
    console.log("[check-db] Connection closed.");
  }
}

checkDb();
