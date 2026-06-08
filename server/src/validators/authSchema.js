import Joi from "joi";

// ─── OTP Schemas ─────────────────────────────────────────────

export const sendOTPSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim()
    .messages({ "string.email": "Please enter a valid email address" }),
});

export const confirmOTPSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim()
    .messages({ "string.email": "Please enter a valid email address" }),
  otp: Joi.string().required().pattern(/^\d{6}$/)
    .messages({
      "string.pattern.base": "OTP must be exactly 6 digits",
      "string.empty": "OTP is required",
    }),
});

/**
 * Auth Validation Schemas
 * All input validation rules for authentication endpoints.
 */

export const loginSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim()
    .messages({ "string.email": "Please enter a valid email address" }),
  password: Joi.string().required().min(1)
    .messages({ "string.empty": "Password is required" }),
  role: Joi.string().valid("admin", "dealer").default("dealer"),
});

export const registerSchema = Joi.object({
  name: Joi.string().required().trim().min(3).max(255)
    .messages({ "string.min": "Dealer name must be at least 3 characters" }),
  email: Joi.string().email().required().lowercase().trim()
    .messages({ "string.email": "Please enter a valid email address" }),
  password: Joi.string().required().min(8).max(100)
    .messages({ "string.min": "Password must be at least 8 characters" }),
  mobile: Joi.string().required().pattern(/^\d{10}$/)
    .messages({ "string.pattern.base": "Please enter a valid 10-digit mobile number" }),
  location: Joi.string().required().trim().min(3).max(255)
    .messages({ "string.min": "Working location must be at least 3 characters" }),
  companyName: Joi.string().allow("", null).trim().max(255),
  // Required: short-lived JWT issued by /verify-email/confirm-otp.
  // The server verifies this token's signature, type, and email match
  // before accepting the registration. Cannot be empty.
  emailVerifiedToken: Joi.string().required().min(10)
    .messages({
      "string.empty": "Email verification is required. Please verify your email using the OTP.",
      "any.required": "Email verification is required. Please verify your email using the OTP.",
    }),
  // ── Aadhaar: either a single PDF/scan OR two photos (front + back) ──
  aadhaarPhoto: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024), // 10MB max
    data: Joi.string().required().max(14 * 1024 * 1024), // ~10MB file after base64 encoding (~33% overhead)
  }).allow(null),
  aadhaarFront: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024),
    data: Joi.string().required().max(14 * 1024 * 1024),
  }).allow(null),
  aadhaarBack: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024),
    data: Joi.string().required().max(14 * 1024 * 1024),
  }).allow(null),
  panPhoto: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024),
    data: Joi.string().required().max(14 * 1024 * 1024),
  }).allow(null),
  passportPhoto: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024),
    data: Joi.string().required().max(14 * 1024 * 1024),
  }).allow(null),
  agreementPhoto: Joi.object({
    name: Joi.string().required().max(255),
    type: Joi.string().required().valid("image/jpeg", "image/png", "image/webp", "application/pdf"),
    size: Joi.number().required().max(10 * 1024 * 1024),
    data: Joi.string().required().max(14 * 1024 * 1024),
  }).allow(null),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required()
    .messages({ "string.empty": "Current password is required" }),
  newPassword: Joi.string().required().min(8).max(100)
    .messages({ "string.min": "New password must be at least 8 characters" }),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().lowercase().trim()
    .messages({ "string.email": "Please enter a valid email address" }),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required()
    .messages({ "string.empty": "Reset token is required" }),
  newPassword: Joi.string().required().min(8).max(100)
    .messages({ "string.min": "Password must be at least 8 characters" }),
});

export const adminResetPasswordSchema = Joi.object({
  newPassword: Joi.string().required().min(8).max(100)
    .messages({ "string.min": "Password must be at least 8 characters" }),
});
