-- ═══════════════════════════════════════════════════════════════
-- Migration 029: Stock Transaction Ledger
-- Version: 029
-- ═══════════════════════════════════════════════════════════════
-- Replaces the old stock_daily_balances table with a proper audit
-- trail. Every stock movement (add / deduct / adjust) is recorded
-- with direction, running balance, optional reason, and performer.
--
-- balance_after is stored (denormalised) so opening/closing queries
-- are O(1) index lookups — not O(N) SUM scans.
--
-- Existing stock_items.quantity values are preserved as 'initial'
-- transaction records — zero data loss.
-- ═══════════════════════════════════════════════════════════════

-- Remove the old table if it exists in local dev (never on live)
DROP TABLE IF EXISTS stock_daily_balances;

-- ─── New Table: stock_transactions ───────────────────────────
CREATE TABLE IF NOT EXISTS stock_transactions (
    id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,

    -- Which stock item this movement belongs to
    stock_item_id    INT UNSIGNED    NOT NULL,

    -- 'add'        = stock coming in  (purchase, receipt, return)
    -- 'deduct'     = stock going out  (installation, damage, return to supplier)
    -- 'adjustment' = admin override   (physical stock count correction — requires reason)
    -- 'initial'    = migration seed   (starting balance from existing data)
    transaction_type ENUM('add','deduct','adjustment','initial') NOT NULL,

    -- Always a positive integer; direction is given by transaction_type
    quantity         INT UNSIGNED    NOT NULL,

    -- Running balance after this transaction.
    -- Stored (denormalised) for fast opening/closing queries without summing.
    -- Kept in sync with stock_items.quantity via atomic DB transactions.
    -- INT (not UNSIGNED) so a bug produces a visible negative, not silent overflow.
    balance_after    INT             NOT NULL,

    -- Optional reason for audit trail
    reason_category  VARCHAR(100)    DEFAULT NULL,   -- preset dropdown value
    reason_note      VARCHAR(500)    DEFAULT NULL,   -- free-text note

    -- Admin who performed this action (enforced FK — cannot orphan records)
    performed_by     INT UNSIGNED    NOT NULL,

    -- Stored in UTC (pool timezone is +00:00). Displayed as IST in UI.
    created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- ── Indexes ────────────────────────────────────────────────────────────
    -- Single-column: fast filter by item or date alone
    INDEX idx_stx_item_id    (stock_item_id),
    INDEX idx_stx_created_at (created_at),

    -- Composite: covers the most common query pattern
    -- (all transactions for an item in a date range)
    -- MySQL uses this for: WHERE stock_item_id = X AND created_at BETWEEN A AND B
    INDEX idx_stx_item_date  (stock_item_id, created_at),

    -- ── Foreign Keys ──────────────────────────────────────────────────────
    -- Item deleted → all its transactions deleted (no orphans)
    CONSTRAINT fk_stx_item FOREIGN KEY (stock_item_id)
        REFERENCES stock_items(id) ON DELETE CASCADE,

    -- Admin user deleted → BLOCKED (can't orphan audit records)
    CONSTRAINT fk_stx_user FOREIGN KEY (performed_by)
        REFERENCES users(id) ON DELETE RESTRICT

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── Seed: Preserve ALL existing stock data ──────────────────────────────────
-- Creates one 'initial' transaction per stock item that currently has stock.
-- Items with quantity = 0 are NOT seeded (nothing to record; they start fresh).
-- The 'initial' type is excluded from add/deduct totals in ledger reports.
-- Uses the earliest admin user as the system performer.

INSERT INTO stock_transactions
    (stock_item_id, transaction_type, quantity, balance_after,
     reason_category, performed_by, created_at)
SELECT
    si.id,
    'initial',
    si.quantity,
    si.quantity,
    'Initial stock balance — system migration',
    (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1),
    NOW()
FROM stock_items si
WHERE si.quantity > 0;
