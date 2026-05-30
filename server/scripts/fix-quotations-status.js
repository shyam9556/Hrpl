import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

/**
 * fix-quotations-status.js
 *
 * ISSUE-20 fix: Wraps both the UPDATE and the ALTER TABLE in a try/catch.
 * MySQL does not support DDL (ALTER TABLE) inside transactions — DDL auto-commits.
 * However we at least ensure that if the ALTER fails, we log clearly rather than
 * leaving the data in an inconsistent state. We also confirm the data update
 * succeeded before proceeding to the schema change.
 */
async function fixStatus() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "highlight_pro",
  });

  console.log("[fix-quotations-status] Starting...");

  try {
    // Step 1: Update existing 'Draft' rows to 'Pending' — do this first so the
    // subsequent ALTER doesn't encounter rows with the old 'Draft' value.
    const [updateRes] = await connection.query(
      "UPDATE quotations SET status = 'Pending' WHERE status = 'Draft'"
    );
    console.log(`[fix-quotations-status] Updated ${updateRes.affectedRows} 'Draft' quotation(s) to 'Pending'.`);

    // Step 2: Alter column ENUM to remove 'Draft' and make 'Pending' the default.
    // NOTE: MySQL DDL (ALTER TABLE) cannot be rolled back — it auto-commits.
    // If this step fails after step 1 succeeded, the data change is permanent
    // but the schema still has the old ENUM. Re-running this script is safe.
    await connection.query(
      "ALTER TABLE quotations MODIFY COLUMN status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending'"
    );
    console.log("[fix-quotations-status] ENUM altered: 'Draft' removed, 'Pending' is now default.");
    console.log("[fix-quotations-status] Done. Database updated successfully.");

  } catch (error) {
    console.error("[fix-quotations-status] FAILED:", error.message);
    console.error("  Error code:", error.code);
    if (error.code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD") {
      console.error("  -> Some rows still contain 'Draft'. Run step 1 manually:");
      console.error("     UPDATE quotations SET status = 'Pending' WHERE status = 'Draft';");
    }
    if (error.code === "ER_NO_SUCH_TABLE") {
      console.error("  -> The 'quotations' table does not exist. Run migrations first:");
      console.error("     node server/scripts/migrate.js");
    }
    process.exit(1);
  } finally {
    await connection.end();
  }
}

fixStatus();
