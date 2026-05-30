import env from "../config/env.js";

/**
 * Global error handling middleware for Express.
 * Catches all errors thrown in route handlers and sends a consistent JSON response.
 *
 * Must be registered LAST with app.use() — after all routes.
 */
export function errorHandler(err, req, res, _next) {
  // Log the error (full stack in development, message only in production)
  if (env.isDev) {
    console.error("─── ERROR ───────────────────────────────────────");
    console.error(err.stack || err);
    console.error("─────────────────────────────────────────────────");
  } else {
    console.error(`[ERROR] ${req.method} ${req.path}: ${err.message}`);
  }

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Joi validation errors
  if (err.isJoi) {
    return res.status(400).json({
      success: false,
      error: "Validation Error",
      details: err.details?.map((d) => d.message) || [err.message],
    });
  }

  // Multer file upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum size is ${env.upload.maxFileSizeMB}MB`,
    });
  }

  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({
      success: false,
      error: "Unexpected file field",
    });
  }

  // MySQL unique constraint violation (errno 1062 = ER_DUP_ENTRY)
  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
    return res.status(409).json({
      success: false,
      error: "A record with this value already exists",
    });
  }

  // MySQL foreign key violation (errno 1452 = ER_NO_REFERENCED_ROW_2)
  if (err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 1452) {
    return res.status(400).json({
      success: false,
      error: "Referenced record does not exist",
    });
  }

  // Custom application errors (thrown with statusCode)
  if (statusCode !== 500) {
    return res.status(statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // Unexpected server errors — hide details in production
  res.status(500).json({
    success: false,
    error: env.isProd ? "Internal server error" : err.message,
  });
}

/**
 * Helper to create application errors with a status code.
 * Usage: throw AppError(404, "Quotation not found")
 */
export function AppError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
