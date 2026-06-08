-- ═══════════════════════════════════════════════════════════════
-- Migration 026: Login Attempts Tracking for Account Lockout
-- Adds login_attempts table to track per-account failed login attempts.
-- After 10 consecutive failures, account is locked for 30 minutes.
-- This prevents brute-force attacks targeting a specific account
-- regardless of which IP the attacker uses.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_attempts (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email       VARCHAR(255) NOT NULL,
    ip_address  VARCHAR(45)  NOT NULL,              -- IPv4 or IPv6
    succeeded   TINYINT(1)   NOT NULL DEFAULT 0,    -- 1 = successful login
    attempted_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_login_attempts_email      (email),
    INDEX idx_login_attempts_attempted  (attempted_at),
    INDEX idx_login_attempts_email_time (email, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
