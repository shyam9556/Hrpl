import { useState, useEffect, useCallback, useRef } from "react";
import { DEALER_NAV, ADMIN_NAV } from "./utils/constants";
import { auth as authApi, setToken, quotations as quotationsApi, dealers as dealersApi } from "./utils/api";
import {
  FilePlus, ClipboardList, Users, LayoutDashboard, Inbox, UserPlus,
  Store, IndianRupee, Package, BarChart3, Settings, LogOut, Menu, X,
  Shield, KeyRound, Eye, EyeOff, Loader2, CheckCircle, Award
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
import DealerDocuments from "./components/DealerDocuments";

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
  award: Award,
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

  // ── Change Password Modal state ───────────────────────────────────────────
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [cpCurrent, setCpCurrent]         = useState("");
  const [cpNew, setCpNew]                 = useState("");
  const [cpConfirm, setCpConfirm]         = useState("");
  const [cpShowCurrent, setCpShowCurrent] = useState(false);
  const [cpShowNew, setCpShowNew]         = useState(false);
  const [cpShowConfirm, setCpShowConfirm] = useState(false);
  const [cpLoading, setCpLoading]         = useState(false);
  const [cpError, setCpError]             = useState("");
  // pwdChanged: true after a successful change — renders fullscreen success
  // screen instead of a modal layered over the app.
  const [pwdChanged, setPwdChanged]       = useState(false);


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

    // Guard: if hp_user exists but hp_token is missing, storage is in an inconsistent
    // state (partial clear, devtools edit, or extremely rare race). The app would show
    // authenticated UI but every API call would fail silently — the 401 handler does NOT
    // fire session-expired when no token is sent (tokenSentInThisRequest is null).
    // Clear the orphaned hp_user immediately and force the user back to login.
    if (savedUser && !tokenAtCallTime) {
      localStorage.removeItem("hp_user");
      setUser(null);
      return;
    }

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
          setUser((prev) => {
            const updated = { ...prev, ...res.user };
            localStorage.setItem("hp_user", JSON.stringify(updated));
            return updated;
          });
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

  // ── Change Password handlers (MUST be after logout — they reference it) ───
  const openChangePwd = useCallback(() => {
    setCpCurrent(""); setCpNew(""); setCpConfirm("");
    setCpShowCurrent(false); setCpShowNew(false); setCpShowConfirm(false);
    setCpLoading(false); setCpError("");
    setShowChangePwd(true);
    setSidebarOpen(false);
  }, []);

  const closeChangePwd = useCallback(() => {
    if (cpLoading) return;
    setShowChangePwd(false);
  }, [cpLoading]);

  const handleChangePwd = useCallback(async (e) => {
    e.preventDefault();
    setCpError("");
    if (!cpCurrent.trim()) { setCpError("Current password is required."); return; }
    if (cpNew.length < 8)  { setCpError("New password must be at least 8 characters."); return; }
    if (cpNew !== cpConfirm) { setCpError("Passwords do not match."); return; }
    if (cpNew === cpCurrent) { setCpError("New password must be different from current password."); return; }
    setCpLoading(true);
    try {
      await authApi.changePassword(cpCurrent, cpNew);
      // JWT is now invalidated server-side (password_changed_at bumped).
      // Logout immediately — pwdChanged=true triggers a clean fullscreen
      // success screen instead of a modal layered over the authenticated app.
      setShowChangePwd(false);
      setPwdChanged(true);
      logout();
    } catch (err) {
      setCpError(err.message || "Failed to change password. Please try again.");
    } finally {
      setCpLoading(false);
    }
  }, [cpCurrent, cpNew, cpConfirm, logout]);


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

  // ── Fullscreen password-changed success screen ────────────────────────────
  // Shown after successful change: user is already logged out (user=null)
  // but we show this clean screen for 2.5s before transitioning to login.
  if (pwdChanged && !user) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #102A1C 0%, #1C3A2A 40%, #2E7D52 80%, #E29613 100%)",
        padding: "1.5rem",
      }}>
        <div style={{
          background: "rgba(255,255,255,0.97)", borderRadius: 24, padding: "3rem 2.5rem",
          maxWidth: 420, width: "100%", textAlign: "center",
          boxShadow: "0 24px 70px rgba(0,0,0,0.25)",
          animation: "fadeInUp 0.4s ease",
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
            boxShadow: "0 8px 24px rgba(46,125,82,0.25)",
          }}>
            <CheckCircle size={40} color="#2E7D52" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--green)", marginBottom: 10 }}>
            Password Changed!
          </h2>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 28 }}>
            Your password has been updated successfully.<br />
            Please sign in with your new password.
          </p>
          <button
            className="btn-primary"
            onClick={() => setPwdChanged(false)}
          >
            Go to Sign In
          </button>
        </div>
      </div>
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
            {user.role === "admin" ? <Shield size={18} /> : null}
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
            {/* Change Password button */}
            <button
              className="change-pwd-btn"
              onClick={openChangePwd}
              title="Change password"
            >
              <KeyRound size={16} />
              <span className="nav-label">Change Password</span>
            </button>
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
          {user.role === "dealer" && page === "documents" && <DealerDocuments user={user} />}
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

      {/* ── Change Password Modal ────────────────────────────────────────────── */}
      {showChangePwd && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px",
          }}
          onClick={closeChangePwd}
        >
          <div
            style={{
              background: "var(--surface, #fff)", borderRadius: 16,
              width: "100%", maxWidth: 420,
              boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              background: "linear-gradient(135deg, var(--dark, #1C3A2A) 0%, var(--green, #2E7D52) 100%)",
              padding: "20px 24px", display: "flex", alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <KeyRound size={20} color="white" />
                <span style={{ color: "white", fontWeight: 700, fontSize: 16 }}>Change Password</span>
              </div>
              <button
                onClick={closeChangePwd}
                disabled={cpLoading}
                style={{ background: "none", border: "none", cursor: cpLoading ? "not-allowed" : "pointer",
                  color: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", padding: 4 }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body — only the form, success is handled by fullscreen screen */}
            <div style={{ padding: "24px 24px 28px" }}>
              <form onSubmit={handleChangePwd}>
                {/* Current password */}
                <div className="field" style={{ marginBottom: 14 }}>
                  <label>Current Password</label>
                  <div className="field-pwd-wrapper">
                    <input
                      type={cpShowCurrent ? "text" : "password"}
                      value={cpCurrent}
                      onChange={(e) => { setCpCurrent(e.target.value); setCpError(""); }}
                      placeholder="Enter current password"
                      autoComplete="current-password"
                      disabled={cpLoading}
                    />
                    <button type="button" className="pwd-toggle-btn"
                      onClick={() => setCpShowCurrent(v => !v)}>
                      {cpShowCurrent ? <EyeOff size={16}/> : <Eye size={16}/>}
                    </button>
                  </div>
                </div>

                {/* New password + strength */}
                {(() => {
                  const cpHasLen   = cpNew.length >= 8;
                  const cpHasUpper = /[A-Z]/.test(cpNew);
                  const cpHasNum   = /\d/.test(cpNew);
                  const cpScore    = [cpHasLen, cpHasUpper, cpHasNum].filter(Boolean).length;
                  const cpLabel    = cpScore === 0 ? "" : cpScore === 1 ? "Weak" : cpScore === 2 ? "Fair" : "Strong";
                  const cpColor    = cpScore === 0 ? "var(--muted)" : cpScore === 1 ? "#ef4444" : cpScore === 2 ? "#f59e0b" : "#22c55e";
                  return (
                    <div className="field" style={{ marginBottom: 14 }}>
                      <label>New Password</label>
                      <div className="field-pwd-wrapper">
                        <input
                          type={cpShowNew ? "text" : "password"}
                          value={cpNew}
                          onChange={(e) => { setCpNew(e.target.value); setCpError(""); }}
                          placeholder="Min. 8 characters"
                          autoComplete="new-password"
                          disabled={cpLoading}
                        />
                        <button type="button" className="pwd-toggle-btn"
                          onClick={() => setCpShowNew(v => !v)}>
                          {cpShowNew ? <EyeOff size={16}/> : <Eye size={16}/>}
                        </button>
                      </div>
                      {cpNew.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                            {[1, 2, 3].map(i => (
                              <div key={i} style={{
                                flex: 1, height: 3, borderRadius: 2,
                                background: i <= cpScore ? cpColor : "var(--border, #e5e7eb)",
                                transition: "background 0.2s",
                              }} />
                            ))}
                          </div>
                          <div style={{ fontSize: 11, color: cpColor, fontWeight: 600 }}>
                            {cpLabel}
                            {!cpHasLen && <span style={{ color: "var(--muted)", fontWeight: 400 }}> — min. 8 characters</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Confirm new password */}
                <div className="field" style={{ marginBottom: 18 }}>
                  <label>Confirm New Password</label>
                  <div className="field-pwd-wrapper">
                    <input
                      type={cpShowConfirm ? "text" : "password"}
                      value={cpConfirm}
                      onChange={(e) => { setCpConfirm(e.target.value); setCpError(""); }}
                      placeholder="Re-enter new password"
                      autoComplete="new-password"
                      disabled={cpLoading}
                    />
                    <button type="button" className="pwd-toggle-btn"
                      onClick={() => setCpShowConfirm(v => !v)}>
                      {cpShowConfirm ? <EyeOff size={16}/> : <Eye size={16}/>}
                    </button>
                  </div>
                  {cpConfirm.length > 0 && (
                    <div style={{ fontSize: 11, marginTop: 4, fontWeight: 500,
                      display: "flex", alignItems: "center", gap: 4,
                      color: cpNew === cpConfirm && cpNew.length >= 8 ? "#22c55e" : "#ef4444" }}>
                      {cpNew === cpConfirm && cpNew.length >= 8
                        ? <><CheckCircle size={12} /> Passwords match</>
                        : <>{cpNew !== cpConfirm ? "Passwords do not match" : "Password too short"}</>
                      }
                    </div>
                  )}
                </div>

                {/* Error */}
                {cpError && (
                  <div style={{
                    background: "#fef2f2", border: "1px solid #fca5a5",
                    borderRadius: 8, padding: "10px 12px", marginBottom: 14,
                    fontSize: 13, color: "#dc2626",
                  }}>
                    {cpError}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={closeChangePwd}
                    disabled={cpLoading}
                    style={{
                      flex: 1, padding: "11px", border: "1.5px solid var(--border, #e5e7eb)",
                      background: "transparent", borderRadius: 8,
                      fontWeight: 600, fontSize: 14, cursor: cpLoading ? "not-allowed" : "pointer",
                      color: "var(--text, #111)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={cpLoading || cpNew.length < 8 || cpNew !== cpConfirm}
                    className="btn-primary"
                    style={{ flex: 2, padding: "11px" }}
                  >
                    {cpLoading
                      ? <><Loader2 size={15} className="animate-spin" /> Changing...</>
                      : <><KeyRound size={15} /> Change Password</>
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
