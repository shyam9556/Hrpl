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
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 4, kw: 2.20, price: 110500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 5, kw: 2.75, price: 130500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 6, kw: 3.30, price: 149000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 7, kw: 3.85, price: 177500 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 8, kw: 4.40, price: 196200 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 9, kw: 4.95, price: 223700 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 10, kw: 5.50, price: 248000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 11, kw: 6.05, price: 287000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 12, kw: 6.60, price: 320000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 15, kw: 8.25, price: 368000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 18, kw: 9.90, price: 424000 },

  // === ADANI TOPCON ===
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 4, kw: 2.48, price: 119500 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 5, kw: 3.10, price: 141000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 6, kw: 3.72, price: 162000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 7, kw: 4.34, price: 191700 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 8, kw: 4.96, price: 213000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 9, kw: 5.58, price: 242500 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 10, kw: 6.20, price: 287000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 11, kw: 6.82, price: 313500 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 12, kw: 7.44, price: 333700 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 13, kw: 8.06, price: 358600 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 16, kw: 9.92, price: 421500 },

  // === WAAREE BIFACIAL ===
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 4, kw: 2.16, price: 104000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 5, kw: 2.70, price: 122000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 6, kw: 3.24, price: 140000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 7, kw: 3.78, price: 165000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 8, kw: 4.32, price: 182000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 9, kw: 4.86, price: 210000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 10, kw: 5.40, price: 232500 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 11, kw: 5.94, price: 255000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 12, kw: 6.48, price: 290000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 13, kw: 7.02, price: 311500 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 14, kw: 7.56, price: 327500 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 15, kw: 8.10, price: 344000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 16, kw: 7.56, price: 363000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 17, kw: 8.10, price: 380700 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 18, kw: 9.72, price: 397000 },

  // === WAAREE TOPCON ===
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 4, kw: 2.34, price: 110000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 5, kw: 2.92, price: 129500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 6, kw: 3.51, price: 149500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 7, kw: 4.09, price: 178500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 8, kw: 4.68, price: 199000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 9, kw: 5.26, price: 229000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 10, kw: 5.85, price: 266000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 11, kw: 6.43, price: 291000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 12, kw: 7.02, price: 306500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 13, kw: 7.60, price: 329500 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 14, kw: 8.19, price: 356000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 15, kw: 8.77, price: 375000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 16, kw: 9.36, price: 396000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 17, kw: 9.94, price: 417000 },

  // === RAYZON BIFACIAL ===
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 4, kw: 2.20, price: 96500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 5, kw: 2.75, price: 112000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 6, kw: 3.30, price: 129500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 7, kw: 3.85, price: 151000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 8, kw: 4.40, price: 165500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 9, kw: 4.95, price: 190000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 10, kw: 5.50, price: 211500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 11, kw: 6.05, price: 250000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 12, kw: 6.60, price: 264500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 13, kw: 7.15, price: 284000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 14, kw: 7.70, price: 298500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 15, kw: 8.25, price: 313500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 16, kw: 8.80, price: 329500 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 17, kw: 9.35, price: 345000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 18, kw: 9.90, price: 360000 }
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
      // Calculate standard inverter size rule (nearest to kw):
      let invKw = 3.6;
      if (item.kw <= 2.5) invKw = 2.3;
      else if (item.kw <= 3.8) invKw = 3.6;
      else if (item.kw <= 4.4) invKw = 4.2;
      else if (item.kw <= 4.85) invKw = 4.7;
      else if (item.kw <= 5.2) invKw = 5.0;
      else if (item.kw <= 5.7) invKw = 5.4;
      else if (item.kw <= 6.5) invKw = 6.0;
      else if (item.kw <= 7.5) invKw = 7.0;
      else if (item.kw <= 8.5) invKw = 8.0;
      else if (item.kw <= 9.5) invKw = 9.0;
      else invKw = 10.0;


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
