/**
 * Unified Database Setup Script for Highlight Pro
 * ─────────────────────────────────────────────────────────────
 * Automatically:
 * 1. Checks if server/.env exists; if not, copies .env.example.
 * 2. Creates the target MySQL database if it doesn't exist.
 * 3. Runs all sequential schema migrations.
 * 4. Programmatically runs all product, pricing, and settings seeding scripts.
 *
 * Usage: node scripts/setup-db.js
 */

import { fork } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.resolve(__dirname, "..");

// Helper to run a script as a child process
function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n🏃 Running: node ${path.basename(scriptPath)}...`);
    const cp = fork(scriptPath, [], { cwd: SERVER_ROOT });

    cp.on("exit", (code) => {
      if (code === 0) {
        console.log(`✅ Completed successfully.`);
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    cp.on("error", (err) => {
      reject(err);
    });
  });
}

async function setup() {
  console.log("====================================================");
  console.log("🌞 HIGHLIGHT PRO — UNIFIED DATABASE SETUP STARTING");
  console.log("====================================================");

  // 1. Env Configuration Check
  const envPath = path.join(SERVER_ROOT, ".env");
  const envExamplePath = path.join(SERVER_ROOT, ".env.example");

  if (!fs.existsSync(envPath)) {
    console.log("⚠️  server/.env file not found. Copying from .env.example...");
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log("📝 Created server/.env from .env.example.");
      console.log("🚨 IMPORTANT: Please edit server/.env to insert your database credentials if different from defaults.");
    } else {
      console.error("❌ ERROR: server/.env.example not found. Cannot auto-create .env.");
      process.exit(1);
    }
  }

  try {
    // 2. Create Database
    await runScript(path.join(SERVER_ROOT, "scripts", "create-db.js"));

    // 3. Run Migrations
    await runScript(path.join(SERVER_ROOT, "scripts", "migrate.js"));

    // 4. Update Panels & Prices
    await runScript(path.join(SERVER_ROOT, "scripts", "update-panels.js"));

    // 5. Update Inverters
    await runScript(path.join(SERVER_ROOT, "scripts", "update-inverters.js"));

    // 6. Update Accessories & Labour
    await runScript(path.join(SERVER_ROOT, "scripts", "update-accessories.js"));

    // 7. Update Pre-packaged Kits
    await runScript(path.join(SERVER_ROOT, "scripts", "update-kits.js"));

    // 8. Seed Pricing calculation settings (GST, Profits, etc.)
    await runScript(path.join(SERVER_ROOT, "scripts", "seed-pricing-settings.js"));

    // 9. Apply Quotations status constraint fixes
    await runScript(path.join(SERVER_ROOT, "scripts", "fix-quotations-status.js"));

    // 10. Final Verification Check
    await runScript(path.join(SERVER_ROOT, "scripts", "check-db.js"));

    console.log("\n====================================================");
    console.log("🎉 UNIFIED DATABASE SETUP COMPLETED SUCCESSFULLY!");
    console.log("   Your project database is fully configured and seeded.");
    console.log("====================================================\n");
  } catch (error) {
    console.error("\n❌ SETUP FAILED:", error.message);
    console.error("⛔ Setup aborted. Please fix the error above and re-run.");
    process.exit(1);
  }
}

setup();
