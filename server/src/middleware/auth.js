import jwt from "jsonwebtoken";
import env from "../config/env.js";
import db from "../config/database.js";

/**
 * Auth Middleware — Verifies JWT token from Authorization header.
 *
 * Expected header format: Authorization: Bearer <token>
 *
 * On success: attaches `req.user` with { id, email, role, name }
 * On failure: returns 401 Unauthorized
 *
 * Security: Also checks that the token was issued AFTER the user's last
 * password change. This allows immediate token invalidation on password
 * reset without a token-revocation database (JWT blacklist).
 */
export async function authenticate(req, res, next) {
  try {
    // Extract token from Authorization: Bearer <token> header only.
    // Query-string tokens (?token=...) are intentionally NOT supported:
    // URLs with tokens leak into server logs, browser history, Referer headers,
    // and proxy access logs — a well-known OWASP security risk.
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Access denied. No token provided.",
      });
    }

    // 2. Verify token signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, env.jwt.secret);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error: "Token has expired. Please login again.",
        });
      }
      return res.status(401).json({
        success: false,
        error: "Invalid token.",
      });
    }

    // 3. Verify user still exists, is active, and token was issued AFTER
    //    the last password change (prevents stale token abuse after reset).
    const result = await db.query(
      "SELECT id, name, email, role, is_active, password_changed_at FROM users WHERE id = ?",
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User account not found.",
      });
    }

    const user = result.rows[0];

    // Check if account is active (MySQL returns TINYINT as 0 or 1)
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: "Account has been deactivated. Contact admin.",
      });
    }

    // Security: Reject tokens issued before the last password change.
    // This immediately invalidates all sessions when a user changes or resets
    // their password — without needing a token blacklist table.
    //
    // Precision note: JWT `iat` (issued-at) is in whole seconds, e.g. 1748560470.
    // MySQL DATETIME has millisecond precision, e.g. 1748560470523.
    // Converting iat→ms gives 1748560470000, which is 523ms LESS than changedAtMs —
    // causing a false rejection even when the token was issued in the same second
    // as the password change (e.g. account created and dealer immediately logs in).
    //
    // Fix: add 999ms grace so only tokens from a strictly earlier SECOND are rejected.
    // This is safe: you cannot log in before the password exists.
    if (user.password_changed_at) {
      const changedAtMs = new Date(user.password_changed_at).getTime();
      const tokenIssuedAtMs = decoded.iat * 1000;
      if (tokenIssuedAtMs + 999 < changedAtMs) {
        return res.status(401).json({
          success: false,
          error: "Token has been invalidated. Please login again.",
        });
      }
    }

    // 4. Attach user to request for use in route handlers
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role Guard — Restricts route access to specific roles.
 *
 * Usage:
 *   router.get("/admin-only", authenticate, authorize("admin"), handler);
 *   router.get("/both", authenticate, authorize("admin", "dealer"), handler);
 */
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
      });
    }

    next();
  };
}
