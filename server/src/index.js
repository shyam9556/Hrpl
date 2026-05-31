import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import env from "./config/env.js";
import db from "./config/database.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/uploads.js";
import priceRoutes from "./routes/prices.js";
import settingRoutes from "./routes/settings.js";
import stockRoutes from "./routes/stock.js";
import quotationRoutes from "./routes/quotations.js";
import customerRoutes from "./routes/customers.js";
import dealerRoutes from "./routes/dealers.js";
import dashboardRoutes from "./routes/dashboard.js";
import reportRoutes from "./routes/reports.js";
import inquiryRoutes from "./routes/inquiries.js";
import { verifySMTPConnection } from "./services/emailService.js";


// ─── Resolve __dirname for ES Modules ────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Create Express App ──────────────────────────────────
const app = express();

// ─── Security Middleware ─────────────────────────────────

// Helmet: sets various secure HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Allow Google Fonts stylesheets (loaded by index.css @import)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      // Allow Google Fonts files (.woff2, .ttf)
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      // Allow Google Maps iframes (used for geo-tagged photo location display in admin portal)
      frameSrc: ["https://maps.google.com"],
      // Force HTTPS for all sub-resources in production
      ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));

// CORS: allow requests from the React frontend
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Rate Limiting ───────────────────────────────────────

// General API rate limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isDev ? 1000 : 200,
  message: {
    success: false,
    error: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limit for auth routes: 30 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict login rate limit: 20 attempts per 15 minutes per IP
// (B2B setting: multiple staff on same office IP — 10 was too restrictive)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Don't count requests against the limit if they succeeded
  skipSuccessfulRequests: true,
});

// Apply general rate limiter in all environments
// In dev, the limit is high enough (1000) not to interfere with development
app.use("/api", generalLimiter);

