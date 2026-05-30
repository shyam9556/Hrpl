/**
 * Update Inverters Script
 * ─────────────────────────────────────────────────────────────
 * 1. Modifies the database `inverters.type` column to `VARCHAR(50)`.
 * 2. Removes all previous inverter records and inverter stock items.
 * 3. Inserts real inverter specifications (Vsole, Polycab) with single/three phase and custom pricing.
 * 4. Synchronizes stock_items with these models.
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

const vsoleInverters = [
  // Single phase - Single mppt
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 2.3, price: 13500 },
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 3.6, price: 13600 },
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 4.2, price: 19500 },
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 4.7, price: 20500 },
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 5.0, price: 24800 },
  { brand: "Vsole", type: "Single Phase (Single MPPT)", kw: 5.4, price: 25000 },
  
  // Single phase - Dual mppt dual string
  { brand: "Vsole", type: "Single Phase (Dual MPPT)", kw: 6.0, price: 27800 },

  // Three phase
  { brand: "Vsole", type: "Three Phase", kw: 4.0, price: 41500 },
  { brand: "Vsole", type: "Three Phase", kw: 5.0, price: 42500 },
  { brand: "Vsole", type: "Three Phase", kw: 6.0, price: 43500 },
  { brand: "Vsole", type: "Three Phase", kw: 7.0, price: 44500 },
  { brand: "Vsole", type: "Three Phase", kw: 8.0, price: 45500 },
  { brand: "Vsole", type: "Three Phase", kw: 9.0, price: 46000 },
  { brand: "Vsole", type: "Three Phase", kw: 10.0, price: 46500 }
];

// Generate Polycab inverters by adding 300 to each Vsole segment
const polycabInverters = vsoleInverters.map(inv => ({
  brand: "Polycab",
  type: inv.type,
  kw: inv.kw,
  price: inv.price + 300
}));

const allInverters = [...vsoleInverters, ...polycabInverters];

async function updateInverters() {
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

    // 1. Modify type column in inverters table to VARCHAR(50)
    console.log("⚡ Altering table `inverters` to support VARCHAR(50) for `type`...");
    await connection.query("ALTER TABLE inverters MODIFY COLUMN type VARCHAR(50) NOT NULL DEFAULT 'Single Phase (Single MPPT)'");

    // 2. Clear previous quotations to avoid foreign key errors on missing old inverters
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

    // 3. Clear previous inverter data
    console.log("🧹 Clearing old fake inverters data from `inverters`...");
    await connection.query("TRUNCATE TABLE inverters");

    // 4. Clear old inverters from `stock_items`
    console.log("🧹 Clearing old inverters from `stock_items`...");
    await connection.query("DELETE FROM stock_items WHERE category = 'Inverter'");

    // 5. Insert new real inverters and add to stock
    console.log("🔨 Inserting real inverters and syncing stock items...");
    
    let invCount = 0;
    for (const item of allInverters) {
      // Insert into inverters
      await connection.query(
        "INSERT INTO inverters (brand, type, kw, price_per_unit, is_active) VALUES (?, ?, ?, ?, ?)",
        [item.brand, item.type, item.kw, item.price, 1]
      );

      // Match buildInverterItemName JS logic:
      // Strip trailing zeros for integer values (e.g. 5.00 -> '5', 5.5 -> '5.5')
      const formattedKw = item.kw % 1 === 0 ? String(Math.floor(item.kw)) : String(item.kw);
      const stockItemName = `${item.brand} ${formattedKw}kW ${item.type}`;

      // Synchronize stock items
      await connection.query(
        "INSERT INTO stock_items (category, item_name, quantity, unit, unit_price) VALUES (?, ?, ?, ?, ?)",
        ["Inverter", stockItemName, 0, "pcs", item.price]
      );

      invCount++;
    }

    // Re-enable foreign key checks
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    await connection.commit();
    console.log(`\n✅ Success! Inserted ${invCount} real inverter configurations into the database.`);
  } catch (error) {
    console.error("❌ Failed to update inverters database:", error.message);
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.rollback();
    } catch (e) {}
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

updateInverters().catch((err) => {
  console.error("Fatal inverter update error:", err.message);
  process.exit(1);
});
