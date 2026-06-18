// ─── API Client ─────────────────────────────────────────
// Centralized HTTP client for all backend API calls.
// Handles JWT token management, error responses, and base URL config.

const API_BASE = "/api";

// File uploads and document fetches bypass the cPanel PHP proxy DIRECTLY to Railway.
// Reason: PHP must buffer the entire multipart file before forwarding via cURL — this
// doubles the upload work and causes visible hangs (stuck at "0/1").
// CORS is already configured on Railway to allow hrplpro.com.
// All other API calls (auth, quotations, customers etc.) still go through /api.
const RAILWAY_BASE = "https://hrpl-production.up.railway.app/api";

// Default request timeout (30 seconds). Prevents infinite hangs on slow/dead servers.
const REQUEST_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 120000; // 2 min for upload-heavy requests (reupload submits with base64)

// ─── Token Management ────────────────────────────────────
function getToken() {
  return localStorage.getItem("hp_token");
}

export function setToken(token) {
  if (token) {
    localStorage.setItem("hp_token", token);
  } else {
    localStorage.removeItem("hp_token");
  }
}

// ─── Session Expiry Event ────────────────────────────────
// Instead of window.location.reload() (which causes infinite reload loops
// when a 401 fires repeatedly), we dispatch a custom event that App.jsx
// listens to and handles with a graceful logout().
export function dispatchSessionExpired() {
  window.dispatchEvent(new CustomEvent("hp:session-expired"));
}

