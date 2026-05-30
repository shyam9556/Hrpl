import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from server root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const env = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isDev: (process.env.NODE_ENV || "development") === "development",
  isProd: process.env.NODE_ENV === "production",

  // Database
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    name: process.env.DB_NAME || "highlight_pro",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || "dev_secret_change_me",
    expiresIn: process.env.JWT_EXPIRES_IN || "4h",
  },

  // SMTP
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@highlightpro.in",
    fromName: process.env.SMTP_FROM_NAME || "Highlight Pro",
    isConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
  },

  // File uploads
  upload: {
    dir: process.env.UPLOAD_DIR || "uploads",
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
    get maxFileSizeBytes() {
      return this.maxFileSizeMB * 1024 * 1024;
    },
  },

  // Frontend URL (for CORS & email links)
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
};

// ─── Security Checks ─────────────────────────────────────
if (env.jwt.secret === "dev_secret_change_me") {
  if (env.isProd) {
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  FATAL: JWT_SECRET is set to the insecure default.      ║");
    console.error("║  Set a strong JWT_SECRET in .env before running in      ║");
    console.error("║  production. Shutting down for security.                 ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    process.exit(1);
  } else {
    console.warn("⚠️  WARNING: Using default JWT secret. Set JWT_SECRET in .env for production.");
  }
}

export default env;
