-- ═══════════════════════════════════════════════════════════════
-- Migration 024: Email OTP Verification
-- Adds email_otp_tokens table and email_verified column on dealer_registrations
-- ═══════════════════════════════════════════════════════════════

-- ─── email_otp_tokens ────────────────────────────────────────
-- Stores SHA-256 hashed OTPs for email verification during dealer registration.
-- OTPs expire in 10 minutes. Max 5 wrong attempts per OTP before it is locked.
-- The plaintext OTP is only ever sent via email and never stored here.
CREATE TABLE IF NOT EXISTS email_otp_tokens (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    email       VARCHAR(255) NOT NULL,
    otp_hash    VARCHAR(64)  NOT NULL,           -- SHA-256 of the 6-digit OTP (never plaintext)
    expires_at  DATETIME     NOT NULL,           -- created_at + 10 minutes
    used        TINYINT(1)   NOT NULL DEFAULT 0, -- 1 = consumed (verified or locked)
    attempts    TINYINT      NOT NULL DEFAULT 0, -- failed attempt counter; locked at >= 5
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_otp_email   (email),
    INDEX idx_otp_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── email_verified on dealer_registrations ──────────────────
-- Tracks whether the applicant verified their email via OTP before submitting.
-- 0 = not verified (legacy registrations or skipped), 1 = OTP-verified.
-- Uses a stored procedure to safely ADD COLUMN only if it does not already exist.
DROP PROCEDURE IF EXISTS add_email_verified_col;

DELIMITER //
CREATE PROCEDURE add_email_verified_col()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'dealer_registrations'
          AND COLUMN_NAME  = 'email_verified'
    ) THEN
        ALTER TABLE dealer_registrations
            ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0
            AFTER company_name;
    END IF;
END//
DELIMITER ;

CALL add_email_verified_col();
DROP PROCEDURE IF EXISTS add_email_verified_col;