// ─── Core Request Function ───────────────────────────────
async function request(endpoint, options = {}) {
  // Capture the token at the moment this request is constructed.
  // This snapshot is used later to decide whether a 401 response refers to
  // the CURRENT session or a stale one that was in-flight during a fresh login.
  const token = getToken();
  // Alias so we can reference it inside the async 401 handler without confusion.
  const tokenSentInThisRequest = token;

  const config = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };

  // Convert body to JSON if not FormData
  if (options.body && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  // ── Timeout via AbortController ──────────────────────
  // Prevents requests from hanging indefinitely on slow/unreachable server.
  const controller = new AbortController();
  const timeoutMs = options.timeout || REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  config.signal = controller.signal;

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    clearTimeout(timeoutId);

    // Handle non-JSON responses (file downloads)
    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return response;
    }

    const data = await response.json();

    if (!response.ok) {
      // ── 401 Auto-logout ─────────────────────────────────────────────────────
      // Only log the user out if the token WE SENT in THIS request was rejected.
      //
      // Why the extra check matters:
      //   Scenario: stale session → request fires with old token → slow network
      //             → user logs in fresh (new token written to localStorage)
      //             → 401 arrives for the OLD request
      //   Old code: getToken() returns the FRESH token → removes it → user logged out
      //   New code: tokenSentInThisRequest (old) ≠ getToken() (new) → do nothing ✓
      //
      // Also: if NO token was sent (tokenSentInThisRequest is null), the 401 is
      // simply a missing-auth error — don't logout, just let it propagate.
      if (response.status === 401) {
        if (tokenSentInThisRequest) {
          const currentToken = getToken();
          if (currentToken === tokenSentInThisRequest) {
            // The token we sent is still the active one and the server rejected it.
            // This is a genuine expired/invalid token — clear session and redirect to login.
            localStorage.removeItem("hp_token");
            localStorage.removeItem("hp_user");
            dispatchSessionExpired();
            throw new Error("Session expired. Please login again.");
          }
          // If currentToken !== tokenSentInThisRequest, a fresh login happened while
          // this request was in flight. The 401 is for the OLD token — leave the new
          // session intact and let this error propagate silently.
        }
        // No token was sent → server just said "no auth". Don't auto-logout.
      }

      const error = new Error(
        // Prefer the first Joi validation detail over the generic top-level message
        // e.g. "Password must be at least 6 characters" instead of "Validation failed"
        (data.details && data.details.length > 0)
          ? data.details[0]
          : (data.error || "Something went wrong")
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    // Convert AbortError (timeout) into a user-friendly message
    if (err.name === "AbortError") {
      const timeoutError = new Error(
        "Request timed out. Please check your connection and try again."
      );
      timeoutError.status = 408;
      throw timeoutError;
    }

    // Network errors (server unreachable, DNS fail, etc.)
    if (err instanceof TypeError && err.message.includes("fetch")) {
      const networkError = new Error(
        "Unable to connect to server. Please check your internet connection."
      );
      networkError.status = 0;
      throw networkError;
    }

    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// AUTH API
// ═══════════════════════════════════════════════════════════
export const auth = {
  login: (email, password, role) =>
    request("/auth/login", { method: "POST", body: { email, password, role } }),

  register: (data) =>
    request("/auth/register", { method: "POST", body: data, timeout: UPLOAD_TIMEOUT_MS }),

  getProfile: () =>
    request("/auth/me"),

  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  forgotPassword: (email) =>
    request("/auth/forgot-password", { method: "POST", body: { email } }),

  resetPassword: (token, newPassword) =>
    request("/auth/reset-password", { method: "POST", body: { token, newPassword } }),

  // ── Email OTP verification (used during dealer registration) ──
  // sendOTP: sends a 6-digit OTP to the given email. Always resolves 200.
  sendOTP: (email) =>
    request("/auth/verify-email/send-otp", { method: "POST", body: { email } }),

  // confirmOTP: verifies the 6-digit OTP. Returns { token } (email_verified_token JWT) on success.
  // Throws with err.data.remainingAttempts / err.data.locked on wrong OTP.
  confirmOTP: (email, otp) =>
    request("/auth/verify-email/confirm-otp", { method: "POST", body: { email, otp } }),
};

// ═══════════════════════════════════════════════════════════
// PRICES API
// ═══════════════════════════════════════════════════════════
export const prices = {
  getAll: () =>
    request("/prices"),

  // Panels
  addPanel: (data) =>
    request("/prices/panels", { method: "POST", body: data }),

  updatePanel: (id, data) =>
    request(`/prices/panels/${id}`, { method: "PUT", body: data }),

  deletePanel: (id) =>
    request(`/prices/panels/${id}`, { method: "DELETE" }),

  // Inverters
  addInverter: (data) =>
    request("/prices/inverters", { method: "POST", body: data }),

  updateInverter: (id, data) =>
    request(`/prices/inverters/${id}`, { method: "PUT", body: data }),

  deleteInverter: (id) =>
    request(`/prices/inverters/${id}`, { method: "DELETE" }),

  // Accessories
  updateAccessories: (accessories) =>
    request("/prices/accessories", { method: "PUT", body: { accessories } }),

  // Kits
  updateKit: (id, price) =>
    request(`/prices/kits/${id}`, { method: "PUT", body: { price } }),

  createKit: (data) =>
    request("/prices/kits", { method: "POST", body: data }),

  deleteKit: (id) =>
    request(`/prices/kits/${id}`, { method: "DELETE" }),
};

// ═══════════════════════════════════════════════════════════
// QUOTATIONS API
// ═══════════════════════════════════════════════════════════
export const quotations = {
  create: (data) =>
    request("/quotations", { method: "POST", body: data }),

  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/quotations${qs ? `?${qs}` : ""}`);
  },

  get: (id) =>
    request(`/quotations/${id}`),

  updateStatus: (id, status) =>
    request(`/quotations/${id}/status`, { method: "PATCH", body: { status } }),

  updateDeliveryStatus: (id, status) =>
    request(`/quotations/${id}/delivery`, { method: "PATCH", body: { status } }),

  delete: (id) =>
    request(`/quotations/${id}`, { method: "DELETE" }),

  requestReupload: (id, reason, documents) =>
    request(`/quotations/${id}/request-reupload`, { method: "POST", body: { reason, documents } }),

  submitPortalReupload: (id, filesPayload) =>
    request(`/quotations/${id}/submit-portal-reupload`, { method: "POST", body: filesPayload }),

  completePortalReupload: (id) =>
    request(`/quotations/${id}/complete-portal-reupload`, { method: "POST" }),

  requestGeotagReupload: (id, reason, slots) =>
    request(`/quotations/${id}/request-geotag-reupload`, { method: "POST", body: { reason, slots } }),

  clearGeotagReupload: (id) =>
    request(`/quotations/${id}/clear-geotag-reupload`, { method: "PATCH" }),

  submitGeotag: (id) =>
    request(`/quotations/${id}/submit-geotag`, { method: "POST" }),

  getStats: () =>
    request("/quotations/stats"),
};

// ═══════════════════════════════════════════════════════════
// STOCK API
// ═══════════════════════════════════════════════════════════
export const stock = {
  getAll: () =>
    request("/stock"),

  add: (data) =>
    request("/stock", { method: "POST", body: data }),

  update: (id, quantity, unitPrice) => {
    const body = {};
    if (quantity !== undefined) body.quantity = quantity;
    if (unitPrice !== undefined) body.unitPrice = unitPrice;
    return request(`/stock/${id}`, { method: "PATCH", body });
  },

  remove: (id) =>
    request(`/stock/${id}`, { method: "DELETE" }),
};

// ═══════════════════════════════════════════════════════════
// CUSTOMERS API
// ═══════════════════════════════════════════════════════════
export const customers = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/customers${qs ? `?${qs}` : ""}`);
  },

  get: (id) =>
    request(`/customers/${id}`),

  create: (data) =>
    request("/customers", { method: "POST", body: data }),

  update: (id, data) =>
    request(`/customers/${id}`, { method: "PUT", body: data }),

  delete: (id) =>
    request(`/customers/${id}`, { method: "DELETE" }),
};

