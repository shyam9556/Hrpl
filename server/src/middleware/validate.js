/**
 * Joi Validation Middleware Factory
 *
 * Creates Express middleware that validates request body/query/params
 * against a Joi schema before the route handler runs.
 *
 * Usage:
 *   import { validate } from "../middleware/validate.js";
 *   import { loginSchema } from "../validators/authSchema.js";
 *   router.post("/login", validate(loginSchema), loginHandler);
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    const data = source === "body" ? req.body : source === "query" ? req.query : req.params;

    const { error, value } = schema.validate(data, {
      abortEarly: false,     // Report ALL errors, not just the first
      stripUnknown: true,    // Remove fields not in schema (security)
      allowUnknown: false,
    });

    if (error) {
      const details = error.details.map((d) => d.message.replace(/"/g, "'"));
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details,
      });
    }

    // Replace request data with validated + sanitized data
    if (source === "body") req.body = value;
    else if (source === "query") req.query = value;
    else req.params = value;

    next();
  };
}
