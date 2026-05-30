/**
 * Update Kits Script
 * ─────────────────────────────────────────────────────────────
 * 1. Creates `kit_prices` table in the database if it doesn't exist.
 * 2. Seeds it with the 44 real kit configurations for Adani and Waaree.
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

const kitsData = [
  // === ADANI BIFACIAL ===
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 4, kw: 2.20, price: 107500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 5, kw: 2.75, price: 126500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 6, kw: 3.30, price: 143700 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 7, kw: 3.85, price: 171800 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 8, kw: 4.40, price: 190500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 9, kw: 4.95, price: 216700 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 10, kw: 5.50, price: 238000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 11, kw: 6.05, price: 280000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 12, kw: 6.60, price: 311000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 15, kw: 8.25, price: 355000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 18, kw: 9.90, price: 415000 },

  // === ADANI TOPCON ===
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 4, kw: 2.48, price: 117000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 5, kw: 3.10, price: 138000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 6, kw: 3.72, price: 157700 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 7, kw: 4.34, price: 187000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 8, kw: 4.96, price: 208000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 9, kw: 5.58, price: 236500 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 10, kw: 6.20, price: 264500 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 11, kw: 6.82, price: 305000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 12, kw: 7.44, price: 320000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 13, kw: 8.06, price: 350000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 16, kw: 9.92, price: 410000 },

  // === WAAREE BIFACIAL ===
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 4, kw: 2.16, price: 103800 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 5, kw: 2.70, price: 121700 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 6, kw: 3.24, price: 138000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 7, kw: 3.78, price: 165000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 8, kw: 4.32, price: 182800 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 9, kw: 4.86, price: 208500 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 10, kw: 5.40, price: 233000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 11, kw: 5.94, price: 253000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 14, kw: 7.56, price: 321000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 15, kw: 8.10, price: 342500 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 18, kw: 9.72, price: 393500 },

  // === WAAREE TOPCON ===
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 4, kw: 2.32, price: 108500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 5, kw: 2.90, price: 127700 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 6, kw: 3.48, price: 145000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 7, kw: 4.06, price: 174000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 8, kw: 4.64, price: 193000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 9, kw: 5.22, price: 219000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 10, kw: 5.80, price: 245000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 11, kw: 6.38, price: 284500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 12, kw: 6.96, price: 302000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 14, kw: 8.12, price: 342000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-580", panels: 17, kw: 9.86, price: 397000 }
];

async function updateKits() {
  console.log(`🤖 Connecting to MySQL at ${dbHost}:${dbPort} as ${dbUser} for database "${dbName}"...`);
  
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  });

  try {
    console.log("⚡ Creating `kit_prices` table...");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kit_prices (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        brand       VARCHAR(100) NOT NULL,
        type        VARCHAR(100) NOT NULL,
        watt        VARCHAR(50) NOT NULL,
        kw          DECIMAL(8,2) NOT NULL,
        panels      INT NOT NULL,
        price       DECIMAL(12,2) NOT NULL,
        inv_brand   VARCHAR(100) NOT NULL DEFAULT 'Polycab/Vsole/Growatt',
        inv_kw      DECIMAL(6,2) NOT NULL DEFAULT 3.60,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log("🧹 Clearing old kit prices...");
    await connection.query("TRUNCATE TABLE kit_prices");

    console.log("🔨 Seeding real Raysolar kit prices...");
    let count = 0;
    for (const item of kitsData) {
      // Calculate standard inverter size rule:
      // kw <= 3.85 kW -> 3.6kW Inverter
      // kw > 3.85 and <= 6 kW -> 5.0kW Inverter
      // kw > 6 kW -> 10.0kW Inverter
      let invKw = 3.6;
      if (item.kw > 3.85 && item.kw <= 6.0) invKw = 5.0;
      else if (item.kw > 6.0) invKw = 10.0;

      await connection.query(
        `INSERT INTO kit_prices (brand, type, watt, panels, kw, price, inv_brand, inv_kw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.brand, item.type, item.watt, item.panels, item.kw, item.price, "Polycab/Vsole/Growatt", invKw]
      );
      count++;
    }

    console.log(`✅ Success! Seeded ${count} real RaySolar kit configurations.`);
  } catch (error) {
    console.error("❌ Failed to update kits database:", error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

updateKits().catch((err) => {
  console.error("Fatal kit update error:", err.message);
  process.exit(1);
});
