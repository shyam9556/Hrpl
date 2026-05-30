-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Database Schema Migration
-- Version: 011
-- Purpose: Create kit_prices table if it was missed by migration 001
-- ═══════════════════════════════════════════════════════════════

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
