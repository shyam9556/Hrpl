-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Database Schema Migration
-- Version: 001 (Initial)
-- Database: highlight_pro (MySQL 8.x / 9.x)
-- ═══════════════════════════════════════════════════════════════

-- Use strict mode and UTF-8
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ─── 1. USERS ────────────────────────────────────────────────
-- Stores all system users: admins and approved dealers
CREATE TABLE IF NOT EXISTS users (
    id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                ENUM('admin', 'dealer') NOT NULL DEFAULT 'dealer',
    mobile              VARCHAR(15),
    location            VARCHAR(255),
    company_name        VARCHAR(255),
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    password_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2. DEALER REGISTRATIONS ─────────────────────────────────
-- Pending dealer applications (before admin approval)
CREATE TABLE IF NOT EXISTS dealer_registrations (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    mobile          VARCHAR(15) NOT NULL,
    location        VARCHAR(255) NOT NULL,
    company_name    VARCHAR(255),
    password_hash   VARCHAR(255) NOT NULL,
    status          ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    reviewed_by     INT UNSIGNED,
    submitted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at     DATETIME,
    PRIMARY KEY (id),
    INDEX idx_dealer_reg_status (status),
    INDEX idx_dealer_reg_email (email),
    CONSTRAINT fk_dealer_reg_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3. CUSTOMERS ────────────────────────────────────────────
-- CRM: Customer profiles created by dealers
CREATE TABLE IF NOT EXISTS customers (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(15),
    email           VARCHAR(255),
    city            VARCHAR(255),
    address         TEXT,
    status          ENUM('Lead', 'Quoted', 'Approved', 'Installed', 'Follow-up') NOT NULL DEFAULT 'Lead',
    notes           TEXT,
    created_by      INT UNSIGNED NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_customers_phone (phone),
    INDEX idx_customers_created_by (created_by),
    INDEX idx_customers_status (status),
    CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4. PANELS ───────────────────────────────────────────────
-- Solar panel product catalog
CREATE TABLE IF NOT EXISTS panels (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    brand           VARCHAR(100) NOT NULL,
    watt            VARCHAR(50) NOT NULL,
    type            ENUM('Mono PERC', 'Bifacial', 'TOPCon', 'Polycrystalline') NOT NULL DEFAULT 'Mono PERC',
    price_per_panel DECIMAL(12,2) NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5. INVERTERS ────────────────────────────────────────────
-- Inverter product catalog
CREATE TABLE IF NOT EXISTS inverters (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    brand           VARCHAR(100) NOT NULL,
    kw              DECIMAL(6,2) NOT NULL,
    type            VARCHAR(50) NOT NULL DEFAULT 'Single Phase',
    price_per_unit  DECIMAL(12,2) NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 6. ACCESSORIES ──────────────────────────────────────────
-- Accessory pricing (wiring, earthing, installation, etc.)
CREATE TABLE IF NOT EXISTS accessories (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    key_name        VARCHAR(100) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    price           DECIMAL(12,2) NOT NULL,
    unit            VARCHAR(50) NOT NULL DEFAULT 'per unit',
    PRIMARY KEY (id),
    UNIQUE KEY uq_accessories_key_name (key_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 7. QUOTATIONS ───────────────────────────────────────────
-- Solar system quotations created by dealers for customers
CREATE TABLE IF NOT EXISTS quotations (
    id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    quotation_number    VARCHAR(50) NOT NULL,
    dealer_id           INT UNSIGNED NOT NULL,
    customer_id         INT UNSIGNED,
    panel_id            INT UNSIGNED NOT NULL,
    inverter_id         INT UNSIGNED NOT NULL,
    panel_count         INT NOT NULL,
    system_kw           DECIMAL(8,2) NOT NULL,
    structure_height    VARCHAR(100) DEFAULT 'Ground Level (Flat)',
    payment_mode        VARCHAR(100) DEFAULT 'Cash',
    subsidy_applicable  TINYINT(1) NOT NULL DEFAULT 1,
    panel_cost          DECIMAL(12,2) NOT NULL,
    inverter_cost       DECIMAL(12,2) NOT NULL,
    dc_wire_cost        DECIMAL(12,2) NOT NULL DEFAULT 0,
    ac_wire_cost        DECIMAL(12,2) NOT NULL DEFAULT 0,
    structure_cost      DECIMAL(12,2) NOT NULL DEFAULT 0,
    electrical_cost     DECIMAL(12,2) NOT NULL DEFAULT 0,
    earthing_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,
    misc_cost           DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal            DECIMAL(12,2) NOT NULL,
    gst_rate            DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    gst_amount          DECIMAL(12,2) NOT NULL,
    total               DECIMAL(12,2) NOT NULL,
    subsidy_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
    effective_price     DECIMAL(12,2) NOT NULL,
    price_per_kw        DECIMAL(12,2) NOT NULL DEFAULT 0,
    status              ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    delivery_status     ENUM('Pending', 'Dispatched', 'Delivered') NOT NULL DEFAULT 'Pending',
    valid_until         DATE,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_quotations_number (quotation_number),
    INDEX idx_quotations_dealer (dealer_id),
    INDEX idx_quotations_customer (customer_id),
    INDEX idx_quotations_status (status),
    INDEX idx_quotations_created (created_at),
    CONSTRAINT fk_quotations_dealer FOREIGN KEY (dealer_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_quotations_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_quotations_panel FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE RESTRICT,
    CONSTRAINT fk_quotations_inverter FOREIGN KEY (inverter_id) REFERENCES inverters(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 8. DOCUMENTS ────────────────────────────────────────────
-- File uploads linked to quotations, registrations, or customers
CREATE TABLE IF NOT EXISTS documents (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type     ENUM('quotation', 'dealer_registration', 'customer') NOT NULL,
    entity_id       INT UNSIGNED NOT NULL,
    doc_type        ENUM('aadhaar', 'pan', 'passbook', 'site_photo', 'passport_photo', 'other', 'geotag_1', 'geotag_2', 'geotag_3', 'vera_bill', 'house_photo_1', 'house_photo_2', 'house_photo_3') NOT NULL,
    file_path       VARCHAR(500) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    file_size_bytes INT NOT NULL,
    uploaded_by     INT UNSIGNED,
    uploaded_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    public_token    VARCHAR(36) NOT NULL,
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    PRIMARY KEY (id),
    UNIQUE KEY uq_documents_public_token (public_token),
    INDEX idx_documents_entity (entity_type, entity_id),
    INDEX idx_documents_uploaded_by (uploaded_by),
    CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 9. STOCK ITEMS ──────────────────────────────────────────
-- Inventory tracking for panels, inverters, wires, accessories
CREATE TABLE IF NOT EXISTS stock_items (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    category        VARCHAR(50) NOT NULL,
    item_name       VARCHAR(255) NOT NULL,
    quantity        INT NOT NULL DEFAULT 0,
    unit            VARCHAR(30) NOT NULL DEFAULT 'pcs',
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY idx_stock_item_name (item_name),
    INDEX idx_stock_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 10. PASSWORD RESET TOKENS ───────────────────────────────
-- Tokens for email-based password reset
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED NOT NULL,
    token           VARCHAR(255) NOT NULL,
    expires_at      DATETIME NOT NULL,
    used            TINYINT(1) NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reset_tokens_token (token),
    INDEX idx_reset_tokens_user (user_id),
    CONSTRAINT fk_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 11. SYSTEM SETTINGS ────────────────────────────────────
-- Configurable app settings (GST rate, quotation prefix, etc.)
CREATE TABLE IF NOT EXISTS system_settings (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `key`           VARCHAR(100) NOT NULL,
    value           TEXT NOT NULL,
    description     VARCHAR(500),
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_system_settings_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 12. INQUIRIES ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inquiries (
    id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                VARCHAR(255) NOT NULL,
    location            VARCHAR(255) NOT NULL,
    remark              TEXT,
    status              ENUM('New', 'Followed Up', 'Quoted', 'Closed') NOT NULL DEFAULT 'New',
    last_followup_date  DATETIME,
    last_followup_notes TEXT,
    created_by          INT UNSIGNED NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_inquiries_created_by (created_by),
    INDEX idx_inquiries_status (status),
    CONSTRAINT fk_inquiries_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 13. INQUIRY FOLLOWUPS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS inquiry_followups (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    inquiry_id      INT UNSIGNED NOT NULL,
    followup_date   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes           TEXT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_inquiry_followups_inquiry_id (inquiry_id),
    CONSTRAINT fk_followups_inquiry FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 14. KIT PRICES ─────────────────────────────────────────
-- Pre-packaged solar kit configurations (brand, type, panels, kW, price)
-- Used in Kit mode quotations — prices sourced from Raysolar Energy PDF list
CREATE TABLE IF NOT EXISTS kit_prices (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    brand       VARCHAR(100) NOT NULL,
    type        VARCHAR(50)  NOT NULL,
    watt        VARCHAR(50)  NOT NULL,
    panels      INT NOT NULL,
    kw          DECIMAL(6,2) NOT NULL,
    inv_brand   VARCHAR(100) NOT NULL DEFAULT 'Vsole/Polycab',
    inv_kw      DECIMAL(6,2) NOT NULL DEFAULT 3.00,
    price       DECIMAL(12,2) NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_kit_prices_brand (brand),
    INDEX idx_kit_prices_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 15. SCHEMA MIGRATIONS TRACKER ──────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    filename    VARCHAR(255) NOT NULL,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
