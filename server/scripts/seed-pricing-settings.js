import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function seedSettings() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "highlight_pro",
  });

  try {
    console.log("🤖 Seeding quotation calculation settings...");
    
    // Update GST rate to 8.9%
    await connection.query(
      "UPDATE system_settings SET value = '8.9' WHERE `key` = 'gst_rate'"
    );
    console.log("✅ Updated gst_rate to 8.9%");

    const settings = [
      // ISSUE-18: Updated descriptions to reflect actual formula roles
      { key: "bom_price_per_kw", value: "3900", description: "DC Wire Cost per kW in Rupees — used as BOM component in base cost formula" },
      { key: "labour_price_per_kw", value: "2000", description: "AC Wire Cost per kW in Rupees — used as Labour component in base cost formula" },
      { key: "commission_price_per_kw", value: "3000", description: "Mounting Structure Cost per kW in Rupees — used as Commission component in base cost formula" },
      { key: "profit_percentage", value: "10", description: "Profit Margin Percentage (%)" },
      { key: "transport_percentage", value: "1.2", description: "Transport Charge Percentage (%)" },
      // MINOR-05: Environmental impact stats displayed in quotation builder
      { key: "solar_yield_per_kw", value: "1450", description: "Estimated annual solar yield per kW installed (kWh) — adjust for your region's irradiance" },
      { key: "co2_per_kw", value: "1.2", description: "Estimated CO2 offset per kW per year (Tons) — used in environmental impact display" },
    ];

    for (const s of settings) {
      await connection.query(
        "INSERT INTO system_settings (`key`, value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
        [s.key, s.value, s.description, s.value]
      );
      console.log(`✅ Seeded settings key: ${s.key}`);
    }

    console.log("\n🎉 All quotation calculation settings seeded successfully!");
  } catch (error) {
    console.error("❌ Failed to seed settings:", error.message);
  } finally {
    await connection.end();
  }
}

seedSettings();
