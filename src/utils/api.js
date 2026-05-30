// ─── API Client ─────────────────────────────────────────
// Centralized HTTP client for all backend API calls.
// Handles JWT token management, error responses, and base URL config.

const API_BASE = "/api";

// Default request timeout (30 seconds). Prevents infinite hangs on slow/dead servers.
const REQUEST_TIMEOUT_MS = 30000;

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
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    request("/auth/register", { method: "POST", body: data }),

  getProfile: () =>
    request("/auth/me"),

  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  forgotPassword: (email) =>
    request("/auth/forgot-password", { method: "POST", body: { email } }),

  resetPassword: (token, newPassword) =>
    request("/auth/reset-password", { method: "POST", body: { token, newPassword } }),
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

  reject: (id) =>
    request(`/dealers/registrations/${id}/reject`, { method: "POST" }),

  toggleActive: (id) =>
    request(`/dealers/${id}/toggle-active`, { method: "PATCH" }),
};

// ═══════════════════════════════════════════════════════════
// UPLOADS API
// ═══════════════════════════════════════════════════════════
export const uploads = {
  single: (file, entityType, entityId, docType, latitude = null, longitude = null) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    formData.append("docType", docType);
    if (latitude !== null) formData.append("latitude", latitude);
    if (longitude !== null) formData.append("longitude", longitude);
    return request("/uploads/single", { method: "POST", body: formData });
  },

  // Secure file fetch — uses Authorization header, returns a blob URL.
  // Use this for <img src> and programmatic view operations.
  getSecureBlobUrl: async (id) => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}/uploads/${id}`, {
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

  // Secure file download — fetches with Authorization header and triggers
  // a browser download with the correct filename. Revokes the blob URL after
  // click so there are no memory leaks.
  downloadSecure: async (id, filename) => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}/uploads/${id}?download=true`, {
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

  // ⚠️ DEPRECATED: Token is exposed in the URL (appears in server logs, Referer headers,
  // browser history). Use getSecureBlobUrl() for images and downloadSecure() for downloads.
  // Only use this for <a href> direct download links when fetch with Authorization header
  // is not possible (e.g., in server-side email attachments).
  getUrl: (id) => {
    const token = getToken();
    return `${API_BASE}/uploads/${id}${token ? `?token=${token}` : ""}`;
  },

  listForEntity: (entityType, entityId) =>
    request(`/uploads/entity/${entityType}/${entityId}`),

  delete: (id) =>
    request(`/uploads/${id}`, { method: "DELETE" }),

  updateCoordinates: (id, latitude, longitude) =>
    request(`/uploads/${id}/coordinates`, { method: "PATCH", body: { latitude, longitude } }),
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

export default {
  auth,
  prices,
  quotations,
  stock,
  customers,
  dealers,
  uploads,
  settings,
  dashboard,
  reports,
  inquiries,
};