// ═══════════════════════════════════════════════════════════
// DEALERS API
// ═══════════════════════════════════════════════════════════
export const dealers = {
  list: () =>
    request("/dealers"),

  registrations: (status = "Pending") =>
    request(`/dealers/registrations?status=${status}`),

  approve: (id) =>
    request(`/dealers/registrations/${id}/approve`, { method: "POST" }),

  reject: (id, reason) =>
    request(`/dealers/registrations/${id}/reject`, { method: "POST", body: { reason } }),

  toggleActive: (id) =>
    request(`/dealers/${id}/toggle-active`, { method: "PATCH" }),

  requestReupload: (id, reason, documents) =>
    request(`/dealers/registrations/${id}/request-reupload`, { method: "POST", body: { reason, documents } }),

  adminResetPassword: (userId, newPassword) =>
    request(`/auth/admin-reset-password/${userId}`, { method: "POST", body: { newPassword } }),

  unlockAccount: (userId) =>
    request(`/dealers/${userId}/login-attempts`, { method: "DELETE" }),

  getStats: () =>
    request("/dealers/registrations/stats"),

  // Lightweight endpoint — only returns registrations needing admin review after
  // a dealer re-upload. Much cheaper than fetching all registrations.
  needsReview: () =>
    request("/dealers/registrations/needs-review"),
};

// ═══════════════════════════════════════════════════════════
// UPLOADS API
// ═══════════════════════════════════════════════════════════
export const uploads = {
  // Uploads go DIRECTLY to Railway — bypasses PHP proxy to avoid double-buffering.
  single: (file, entityType, entityId, docType, latitude = null, longitude = null) => {
    const token = getToken();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityType", entityType);
    formData.append("entityId", String(entityId));
    formData.append("docType", docType);
    if (latitude !== null) formData.append("latitude", String(latitude));
    if (longitude !== null) formData.append("longitude", String(longitude));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    return fetch(`${RAILWAY_BASE}/uploads/single`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal: controller.signal,
    }).then(async (res) => {
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) dispatchSessionExpired();
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      return data;
    }).catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") throw new Error("Upload timed out. Please try again.");
      throw err;
    });
  },

  // Secure file fetch — goes directly to Railway (bypasses PHP proxy).
  getSecureBlobUrl: async (id) => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${RAILWAY_BASE}/uploads/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Failed to load document ${id}`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") throw new Error("Document load timed out.");
      throw err;
    }
  },

  // Secure file download — goes directly to Railway (bypasses PHP proxy).
  downloadSecure: async (id, filename) => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${RAILWAY_BASE}/uploads/${id}?download=true`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Failed to download document ${id}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename || "document";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") throw new Error("Download timed out.");
      throw err;
    }
  },


  listForEntity: (entityType, entityId) =>
    request(`/uploads/entity/${entityType}/${entityId}`),

  delete: (id) =>
    request(`/uploads/${id}`, { method: "DELETE" }),

  updateCoordinates: (id, latitude, longitude) =>
    request(`/uploads/${id}/coordinates`, { method: "PATCH", body: { latitude, longitude } }),

  // Download multiple documents as a single ZIP archive (IMP-8).
  // ids: array of document IDs.
  downloadZip: async (ids, zipFilename = "documents.zip") => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s for large downloads
    try {
      const qs = ids.join(",");
      const response = await fetch(`${API_BASE}/uploads/zip?ids=${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `ZIP download failed (${response.status})`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") throw new Error("ZIP download timed out.");
      throw err;
    }
  },
};

// ─── Isolated Request (No auto-token injection) ──────────
// Used for reupload API calls that have their own short-lived JWT.
// Prevents the main app token from being sent alongside the reupload JWT,
// which would cause spurious session-expired events on 401 errors.
async function requestIsolated(endpoint, options = {}) {
  const config = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers, // caller provides Authorization: Bearer <reuploadJwt>
    },
  };

  if (options.body && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timeoutMs = options.timeout || REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  config.signal = controller.signal;

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      return response;
    }

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(
        (data.details && data.details.length > 0)
          ? data.details[0]
          : (data.error || "Something went wrong")
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      const timeoutError = new Error("Request timed out. Please check your connection and try again.");
      timeoutError.status = 408;
      throw timeoutError;
    }
    if (err instanceof TypeError && err.message.includes("fetch")) {
      const networkError = new Error("Unable to connect to server. Please check your internet connection.");
      networkError.status = 0;
      throw networkError;
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// REUPLOAD API (public — uses re-upload JWT, NOT main app JWT)
// Uses requestIsolated() to prevent cross-contamination between
// the reupload session and any active main-app session.
// ═══════════════════════════════════════════════════════════
export const reupload = {
  // Lightweight validity probe — checks if the raw URL token is still valid.
  // Returns { valid: true } on success, throws on 400 (expired/used/not found).
  // Does NOT require a password.
  probe: (token) =>
    requestIsolated(`/auth/reupload/probe?token=${encodeURIComponent(token)}`),

  // Step 1: Verify token + registration password, get back a short-lived re-upload JWT
  // No auth header needed — this is a public endpoint (rate-limited on server)
  verify: (token, password) =>
    requestIsolated("/auth/reupload/verify", { method: "POST", body: { token, password } }),

  // Get info about the re-upload session (dealer name, reason, required docs)
  getInfo: (reuploadJwt) =>
    requestIsolated("/auth/reupload/info", { headers: { Authorization: `Bearer ${reuploadJwt}` } }),

  // Step 2: Submit new documents
  submit: (reuploadJwt, documents) =>
    requestIsolated("/auth/reupload/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${reuploadJwt}` },
      body: documents,
      timeout: UPLOAD_TIMEOUT_MS,
    }),
};

