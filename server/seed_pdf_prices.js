import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  database: process.env.DB_NAME || "highlight_pro",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
});

async function run() {
  try {
    console.log("Connected to MySQL database!");

    // ─── INSERT SOLAR PANELS ────────────────────────────────────────
    const newPanels = [
      { brand: "Sunora", watt: 545, type: "Bifacial", price: 12800 },
      { brand: "Sunora", watt: 580, type: "TOPCon", price: 14000 },
      { brand: "Adani Solar", watt: 540, type: "Bifacial", price: 12800 },
      { brand: "Adani Solar", watt: 605, type: "TOPCon", price: 14300 },
      { brand: "Waaree", watt: 535, type: "Mono PERC", price: 11800 },
      { brand: "Waaree", watt: 570, type: "TOPCon", price: 13800 },
    ];

    for (const p of newPanels) {
      const [checkRows] = await connection.query(
        "SELECT id FROM panels WHERE brand = ? AND watt = ? AND type = ?",
        [p.brand, p.watt, p.type]
      );
      if (checkRows.length === 0) {
        await connection.query(
          "INSERT INTO panels (brand, watt, type, price_per_panel) VALUES (?, ?, ?, ?)",
          [p.brand, p.watt, p.type, p.price]
        );
        console.log(`Inserted panel: ${p.brand} ${p.watt}W ${p.type}`);
      } else {
        await connection.query(
          "UPDATE panels SET price_per_panel = ? WHERE brand = ? AND watt = ? AND type = ?",
          [p.price, p.brand, p.watt, p.type]
        );
        console.log(`Updated panel: ${p.brand} ${p.watt}W ${p.type} to price ${p.price}`);
      }
    }

    // ─── INSERT INVERTERS ───────────────────────────────────────────
    const newInverters = [
      { brand: "Xwatt/REM/Vsole", kw: 3.6, type: "String", price: 21800 },
      { brand: "Xwatt/REM/Vsole", kw: 4.0, type: "String", price: 24800 },
      { brand: "Xwatt/REM/Vsole", kw: 5.0, type: "String", price: 27800 },
      { brand: "Xwatt/REM/Vsole", kw: 10.0, type: "String", price: 45800 },
      { brand: "Waaree", kw: 5.0, type: "String", price: 30800 },
      { brand: "Waaree", kw: 10.0, type: "String", price: 50800 },
      { brand: "Solaryan", kw: 5.0, type: "String", price: 26800 },
      { brand: "Solaryan", kw: 10.0, type: "String", price: 44800 },
    ];

    for (const inv of newInverters) {
      const [checkRows] = await connection.query(
        "SELECT id FROM inverters WHERE brand = ? AND kw = ? AND type = ?",
        [inv.brand, inv.kw, inv.type]
      );
      if (checkRows.length === 0) {
        await connection.query(
          "INSERT INTO inverters (brand, kw, type, price_per_unit) VALUES (?, ?, ?, ?)",
          [inv.brand, inv.kw, inv.type, inv.price]
        );
        console.log(`Inserted inverter: ${inv.brand} ${inv.kw}kW ${inv.type}`);
      } else {
        await connection.query(
          "UPDATE inverters SET price_per_unit = ? WHERE brand = ? AND kw = ? AND type = ?",
          [inv.price, inv.brand, inv.kw, inv.type]
        );
        console.log(`Updated inverter: ${inv.brand} ${inv.kw}kW ${inv.type} to price ${inv.price}`);
      }
    }

    console.log("Database seeding completed successfully!");
  } catch (err) {
    console.error("Error seeding database:", err);
  } finally {
    await connection.end();
  }
}

run();
