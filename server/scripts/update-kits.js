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
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 4, kw: 2.20, price: 108000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 4, kw: 2.48, price: 116000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 4, kw: 2.16, price: 102000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 4, kw: 2.34, price: 108000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 4, kw: 2.20, price: 94000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 5, kw: 2.75, price: 127000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 5, kw: 3.10, price: 138000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 5, kw: 2.70, price: 120000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 5, kw: 2.92, price: 127000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 5, kw: 2.75, price: 110000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 6, kw: 3.30, price: 147000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 6, kw: 3.72, price: 160000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 6, kw: 3.24, price: 139000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 6, kw: 3.51, price: 147000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 6, kw: 3.30, price: 126000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 7, kw: 3.85, price: 175000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 7, kw: 4.34, price: 190000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 7, kw: 3.78, price: 165000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 7, kw: 4.09, price: 175000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 7, kw: 3.85, price: 151000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 8, kw: 4.40, price: 194000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 8, kw: 4.96, price: 211000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 8, kw: 4.32, price: 183000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 8, kw: 4.68, price: 194000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 8, kw: 4.40, price: 166000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 9, kw: 4.95, price: 222000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 9, kw: 5.58, price: 240000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 9, kw: 4.86, price: 209000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 9, kw: 5.26, price: 221000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 9, kw: 4.95, price: 190000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 10, kw: 5.50, price: 247000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 10, kw: 6.20, price: 268000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 10, kw: 5.40, price: 233000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 10, kw: 5.85, price: 246000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 10, kw: 5.50, price: 212000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 11, kw: 6.05, price: 286000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 11, kw: 6.82, price: 309000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 11, kw: 5.94, price: 271000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 11, kw: 6.43, price: 286000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 11, kw: 6.05, price: 248000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 12, kw: 6.60, price: 305000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 12, kw: 7.44, price: 330000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 12, kw: 6.48, price: 288000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 12, kw: 7.02, price: 305000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 12, kw: 6.60, price: 263000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 13, kw: 7.15, price: 328000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 13, kw: 8.06, price: 355000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 13, kw: 7.02, price: 309000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 13, kw: 7.60, price: 327000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 13, kw: 7.15, price: 282000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 14, kw: 7.70, price: 346000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 14, kw: 8.68, price: 376000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 14, kw: 7.56, price: 327000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 14, kw: 8.19, price: 346000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 14, kw: 7.70, price: 297000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 15, kw: 8.25, price: 365000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 15, kw: 9.30, price: 396000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 15, kw: 8.10, price: 344000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 15, kw: 8.77, price: 364000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 15, kw: 8.25, price: 312000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 16, kw: 8.80, price: 385000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 16, kw: 9.92, price: 419000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 16, kw: 8.64, price: 363000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 16, kw: 9.36, price: 385000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 16, kw: 8.80, price: 329000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 17, kw: 9.35, price: 406000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 17, kw: 10.54, price: 442000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 17, kw: 9.18, price: 382000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 17, kw: 9.95, price: 406000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 17, kw: 9.35, price: 347000 },
  { brand: "Adani", type: "Bifacial", watt: "540-555", panels: 18, kw: 9.90, price: 425000 },
  { brand: "Adani", type: "TOPCon", watt: "605-620", panels: 18, kw: 11.16, price: 463000 },
  { brand: "Waaree", type: "Bifacial", watt: "535-540", panels: 18, kw: 9.72, price: 400000 },
  { brand: "Waaree", type: "TOPCon", watt: "570-585", panels: 18, kw: 10.53, price: 425000 },
  { brand: "Rayzon", type: "Bifacial", watt: "540-550", panels: 18, kw: 9.90, price: 362000 }
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
      // Calculate standard inverter size rule (matches BOM sheet exactly):
      let invKw = 3.6;
      if (item.panels <= 6) invKw = 3.6;
      else if (item.panels === 7) invKw = 4.2;
      else if (item.panels === 8) invKw = 5.0;
      else if (item.panels === 9) invKw = 5.4;
      else if (item.panels === 10) invKw = 6.0;
      else if (item.panels <= 12) invKw = 7.0;
      else if (item.panels <= 15) invKw = 8.0;
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
