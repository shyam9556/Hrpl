/**
 * Create Database Script
 * ─────────────────────────────────────────────────────────────
 * Connects to MySQL using root credentials and ensures that the
 * target database exists before running migrations.
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

async function createDatabase() {
  console.log(`🤖 Connecting to MySQL at ${dbHost}:${dbPort} as ${dbUser}...`);
  
  // Connect without specifying a database name
  const connection = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
  });

  try {
    console.log(`🔨 Creating database "${dbName}" if it does not exist...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    console.log(`✅ Database "${dbName}" is ready!`);
  } catch (error) {
    console.error(`❌ Failed to create database:`, error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

createDatabase().catch((err) => {
  console.error("Fatal database creation error:", err.message);
  process.exit(1);
});
