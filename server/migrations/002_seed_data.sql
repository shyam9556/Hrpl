-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Seed Data (MySQL)
-- Initial admin user, products, stock, and system settings
-- ═══════════════════════════════════════════════════════════════

-- ─── ADMIN USER ──────────────────────────────────────────────
-- Password: admin@hrpl (bcrypt hash)
-- Hash generated with: bcrypt.hashSync("admin@hrpl", 10)
INSERT INTO users (name, email, password_hash, role, mobile, is_active)
SELECT 'System Admin', 'admin@hrpl.com', '$2b$10$mi6A7SoVY0QXHmJlWpn1x.0Dtfo40M7zwz2V/Q.lxJeUb7EIiJUXG', 'admin', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@hrpl.com');


-- ─── SOLAR PANELS ────────────────────────────────────────────
INSERT IGNORE INTO panels (brand, watt, type, price_per_panel) VALUES
('Waaree',      390, 'Mono PERC',  9200),
('Waaree',      440, 'Mono PERC',  10100),
('Waaree',      545, 'Bifacial',   12400),
('Adani Solar', 420, 'Mono PERC',  9800),
('Adani Solar', 540, 'Bifacial',   12000),
('Adani Solar', 585, 'TOPCon',     13200);

-- ─── INVERTERS ───────────────────────────────────────────────
INSERT IGNORE INTO inverters (brand, kw, type, price_per_unit) VALUES
('Growatt', 3,  'String', 18000),
('Growatt', 5,  'String', 24000),
('Growatt', 10, 'String', 42000),
('Havells', 3,  'String', 20000),
('Havells', 5,  'String', 27000),
('Havells', 10, 'String', 46000);

-- ─── ACCESSORIES ─────────────────────────────────────────────
INSERT IGNORE INTO accessories (key_name, display_name, price, unit) VALUES
('dc_wire_per_meter',        'DC Solar Cable (per meter)',      45,   'per meter'),
('ac_wire_per_meter',        'AC Cable – Polycab (per meter)',  60,   'per meter'),
('earthing_kit',             'Earthing Kit',                    2200, 'per unit'),
('mcb',                      'MCB / Isolator',                  1200, 'per unit'),
('acdb',                     'ACDB Box',                        3500, 'per unit'),
('dcdb',                     'DCDB Box',                        3200, 'per unit'),
('mounting_structure_per_kw','Mounting Structure – GI',          4500, 'per kW'),
('lightning_arrester',       'Lightning Arrester',              1800, 'per unit'),
('monitoring',               'Remote Monitoring Unit',          2500, 'per unit'),
('installation',             'Installation & Commissioning',   8000, 'per lot');

-- ─── STOCK ITEMS ─────────────────────────────────────────────
INSERT IGNORE INTO stock_items (category, item_name, quantity, unit) VALUES
('Panel',     'Waaree 390W Mono PERC',          120,  'pcs'),
('Panel',     'Waaree 440W Mono PERC',          80,   'pcs'),
('Panel',     'Adani Solar 420W Mono PERC',     60,   'pcs'),
('Panel',     'Adani Solar 540W Bifacial',      40,   'pcs'),
('Inverter',  'Growatt 5kW String',             15,   'pcs'),
('Inverter',  'Growatt 10kW String',            8,    'pcs'),
('Inverter',  'Havells 5kW String',             10,   'pcs'),
('Wire',      'DC Solar Cable (4mm)',           2500, 'meters'),
('Wire',      'AC Cable (Polycab 6mm)',         1800, 'meters'),
('Accessory', 'Earthing Kit',                   30,   'pcs'),
('Accessory', 'ACDB Box',                       20,   'pcs'),
('Accessory', 'DCDB Box',                       20,   'pcs');

-- ─── SYSTEM SETTINGS ────────────────────────────────────────
INSERT IGNORE INTO system_settings (`key`, value, description) VALUES
('gst_rate',                '12',                       'GST percentage applied to quotations'),
('quotation_validity_days', '30',                       'Number of days a quotation is valid'),
('quotation_prefix',        'HP',                       'Prefix for quotation numbers (e.g., HP/2025-26/0001)'),
('company_name',            'Highlight Pro',            'Company name displayed in PDFs and emails'),
('company_phone',           '',                         'Company phone number for PDF footer'),
('company_email',           '',                         'Company email for PDF footer'),
('company_address',         '',                         'Company address for PDF footer'),
('max_upload_size_mb',      '10',                       'Maximum upload file size in megabytes'),
('smtp_from_email',         'noreply@highlightpro.in',  'From email address for system emails'),
('smtp_from_name',          'Highlight Pro',            'From name for system emails'),
('stock_threshold_high',    '20',                       'Quantity above which stock is considered In Stock'),
('stock_threshold_low',     '5',                        'Quantity above which stock is Low, below is Critical');
