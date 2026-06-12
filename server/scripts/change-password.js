/**
 * CLI Tool to Reset User Passwords (including Admin)
 * 
 * Usage: node scripts/change-password.js <email> <new_password>
 */

import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.log("\n❌ Error: Missing arguments.");
  console.log("Usage: node scripts/change-password.js <email> <new_password>\n");
  process.exit(1);
}

if (newPassword.length < 8) {
  console.log("\n❌ Error: Password must be at least 8 characters long.\n");
  process.exit(1);
}

async function run() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "highlight_pro",
    });

    // Check if user exists
    const [users] = await connection.query("SELECT id, name, role FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      console.log(`\n❌ Error: No user found with email '${email}'.\n`);
      process.exit(1);
    }

    const user = users[0];
    console.log(`\n🔄 Updating password for ${user.role} '${user.name}' (${email})...`);

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    // Update DB
    await connection.query(
      "UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?",
      [hash, user.id]
    );

    console.log("✅ Password updated successfully! All active sessions/JWTs for this user have been invalidated.\n");
  } catch (err) {
    console.error("\n❌ Database error:", err.message, "\n");
  } finally {
    if (connection) await connection.end();
  }
}

run();
