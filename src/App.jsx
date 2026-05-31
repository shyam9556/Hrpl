import { useState, useEffect, useCallback, useRef } from "react";
import { DEALER_NAV, ADMIN_NAV } from "./utils/constants";
import { auth as authApi, setToken, quotations as quotationsApi, dealers as dealersApi } from "./utils/api";
import {
  FilePlus, ClipboardList, Users, LayoutDashboard, Inbox, UserPlus,
  Store, IndianRupee, Package, BarChart3, Settings, LogOut, Menu, X,
  Shield
} from "lucide-react";
import ResetPasswordPage from "./components/ResetPasswordPage";
import DealerReuploadPage from "./components/DealerReuploadPage";
import QuotationReuploadPage from "./components/QuotationReuploadPage";

// Components
import LoginPage from "./components/LoginPage";
import DealerQuotation from "./components/DealerQuotation";
import DealerRequests from "./components/DealerRequests";
import AdminDashboard from "./components/AdminDashboard";
import PriceManager from "./components/PriceManager";
import StockManager from "./components/StockManager";
import DealerRegistrationsAdmin from "./components/DealerRegistrationsAdmin";
import DealerRequestsAdmin from "./components/DealerRequestsAdmin";
import CustomerManager from "./components/CustomerManager";
import DealersList from "./components/DealersList";
import ReportsPage from "./components/ReportsPage";
import SettingsPage from "./components/SettingsPage";
import InquiryManager from "./components/InquiryManager";

// Map icon string IDs → Lucide components
const ICON_MAP = {
  filePlus: FilePlus,
  clipboardList: ClipboardList,
  users: Users,
  layoutDashboard: LayoutDashboard,
  inbox: Inbox,
  userPlus: UserPlus,
  store: Store,
  indianRupee: IndianRupee,
  package: Package,
  barChart3: BarChart3,
  settings: Settings,
};

