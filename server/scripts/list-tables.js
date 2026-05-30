import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function listTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "highlight_pro",
  });

  try {
    const [tables] = await connection.query("SHOW TABLES");
    const key = `Tables_in_${process.env.DB_NAME || "highlight_pro"}`;
    
    console.log(`\n📊 Tables in database "${process.env.DB_NAME}":\n`);
    for (const row of tables) {
      const tableName = row[key];
      const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
      console.log(`🔹 Table: ${tableName}`);
      console.log("   Columns:");
      for (const col of columns) {
        console.log(`     - ${col.Field} (${col.Type}) ${col.Null === "NO" ? "NOT NULL" : "NULL"} ${col.Key ? `[${col.Key}]` : ""}`);
      }
      console.log("");
    }
  } catch (error) {
    console.error("Error reading schema:", error.message);
  } finally {
    await connection.end();
  }
}

listTables();