export const reuploadQuotation = {
  probe: (token) =>
    requestIsolated(`/auth/reupload-quotation/probe?token=${encodeURIComponent(token)}`),

  verify: (token, password) =>
    requestIsolated("/auth/reupload-quotation/verify", { method: "POST", body: { token, password } }),

  getInfo: (reuploadJwt) =>
    requestIsolated("/auth/reupload-quotation/info", { headers: { Authorization: `Bearer ${reuploadJwt}` } }),

  submit: (reuploadJwt, documents) =>
    requestIsolated("/auth/reupload-quotation/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${reuploadJwt}` },
      body: documents,
      timeout: UPLOAD_TIMEOUT_MS,
    }),
};

// ═══════════════════════════════════════════════════════════
// SETTINGS API
// ═══════════════════════════════════════════════════════════
export const settings = {
  getAll: () =>
    request("/settings"),

  getPublic: () =>
    request("/settings/public"),

  update: (settingsObj) =>
    request("/settings", { method: "PUT", body: { settings: settingsObj } }),
};

// ═══════════════════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════════════════
export const dashboard = {
  get: () =>
    request("/dashboard"),
};

// ═══════════════════════════════════════════════════════════
// REPORTS API
// ═══════════════════════════════════════════════════════════
export const reports = {
  quotations: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/quotations${qs ? `?${qs}` : ""}`);
  },

  dealers: () =>
    request("/reports/dealers"),

  revenue: (year) =>
    request(`/reports/revenue${year ? `?year=${year}` : ""}`),

  customers: () =>
    request("/reports/customers"),
};

// ═══════════════════════════════════════════════════════════
// INQUIRIES API
// ═══════════════════════════════════════════════════════════
export const inquiries = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inquiries${qs ? `?${qs}` : ""}`);
  },

  create: (data) =>
    request("/inquiries", { method: "POST", body: data }),

  update: (id, data) =>
    request(`/inquiries/${id}`, { method: "PUT", body: data }),

  updateStatus: (id, status) =>
    request(`/inquiries/${id}/status`, { method: "PATCH", body: { status } }),

  addFollowup: (id, notes) =>
    request(`/inquiries/${id}/followups`, { method: "POST", body: { notes } }),

  getFollowups: (id) =>
    request(`/inquiries/${id}/followups`),

  delete: (id) =>
    request(`/inquiries/${id}`, { method: "DELETE" }),
};

// ═══════════════════════════════════════════════════════════
// EVENTS API
// ═══════════════════════════════════════════════════════════
// Returns the SSE endpoint URL with the current JWT embedded as a query param.
// Browser EventSource cannot send custom headers, so we pass the token in the URL.
export const events = {
  url: () => {
    const token = localStorage.getItem("hp_token");
    return token ? `/api/events?token=${encodeURIComponent(token)}` : null;
  },
};

export default {
  auth,
  prices,
  quotations,
  stock,
  customers,
  dealers,
  uploads,
  reupload,
  reuploadQuotation,
  settings,
  dashboard,
  reports,
  inquiries,
  events,
};