function NavIcon({ name, size = 18 }) {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} strokeWidth={1.8} /> : null;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("hp_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [page, setPage] = useState(() => {
    try {
      const saved = localStorage.getItem("hp_user");
      const u = saved ? JSON.parse(saved) : null;
      if (u) return u.role === "dealer" ? "quote" : "dashboard";
    } catch {}
    return "quote";
  });

  // ── Password Reset Deep-Link Detection ───────────────────────────────────
  // When the user clicks the email reset link (CLIENT_URL/reset-password?token=XXX),
  // the SPA loads at root but the ?token= query param is still present.
  // We extract it here so we can render the ResetPasswordPage instead of login.
  const [resetToken, setResetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  });

  // ── Document Re-upload Deep-Link Detection ────────────────────────────────
  // When a dealer clicks the re-upload link from their email (CLIENT_URL?reupload=TOKEN)
  // we render the DealerReuploadPage instead of login or the main app.
  const [reuploadToken, setReuploadToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reupload") || "";
  });

  // ── Quotation Document & Geotag Re-upload Deep-Link Detection ──────────────
  // When a dealer clicks the quotation re-upload link from their email (CLIENT_URL?q_reupload=TOKEN)
  // we render the QuotationReuploadPage instead of login or the main app.
  const [qReuploadToken, setQReuploadToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("q_reupload") || "";
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inquiryDataForQuote, setInquiryDataForQuote] = useState(null);

  // Ref to hold the polling interval so we can clear it immediately on logout
  const pollIntervalRef = useRef(null);

  // hp_user is written synchronously inside login() and removed inside logout()
  // so localStorage is always consistent before any effects run.
  // We intentionally do NOT use a useEffect to sync user→localStorage because
  // effects are async (flush after paint) which caused a race: the mount effect
  // read localStorage before the user-watcher effect had written hp_user,
  // saw an empty value, and immediately called setUser(null) → logout loop.


  useEffect(() => {
    // Validates a session restored from localStorage on page reload.
    // Must NOT interfere with a concurrent fresh login.
    //
    // Race: stale token in localStorage → getProfile() 401 arrives AFTER the user
    // has already logged in fresh → naive catch block wipes the new valid token.
    //
    // Fix: snapshot the token value BEFORE the async call. In the catch block,
    // re-read it. If it has changed (login() wrote a new token while the call was
    // in flight), the 401 is for the OLD token — leave state alone.

    const tokenAtCallTime = localStorage.getItem("hp_token");
    const savedUser = localStorage.getItem("hp_user");

    if (!tokenAtCallTime || !savedUser) {
      // No stored session — nothing to validate.
      // User state is already null from the useState initializer.
      return;
    }

    // Validate the stored token is still accepted by the server, and refresh
    // user data in case admin changed name/email since last login.
    authApi.getProfile()
      .then((res) => {
        if (res.user) {
          setUser((prev) => ({ ...prev, ...res.user }));
        }
      })
      .catch(() => {
        // Re-read the current token at resolution time.
        // If login() was called while getProfile() was in flight, the token in
        // localStorage is now a fresh valid one — different from tokenAtCallTime.
        // In that case, the 401 refers to the OLD stale token; leave the new session intact.
        const tokenNow = localStorage.getItem("hp_token");
        if (tokenNow !== tokenAtCallTime) return; // fresh login happened — do nothing
        localStorage.removeItem("hp_user");
        setUser(null);
        setToken(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── Listen for session-expiry event dispatched by api.js on 401 ──────────
  // This replaces window.location.reload() which caused infinite reload loops
  // when 401 fired repeatedly (e.g. expired token + background polling).
  useEffect(() => {
    const handleSessionExpired = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      localStorage.removeItem("hp_user");
      setUser(null);
      setToken(null);
      setPage("quote");
      setSidebarOpen(false);
      setPendingQuotationsCount(0);
      setPendingDealersCount(0);
    };

    window.addEventListener("hp:session-expired", handleSessionExpired);
    return () => window.removeEventListener("hp:session-expired", handleSessionExpired);
  }, []);

  // ── Listen for in-app navigation events dispatched by child components ───
  // GAP-2: DealerRequests dispatches hp:navigate to navigate to a page
  // without needing a prop-drilled callback. This keeps the navigation
  // bus decoupled from component hierarchy.
  useEffect(() => {
    const handleNavigate = (e) => {
      if (e.detail) {
        // "new-quotation" is an alias for the dealer quotation form page
        const target = e.detail === "new-quotation" ? "quote" : e.detail;
        setPage(target);
        pageRef.current = target;
      }
      setSidebarOpen(false);
    };
    window.addEventListener("hp:navigate", handleNavigate);
    return () => window.removeEventListener("hp:navigate", handleNavigate);
  }, []);

  const [pendingQuotationsCount, setPendingQuotationsCount] = useState(0);
  const [pendingDealersCount, setPendingDealersCount] = useState(0);
  // Track page in a ref so fetchPendingCounts (in a setInterval) sees the latest value
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  // Guard: fetchPendingCounts is a no-op when user is null.
  // This prevents phantom API calls during the logout state-transition window.
  const fetchPendingCounts = useCallback(async () => {
    if (!user || user.role !== "admin") return;
    try {
      const [qRes, dRes] = await Promise.all([
        quotationsApi.list({ status: "Pending", limit: 1 }),
        dealersApi.registrations("Pending")
      ]);
      // Don't update the quotations badge while admin is actively viewing that page
      if (pageRef.current !== "requests") {
        setPendingQuotationsCount(qRes.pagination?.total || qRes.quotations?.length || 0);
      }
      // Don't update the dealer registrations badge while admin is actively viewing that page
      if (pageRef.current !== "dealer_registrations") {
        setPendingDealersCount(dRes.registrations?.length || 0);
      }
    } catch {
      // Silently ignore — badges are non-critical. Session expiry is handled
      // by the hp:session-expired event listener above.
    }
  }, [user]);

  useEffect(() => {
    fetchPendingCounts();
    if (user && user.role === "admin") {
      pollIntervalRef.current = setInterval(fetchPendingCounts, 15000);
      return () => {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      };
    }
  }, [user, fetchPendingCounts]);

  const navigateTo = useCallback((pageId) => {
    setPage(pageId);
    setSidebarOpen(false);
    // CRITICAL: update ref SYNCHRONOUSLY before the async fetchPendingCounts call.
    // If we don't do this, fetchPendingCounts runs with the stale (old) pageRef
    // and overwrites the zeroed badge count before React has re-rendered.
    pageRef.current = pageId;
    // Zero out the badge for the page admin is opening
    if (pageId === "dealer_registrations") setPendingDealersCount(0);
    if (pageId === "requests") setPendingQuotationsCount(0);
    fetchPendingCounts();
  }, [fetchPendingCounts]);

  const login = useCallback((userObj, token) => {
    // Write to localStorage SYNCHRONOUSLY before setting React state.
    // This ensures the mount-time useEffect (which reads localStorage to validate
    // the session on page reload) always finds a consistent hp_user + hp_token pair,
    // preventing the "logged in but immediately sent back to login" race condition.
    localStorage.setItem("hp_user", JSON.stringify(userObj));
    setToken(token); // setToken writes hp_token to localStorage
    setUser(userObj);
    setPage(userObj.role === "dealer" ? "quote" : "dashboard");
  }, []);

  const logout = useCallback(() => {
    // Clear polling interval immediately — don't wait for useEffect cleanup
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    // Remove from localStorage synchronously before clearing React state
    localStorage.removeItem("hp_user");
    setUser(null);
    setToken(null);
    setPage("quote");
    setSidebarOpen(false);
    setPendingQuotationsCount(0);
    setPendingDealersCount(0);
  }, []);

  // ── If a password reset token is in the URL, show the reset form ────────
  // This intercepts before both the login page and the main app.
  // After the user completes the reset (or cancels), we clear the token from
  // the URL so a normal page-reload doesn't show the reset form again.
  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onDone={() => {
          // Remove ?token= from the browser URL bar without a full page reload
          const url = new URL(window.location.href);
          url.searchParams.delete("token");
          window.history.replaceState({}, document.title, url.pathname);
          setResetToken("");
        }}
      />
    );
  }

  // ── Render the re-upload page when the URL has ?reupload=TOKEN ────────────
  if (reuploadToken) {
    return (
      <DealerReuploadPage
        token={reuploadToken}
        onDone={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("reupload");
          window.history.replaceState({}, document.title, url.pathname);
          setReuploadToken("");
        }}
      />
    );
  }

  // ── Render the quotation re-upload page when the URL has ?q_reupload=TOKEN ──
  if (qReuploadToken) {
    return (
      <QuotationReuploadPage
        token={qReuploadToken}
        onDone={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("q_reupload");
          window.history.replaceState({}, document.title, url.pathname);
          setQReuploadToken("");
        }}
      />
    );
  }

  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  const nav = user.role === "dealer" ? DEALER_NAV : ADMIN_NAV;
  const currentNav = nav.find(n => n.id === page);

  return (
    <div className="app">
      <div className="shell">
        {/* Mobile Top Bar */}
        <div className="mobile-topbar">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="mobile-topbar-title">
            <img src="/logo.png" alt="" style={{ width: 28, height: 28, objectFit: "contain", background: "white", padding: 3, borderRadius: 6 }} />
            <span>{currentNav?.label || "Highlight Pro"}</span>
          </div>
          <div className="mobile-topbar-role">
            {user.role === "admin" ? <Shield size={18} /> : <img src="/logo.png" alt="" style={{ width: 26, height: 26, objectFit: "contain", background: "white", padding: 2, borderRadius: 5 }} />}
          </div>
        </div>

        {/* Sidebar Overlay */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-logo">
            <img src="/logo.png" alt="Highlight Pro" style={{ width: 42, height: 42, objectFit: "contain", background: "white", padding: 5, borderRadius: 10, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }} />
            <div>
              <div className="sidebar-logo-text">Highlight Pro</div>
              <div className="sidebar-logo-role">{user.role.toUpperCase()}</div>
            </div>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>

          <div className="nav-list">
            {nav.map(n => (
              <div
                key={n.id}
                className={`nav-item ${page === n.id ? "active" : ""}`}
                onClick={() => navigateTo(n.id)}
              >
                <span className="nav-icon"><NavIcon name={n.icon} /></span>
                <span className="nav-label" style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between" }}>
                  <span>{n.label}</span>
                  {n.id === "requests" && user.role === "admin" && pendingQuotationsCount > 0 && (
                    <span style={{ 
                      background: "#e11d48", 
                      color: "white", 
                      fontSize: "10px", 
                      fontWeight: 700, 
                      borderRadius: "8px", 
                      padding: "2px 6px", 
                      marginLeft: "auto", 
                      boxShadow: "0 2px 4px rgba(225,29,72,0.3)",
                      display: "inline-block",
                      lineHeight: "1"
                    }}>
                      {pendingQuotationsCount}
                    </span>
                  )}
                  {n.id === "dealer_registrations" && user.role === "admin" && pendingDealersCount > 0 && (
                    <span style={{ 
                      background: "#e11d48", 
                      color: "white", 
                      fontSize: "10px", 
                      fontWeight: 700, 
                      borderRadius: "8px", 
                      padding: "2px 6px", 
                      marginLeft: "auto", 
                      boxShadow: "0 2px 4px rgba(225,29,72,0.3)",
                      display: "inline-block",
                      lineHeight: "1"
                    }}>
                      {pendingDealersCount}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-user-info">
              <div className="sidebar-user-name" title={user.name || user.email}>
                {user.name || user.email}
              </div>
              <div className="sidebar-user-email" title={user.email}>{user.email}</div>
            </div>
            <button className="logout-btn" onClick={logout}>
              <LogOut size={16} />
              <span className="nav-label">Logout</span>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="main">
          {user.role === "dealer" && page === "quote" && (
            <DealerQuotation 
              user={user} 
              initialForm={inquiryDataForQuote} 
              onClearInitialForm={() => setInquiryDataForQuote(null)} 
            />
          )}
          {user.role === "dealer" && page === "requests" && <DealerRequests />}
          {user.role === "dealer" && page === "inquiries" && (
            <InquiryManager 
              onConvertToQuote={(inqData) => {
                setInquiryDataForQuote(inqData);
                setPage("quote");
              }} 
            />
          )}
          {page === "customers" && <CustomerManager />}
          {user.role === "admin" && page === "dashboard" && <AdminDashboard onNavigate={navigateTo} />}
          {user.role === "admin" && page === "requests" && <DealerRequestsAdmin />}
          {user.role === "admin" && page === "dealer_registrations" && <DealerRegistrationsAdmin onClearBadge={() => setPendingDealersCount(0)} />}
          {user.role === "admin" && page === "dealers" && <DealersList />}
          {user.role === "admin" && page === "prices" && <PriceManager />}
          {user.role === "admin" && page === "stock" && <StockManager />}
          {user.role === "admin" && page === "reports" && <ReportsPage />}
          {user.role === "admin" && page === "settings" && <SettingsPage />}
        </div>
      </div>
    </div>
  );
}
