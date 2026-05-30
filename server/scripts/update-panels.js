/**
 * Update Solar Panels Script (Ranges Version)
 * ─────────────────────────────────────────────────────────────
 * 1. Modifies the database `panels.watt` column to `VARCHAR(50)`.
 * 2. Removes all previous panel records and panel stock items.
 * 3. Inserts a single panel record representing each brand + type + range.
 * 4. Synchronizes stock_items with these ranges.
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT, 10) || 3306;
const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "";
const dbName = process.env.DB_NAME || "highlight_pro";

const panelRanges = [
  // 1. Adani
  { brand: "Adani", type: "Bifacial", watt: "540-555", price: 15125 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", price: 17050 },

  // 2. Waaree
  { brand: "Waaree", type: "Bifacial", watt: "535-540", price: 14575 },
  { brand: "Waaree", type: "TOPCon", watt: "605-620", price: 16430 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", price: 15370 },

  // 3. Goldi
  { brand: "Goldi", type: "Bifacial", watt: "540-555", price: 13475 },
  { brand: "Goldi", type: "TOPCon", watt: "605-620", price: 15370 },

  // 4. Vikram
  { brand: "Vikram", type: "Bifacial", watt: "540-555", price: 12925 },
  { brand: "Vikram", type: "TOPCon", watt: "580-600", price: 13630 }
];

async function updatePanels() {
  console.log(`🤖 Connecting to MySQL at ${dbHost}:${dbPort} as ${dbUser} for database "${dbName}"...`);
  
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  });

  try {
    console.log("🔄 Starting transaction...");
    await connection.beginTransaction();

    // Disable foreign key checks
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    // 1. Modify watt column in panels table to VARCHAR(50)
    console.log("⚡ Altering table `panels` to support VARCHAR(50) for `watt`...");
    await connection.query("ALTER TABLE panels MODIFY COLUMN watt VARCHAR(50) NOT NULL");

    // 2. Clear previous quotations
    // ⚠️  SAFETY GUARD: Refuse to wipe quotations in production environment.
    //    Set NODE_ENV=development (or omit it) to allow this destructive step.
    if (process.env.NODE_ENV === 'production') {
      console.error("❌ ABORTED: Refusing to TRUNCATE quotations in production. Set NODE_ENV != 'production' to run this script.");
      await connection.rollback();
      await connection.end();
      process.exit(1);
    }
    console.log("🧹 Clearing old fake quotations...");
    await connection.query("TRUNCATE TABLE quotations");

    // 3. Clear previous panel data
    console.log("🧹 Clearing old fake panels data from `panels`...");
    await connection.query("TRUNCATE TABLE panels");

    // 4. Clear old panels from `stock_items`
    console.log("🧹 Clearing old panels from `stock_items`...");
    await connection.query("DELETE FROM stock_items WHERE category = 'Panel'");

    // 5. Insert new range panels and add to stock
    console.log("🔨 Inserting real solar panel ranges and syncing stock items...");
    
    let panelCount = 0;
    for (const item of panelRanges) {
      // Insert into panels
      await connection.query(
        "INSERT INTO panels (brand, type, watt, price_per_panel, is_active) VALUES (?, ?, ?, ?, ?)",
        [item.brand, item.type, item.watt, item.price, 1]
      );

      // Synchronize stock items
      const stockItemName = `${item.brand} ${item.watt}W ${item.type}`;
      await connection.query(
        "INSERT INTO stock_items (category, item_name, quantity, unit, unit_price) VALUES (?, ?, ?, ?, ?)",
        ["Panel", stockItemName, 0, "pcs", item.price]
      );

      panelCount++;
    }

    // Re-enable foreign key checks
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    await connection.commit();
    console.log(`\n✅ Success! Inserted ${panelCount} real solar panel range configurations into the database.`);
  } catch (error) {
    console.error("❌ Failed to update panels database:", error.message);
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.rollback();
    } catch (e) {}
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

updatePanels().catch((err) => {
  console.error("Fatal panel update error:", err.message);
  process.exit(1);
});
