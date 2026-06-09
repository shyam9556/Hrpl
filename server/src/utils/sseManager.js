// ─── SSE Manager ─────────────────────────────────────────
// Manages Server-Sent Events (SSE) client connections.
// Components can subscribe to real-time events without polling.
//
// Architecture:
//   - Each authenticated browser tab gets one SSE connection.
//   - Connections are stored in a Map keyed by a random clientId.
//   - Broadcast helpers filter by role or userId for targeted pushes.
//   - Stale connections are cleaned up on 'close' event.

// Map<clientId, { res, userId, role }>
const clients = new Map();

/**
 * Register a new SSE client connection.
 * @param {string} clientId  - Unique ID for this connection (UUID).
 * @param {number} userId    - Authenticated user's DB ID.
 * @param {string} role      - "admin" | "dealer"
 * @param {object} res       - Express response object (kept open for SSE).
 */
export function addClient(clientId, userId, role, res) {
  clients.set(clientId, { res, userId, role });
}

/**
 * Remove a client when it disconnects.
 * @param {string} clientId
 */
export function removeClient(clientId) {
  clients.delete(clientId);
}

/**
 * Send an SSE event to a single client response.
 * @param {object} res   - Express response object.
 * @param {string} event - Event name (e.g. "quotation:new").
 * @param {object} data  - JSON-serializable payload.
 */
function sendEvent(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client already disconnected — ignore write errors.
  }
}

/**
 * Broadcast an event to ALL connected clients.
 */
export function broadcast(event, data) {
  for (const { res } of clients.values()) {
    sendEvent(res, event, data);
  }
}

/**
 * Broadcast an event to all clients with a specific role.
 * @param {"admin"|"dealer"} role
 */
export function broadcastToRole(role, event, data) {
  for (const client of clients.values()) {
    if (client.role === role) {
      sendEvent(client.res, event, data);
    }
  }
}

/**
 * Broadcast an event to a specific user (all their open tabs).
 * @param {number} userId
 */
export function broadcastToUser(userId, event, data) {
  for (const client of clients.values()) {
    if (client.userId === userId) {
      sendEvent(client.res, event, data);
    }
  }
}

/**
 * Returns the count of currently connected clients (for health/debug).
 */
export function getClientCount() {
  return clients.size;
}
