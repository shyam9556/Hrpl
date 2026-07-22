// ─── useSSE ──────────────────────────────────────────────────────────────────
// Custom React hook for Server-Sent Events (SSE) connection management.
//
// USAGE (Global bus pattern — used in App.jsx):
//   const sseToken = user ? localStorage.getItem("hp_token") : null;
//   useSSE(sseToken);
//
//   Any component can then listen for events without prop-drilling:
//   window.addEventListener("hp:sse:quotation:new", handler);
//   window.addEventListener("hp:sse:registration:status_changed", handler);
//
// ARCHITECTURE:
//   - One EventSource connection per browser tab (mounted at App level).
//   - SSE events are re-dispatched as window CustomEvents with prefix "hp:sse:".
//   - Automatic reconnection with exponential backoff + ±500ms jitter.
//   - Cleanly closes on component unmount (i.e. logout / page unload).
//
// @param {string|null} token
//   JWT token for auth. Pass null to disconnect (e.g. after logout).
//   When token changes (null→string on login, string→null on logout),
//   the effect re-runs, closing the old connection and opening a new one.

import { useEffect, useRef } from "react";

// SSE connects DIRECTLY to Railway — NOT through the cPanel PHP proxy.
// Reason: Hostinger shared hosting kills PHP processes after ~60s,
// which terminates long-lived SSE connections and breaks real-time updates.
// Only SSE goes direct; all other API calls still use /api (via PHP proxy).
const SSE_URL          = "https://hrpl-production-37ec.up.railway.app/api/events";
const MAX_RETRY_MS     = 30_000; // Maximum backoff cap: 30 seconds
const INITIAL_RETRY_MS =  1_000; // First retry after 1 second

// All SSE event names emitted by the server.
// Listing them explicitly here ensures we never miss an event type and
// makes it easy to add new ones in one place.
const KNOWN_EVENTS = [
  // Quotation lifecycle
  "quotation:new",
  "quotation:status_changed",
  "quotation:delivery_changed",
  "quotation:deleted",
  // Quotation re-upload / geotag lifecycle
  "quotation:reupload_requested",
  "quotation:geotag_reupload_requested",
  "quotation:geotag_submitted",
  // Dealer registration lifecycle
  "registration:new",
  "registration:status_changed",
  // Dealer account management
  "dealer:toggled",
  "dealer:reuploadRequested",
  // Customer mutations
  "customer:changed",
  // Stock mutations
  "stock:changed",
  // Price catalog mutations
  "prices:changed",
  // System settings mutations
  "settings:changed",
  // Document mutations (admin deletes a doc)
  "document:deleted",
  // Document uploads (dealer uploads a new doc to a quotation or registration)
  "document:uploaded",
  // Admin manually edits GPS coordinates on a geotag photo
  "document:coordinates_updated",
  // Inquiry mutations (create / update / status / followup / delete)
  "inquiry:changed",
];

export default function useSSE(token) {
  const esRef        = useRef(null);       // Active EventSource instance
  const retryDelayMs = useRef(INITIAL_RETRY_MS);
  const retryTimer   = useRef(null);
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Cancel any pending reconnect timer from a previous attempt
    clearTimeout(retryTimer.current);
    retryTimer.current = null;

    // Close any existing connection before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // If no token, user is logged out — do not connect
    if (!token) return;

    // Reset backoff when token changes (fresh login)
    retryDelayMs.current = INITIAL_RETRY_MS;

    function connect() {
      if (!mountedRef.current) return;

      const url = `${SSE_URL}?token=${encodeURIComponent(token)}`;
      const es  = new EventSource(url);
      esRef.current = es;

      // Server sends a "connected" event on successful auth — reset backoff here too
      es.addEventListener("connected", () => {
        retryDelayMs.current = INITIAL_RETRY_MS;
      });

      // Re-dispatch each SSE event as a window CustomEvent so any component
      // can subscribe without prop-drilling or context.
      // Pattern: "quotation:new" → window event "hp:sse:quotation:new"
      KNOWN_EVENTS.forEach((eventName) => {
        es.addEventListener(eventName, (e) => {
          let data = {};
          try { data = JSON.parse(e.data); } catch { /* ignore malformed payloads */ }
          window.dispatchEvent(
            new CustomEvent(`hp:sse:${eventName}`, { detail: data })
          );
        });
      });

      es.onerror = () => {
        // EventSource auto-retries but we manage our own backoff for control
        es.close();
        esRef.current = null;
        if (!mountedRef.current) return;

        // Exponential backoff with ±500ms jitter to prevent thundering-herd reconnects
        const delay = Math.min(retryDelayMs.current, MAX_RETRY_MS);
        retryDelayMs.current = Math.min(delay * 2, MAX_RETRY_MS);
        retryTimer.current = setTimeout(connect, delay + Math.random() * 500);
      };
    }

    connect();

    return () => {
      // Cleanup: cancel pending retry timer and close connection
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [token]); // Re-run only when token changes (login / logout)
}