// ─── Body Parsing ────────────────────────────────────────
// Increased to 50MB to accommodate the dealer registration endpoint which sends
// up to 3 base64-encoded identity documents in a single JSON payload.
// (3 × 10MB file × ~1.37 base64 overhead = ~41MB worst-case)
// All other endpoints send only JSON metadata and are unaffected.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─── Request Logging ─────────────────────────────────────
if (env.isDev) {
  app.use(morgan("dev"));
} else {
  // Production: log to stdout AND a daily rotating file
  // File: server/logs/access-YYYY-MM-DD.log (auto-created)
  const logsDir = path.resolve(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let currentDay = today();
  let logStream = fs.createWriteStream(
    path.join(logsDir, `access-${currentDay}.log`),
    { flags: "a" }
  );

  // Rotate the file at midnight without restarting the process
  const rotateDailyLog = () => {
    const now = today();
    if (now !== currentDay) {
      logStream.end();
      currentDay = now;
      logStream = fs.createWriteStream(
        path.join(logsDir, `access-${currentDay}.log`),
        { flags: "a" }
      );
    }
  };
  setInterval(rotateDailyLog, 60 * 1000); // check every minute

  // Write to both stdout and file
  const morganStream = {
    write: (msg) => {
      process.stdout.write(msg);
      logStream.write(msg);
    },
  };
  app.use(morgan("combined", { stream: morganStream }));
}

// ─── Create Upload Directories ───────────────────────────
const uploadBase = path.resolve(__dirname, "..", env.upload.dir);
const uploadDirs = [
  uploadBase,
  path.join(uploadBase, "quotations"),
  path.join(uploadBase, "registrations"),
  path.join(uploadBase, "customers"),
  path.join(uploadBase, "dealer_registrations"), // identity docs uploaded during registration
];

for (const dir of uploadDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created upload directory: ${dir}`);
  }
}

// NOTE: Uploaded files are NOT served statically (security risk — Aadhaar/PAN docs are sensitive).
// Files will be served through authenticated API routes in Task #4 (File Upload System).
// This ensures only authorized users (uploader + admin) can access documents.

// ─── Production Static Frontend Serving ──────────────────
// In production, serve the built React app from dist/
// The SPA fallback ensures that deep links (e.g. /?token=XXX for password
// reset) correctly serve index.html instead of returning 404.
const distPath = path.resolve(__dirname, "../../dist");
if (env.isProd && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// ─── Health Check Endpoint ───────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Highlight Pro API is running",
    version: "1.0.0",
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ──────────────────────────────────────────
// Apply rate limiters to specific auth endpoints (both dev and production)
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/change-password", authLimiter);
// Reupload verify: strict limit to prevent brute-forcing the dealer's registration password
app.use("/api/auth/reupload/verify", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/prices", priceRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/dealers", dealerRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/inquiries", inquiryRoutes);

// ─── 404 Handler for API routes ──────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      error: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  }
  // In production: serve the SPA fallback for any non-API route.
  // This handles direct navigation to the reset-password link (/?token=...) etc.
  if (env.isProd) {
    const indexHtml = path.resolve(__dirname, "../../dist/index.html");
    if (fs.existsSync(indexHtml)) {
      return res.sendFile(indexHtml);
    }
  }
  next();
});

// ─── Global Error Handler (must be last) ─────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────
const startServer = async () => {
  // Test database connection before starting
  const dbConnected = await db.testConnection();

  if (!dbConnected) {
    console.error("\n❌  Database connection failed. Server cannot start without a database.");
    console.error("   Check your DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in .env and ensure MySQL is running.\n");
    process.exit(1);
  }

  // Cleanup expired password reset tokens on startup
  try {
    const cleanup = await db.query("DELETE FROM password_reset_tokens WHERE expires_at < NOW()");
    if (cleanup.rowCount > 0) {
      console.log(`[Startup] Cleaned up ${cleanup.rowCount} expired password reset token(s).`);
    }
  } catch (err) {
    console.warn("[Startup] Could not clean expired password reset tokens:", err.message);
  }

  // Cleanup expired and unused re-upload tokens on startup
  try {
    const reuploadCleanup = await db.query(
      "DELETE FROM dealer_reupload_tokens WHERE expires_at < NOW() AND used = 0"
    );
    if (reuploadCleanup.rowCount > 0) {
      console.log(`[Startup] Cleaned up ${reuploadCleanup.rowCount} expired re-upload token(s).`);
    }
  } catch (err) {
    console.warn("[Startup] Could not clean expired re-upload tokens:", err.message);
  }

  app.listen(env.port, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║       🌞 HIGHLIGHT PRO — API SERVER              ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  Status:      ✅ Running                         ║`);
    console.log(`║  Port:        ${String(env.port).padEnd(35)}║`);
    console.log(`║  Environment: ${env.nodeEnv.padEnd(35)}║`);
    console.log(`║  Database:    ✅ Connected                       ║`);
    console.log(`║  Health:      http://localhost:${env.port}/api/health  ║`);
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");

    // Verify SMTP connection after server starts — non-fatal if it fails
    verifySMTPConnection().catch(() => {});
  });
};

startServer();

// ─── Graceful Shutdown ───────────────────────────────────
// Handles SIGTERM (systemctl stop, Docker, process manager) and
// SIGINT (Ctrl+C in terminal) to close connections cleanly before exit.
// Without this, in-flight DB queries are dropped and log files are not flushed.
const gracefulShutdown = async (signal) => {
  console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);

  // Force-exit after 10 seconds if something hangs
  const forceExitTimer = setTimeout(() => {
    console.error("[Shutdown] Forced exit after 10s timeout.");
    process.exit(1);
  }, 10_000);

  try {
    // Close the database pool
    await db.close();
    console.log("[Shutdown] Database pool closed.");
  } catch (err) {
    console.error("[Shutdown] Error closing database pool:", err.message);
  }

  clearTimeout(forceExitTimer);
  console.log("[Shutdown] Clean exit.");
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

export default app;
// Force watch restart to pick up SMTP .env changes
