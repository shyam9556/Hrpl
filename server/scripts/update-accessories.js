/**
 * Update Accessories Script
 * ─────────────────────────────────────────────────────────────
 * Clears old accessories and seeds the database with the 28 new
 * items from your BOM spreadsheet (GI hot dip pipes, bolts, cables,
 * connectors, pipes, etc.) along with their specifications and rates.
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

const accessoriesData = [
  { key_name: "gi_hot_dip_pipe_60_40", display_name: "GI HOT DIP PIPE 60*40 (HINDUSTAR 80 MIC)", price: 1475.00, unit: "NOS" },
  { key_name: "gi_hot_dip_pipe_80_40", display_name: "GI HOT DIP PIPE 80*40 (HINDUSTAR 80 MIC)", price: 1870.00, unit: "NOS" },
  { key_name: "gi_hot_dip_pipe_40_40", display_name: "GI HOT DIP PIPE 40*40 (HINDUSTAR 80 MIC)", price: 1245.00, unit: "NOS" },
  { key_name: "12_mm_zinc_rode", display_name: "12 MM ZINC RODE (12*2 MTR)", price: 100.00, unit: "NOS" },
  { key_name: "nut_washer", display_name: "NUT WASHER (12 MM)", price: 0.00, unit: "NOS" },
  { key_name: "j_bolt_with_flange_nut", display_name: "J BOLT WITH FLANGE NUT (SS 304)", price: 14.00, unit: "NOS" },
  { key_name: "anchor_fastner", display_name: "ANCHOR FASTNER (STANDARD 10MM/3)", price: 9.00, unit: "NOS" },
  { key_name: "base_plate", display_name: "BASE PLATE (MS-125*125*3 MM)", price: 27.00, unit: "NOS" },
  { key_name: "zinc_spray", display_name: "ZINC SPRAY (AEROSOL)", price: 170.00, unit: "NOS" },
  { key_name: "foundation_concrete_dry_mix", display_name: "FOUNDATION CONCRETE DRY MIX (10 KG)", price: 170.00, unit: "BAG" },
  { key_name: "foundation_pp_sheet", display_name: "FOUNDATION PP SHEET (6 INCH)", price: 35.00, unit: "NOS" },
  { key_name: "acdb", display_name: "ACDB (L&T ELMEX)", price: 800.00, unit: "NOS" },
  { key_name: "dcdb", display_name: "DCDB (L&T ELMEX)", price: 800.00, unit: "NOS" },
  { key_name: "earthing_la_electrode", display_name: "EARTHING & LA ELECTRODE (VASUDHARA)", price: 500.00, unit: "SET" },
  { key_name: "earthing_chemical", display_name: "EARTHING CHEMICAL (VASUDHARA)", price: 85.00, unit: "BAG" },
  { key_name: "polycab_dc_cable_red", display_name: "POLYCAB DC CABLE 4 SQ MM (RED)", price: 58.50, unit: "MTR" },
  { key_name: "polycab_dc_cable_black", display_name: "POLYCAB DC CABLE 4 SQ MM (BLACK)", price: 58.50, unit: "MTR" },
  { key_name: "addison_ac_cable_red", display_name: "ADDISON AC CABLE 2.5 SQ MM (RED)", price: 31.35, unit: "MTR" },
  { key_name: "addison_ac_cable_black", display_name: "ADDISON AC CABLE 2.5 SQ MM (BLACK)", price: 31.35, unit: "MTR" },
  { key_name: "addison_la_cable", display_name: "ADDISON LA CABLE 16 MM (GREEN)", price: 22.77, unit: "MTR" },
  { key_name: "addison_earthing_cable", display_name: "ADDISON EARTHING GREE 2.5 SQ MM (GREEN)", price: 31.35, unit: "MTR" },
  { key_name: "wire_tap", display_name: "WIRE TAP (RED)", price: 15.00, unit: "NOS" },
  { key_name: "mc4_connector", display_name: "MC4 CONNECTOR (SIBAS-1500 VDC)", price: 25.00, unit: "NOS" },
  { key_name: "cable_tie", display_name: "CABLE TIE (KRIPSON 300 MM)", price: 100.00, unit: "PKT" },
  { key_name: "conduit_pipe", display_name: "CONDUIT PIPE 25 MM HMS (OMEGA)", price: 37.00, unit: "NOS" },
  { key_name: "pvc_elbow", display_name: "PVC ELBOW 25 MM (OMEGA)", price: 2.50, unit: "NOS" },
  { key_name: "pvc_tee", display_name: "PVC TEE 25 MM (OMEGA)", price: 3.10, unit: "NOS" },
  { key_name: "pvc_clip", display_name: "PVC CLIP 25 MM (OMEGA)", price: 140.00, unit: "PKT" }
];

async function updateAccessories() {
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

    console.log("🧹 Clearing old accessories...");
    await connection.query("DELETE FROM accessories");

    console.log("🧹 Clearing old accessories from stock_items...");
    await connection.query("DELETE FROM stock_items WHERE category = 'Accessory' OR category = 'Wire'");

    console.log("🔨 Seeding 28 new accessories and labour items...");
    let count = 0;
    for (const item of accessoriesData) {
      // Insert into accessories
      await connection.query(
        `INSERT INTO accessories (key_name, display_name, price, unit)
         VALUES (?, ?, ?, ?)`,
        [item.key_name, item.display_name, item.price, item.unit]
      );

      // Determine stock category
      const isWire = item.key_name.includes("cable") || item.key_name.includes("wire");
      const category = isWire ? "Wire" : "Accessory";
      const stockUnit = item.unit.toLowerCase() === "mtr" ? "meters" : "pcs";

      // Sync to stock_items
      await connection.query(
        `INSERT INTO stock_items (category, item_name, quantity, unit, unit_price)
         VALUES (?, ?, ?, ?, ?)`,
        [category, item.display_name, 0, stockUnit, item.price]
      );

      count++;
    }

    await connection.commit();
    console.log(`\n✅ Success! Seeded ${count} real accessory and labour configurations.`);
  } catch (error) {
    console.error("❌ Failed to update accessories database:", error.message);
    await connection.rollback();
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

updateAccessories().catch((err) => {
  console.error("Fatal accessories update error:", err.message);
  process.exit(1);
});
