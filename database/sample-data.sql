-- =====================================================
-- SAMPLE DATA — development and testing only.
-- Loaded on first run only when LOAD_SAMPLE_DATA=true (see .env.example).
-- Names, products, barcodes and prices are made up. Do not load this on the store's server.
-- =====================================================

-- No owner exists yet when this runs (the owner account is created on first launch).
SET @cashier_role = (SELECT role_id FROM roles WHERE role_name = 'Cashier');

-- Cashiers: no username, no PIN (assigned to terminals by the owner)
INSERT INTO users (username, pin_hash, role_id, first_name, last_name, phone, is_active) VALUES
(NULL, NULL, @cashier_role, 'Juan', 'Dela Cruz', '09170000001', TRUE),
(NULL, NULL, @cashier_role, 'Maria', 'Santos', '09170000002', TRUE),
(NULL, NULL, @cashier_role, 'Jose', 'Reyes', '09170000003', TRUE),
(NULL, NULL, @cashier_role, 'Ana', 'Lim', '09170000004', FALSE);

-- Products (unit_price is VAT-inclusive; barcodes are placeholders, not real GTINs)
INSERT INTO products (barcode, product_code, product_name, category, unit_of_measure, unit_price, cost_price, reorder_level, shelf_life_days) VALUES
('2000000000015', 'SKU-0001', 'Rice 5kg',                     'Rice & Grains',   'sack',   280.00, 235.00, 15, NULL),
('2000000000022', 'SKU-0002', 'Rice 1kg',                     'Rice & Grains',   'pack',    58.00,  48.00, 20, NULL),
('2000000000039', 'SKU-0003', 'Canned Tuna 155g',             'Canned Goods',    'can',     45.00,  36.00, 24, 730),
('2000000000046', 'SKU-0004', 'Sardines in Tomato Sauce 155g','Canned Goods',    'can',     26.00,  20.50, 30, 730),
('2000000000053', 'SKU-0005', 'Corned Beef 150g',             'Canned Goods',    'can',     48.00,  39.00, 18, 730),
('2000000000060', 'SKU-0006', 'Bottled Water 1L',             'Beverages',       'bottle',  20.00,  14.00, 36, 365),
('2000000000077', 'SKU-0007', 'Cola 1.5L',                    'Beverages',       'bottle',  75.00,  61.00, 12, 180),
('2000000000084', 'SKU-0008', 'Coffee 3-in-1 Sachet',         'Beverages',       'sachet',   9.00,   6.80, 60, 365),
('2000000000091', 'SKU-0009', 'Fresh Milk 1L',                'Dairy & Eggs',    'carton',  98.00,  82.00,  8, 10),
('2000000000107', 'SKU-0010', 'Eggs (Tray of 30)',            'Dairy & Eggs',    'tray',   240.00, 205.00, 12, 21),
('2000000000114', 'SKU-0011', 'Instant Noodles Chicken 55g',  'Noodles & Pasta', 'pack',    14.00,  10.50, 48, 240),
('2000000000121', 'SKU-0012', 'Cooking Oil 1L',               'Condiments',      'bottle', 115.00,  96.00, 10, 540),
('2000000000138', 'SKU-0013', 'Soy Sauce 1L',                 'Condiments',      'bottle',  52.00,  41.00, 10, 540),
('2000000000145', 'SKU-0014', 'White Sugar 1kg',              'Condiments',      'pack',    85.00,  72.00, 12, 730),
('2000000000152', 'SKU-0015', 'Pandesal (10 pcs)',            'Bakery',          'pack',    50.00,  38.00,  6, 3),
('2000000000169', 'SKU-0016', 'Loaf Bread',                   'Bakery',          'loaf',    75.00,  60.00,  6, 5),
('2000000000176', 'SKU-0017', 'Potato Chips 60g',             'Snacks',          'pack',    35.00,  27.00, 20, 180),
('2000000000183', 'SKU-0018', 'Bath Soap 90g',                'Personal Care',   'bar',     38.00,  29.50, 15, NULL),
('2000000000190', 'SKU-0019', 'Shampoo Sachet 12ml',          'Personal Care',   'sachet',   8.00,   5.90, 40, NULL),
('2000000000206', 'SKU-0020', 'Laundry Powder 1kg',           'Household',       'pack',   110.00,  91.00, 10, NULL);

-- Opening stock: one batch per product. Cooking oil and eggs start below reorder level;
-- milk and pandesal expire soon, so the low-stock and near-expiry alerts have data.
INSERT INTO inventory (product_id, quantity_on_hand, reorder_point, batch_number, expiry_date)
SELECT p.product_id,
       CASE p.product_code WHEN 'SKU-0012' THEN 6 WHEN 'SKU-0010' THEN 9 WHEN 'SKU-0015' THEN 14 ELSE p.reorder_level * 3 END,
       p.reorder_level,
       CONCAT('OPEN-', DATE_FORMAT(CURDATE(), '%Y%m%d')),
       CASE
         WHEN p.product_code = 'SKU-0009' THEN DATE_ADD(CURDATE(), INTERVAL 4 DAY)
         WHEN p.product_code = 'SKU-0015' THEN DATE_ADD(CURDATE(), INTERVAL 2 DAY)
         WHEN p.shelf_life_days IS NOT NULL THEN DATE_ADD(CURDATE(), INTERVAL p.shelf_life_days DAY)
         ELSE NULL
       END
FROM products p;

-- Record the opening stock in the movement ledger (under the first sample cashier, since there is no owner yet)
SET @stock_user = (SELECT MIN(user_id) FROM users);
INSERT INTO inventory_adjustments (inventory_id, user_id, quantity_change, reason, adjustment_type)
SELECT inventory_id, @stock_user, quantity_on_hand, 'Opening stock (sample data)', 'receive'
FROM inventory;

-- Default hardware settings for each terminal (configured properly in the Hardware step)
INSERT INTO hardware_config (terminal_id, config_type, settings)
SELECT t.terminal_id, c.config_type, c.settings
FROM terminals t
CROSS JOIN (
  SELECT 'printer' AS config_type, JSON_OBJECT('connection', 'usb', 'protocol', 'ESC/POS', 'paper_width_mm', 58) AS settings
  UNION ALL SELECT 'scanner', JSON_OBJECT('connection', 'keyboard', 'suffix_key', 'Enter', 'max_interkey_ms', 40)
  UNION ALL SELECT 'drawer', JSON_OBJECT('connection', 'printer_pulse', 'pin', 2)
) c;
