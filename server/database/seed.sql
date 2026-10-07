-- =====================================================================
-- Seed data for a fresh database (runs once, inside one transaction).
-- Products, suppliers, barcodes and the business TIN/address are SAMPLE
-- values for development and testing. Replace them before deployment.
-- =====================================================================

-- Roles -----------------------------------------------------------------
INSERT INTO roles (role_name, description, permissions) VALUES
  ('Owner', 'Owner/Administrator. Full access; approves high-risk actions with a 6-digit PIN.', JSON_ARRAY('*')),
  ('Cashier', 'Assigned to a terminal by the Owner. No credentials.',
     JSON_ARRAY('pos:sell', 'products:lookup', 'customer_requests:create', 'cash_drawer:movement'));

-- Owner account -----------------------------------------------------------
-- Username: owner   Default PIN: 123456 (bcrypt, cost 12). must_change_pin forces a new PIN on first login.
INSERT INTO users (employee_code, role_id, first_name, last_name, contact_number, username, pin_hash, must_change_pin)
SELECT 'EMP-0001', role_id, 'Rey', 'Pazon', NULL, 'owner',
       '$2b$12$32NBiA4GmgP9YLjcfnSbwOCm20q3gpsMP3w7H6RpeNK4GDCG1BdkW', 1
FROM roles WHERE role_name = 'Owner';

SET @owner_id = (SELECT user_id FROM users WHERE username = 'owner');

-- Sample cashiers (no username / PIN) --------------------------------------
INSERT INTO users (employee_code, role_id, first_name, last_name, contact_number, created_by)
SELECT v.code, r.role_id, v.first_name, v.last_name, v.contact, @owner_id
FROM (VALUES
  ROW('EMP-0002', 'Juan', 'Dela Cruz', '09170000001'),
  ROW('EMP-0003', 'Maria', 'Santos', '09170000002'),
  ROW('EMP-0004', 'Jose', 'Reyes', '09170000003')
) AS v (code, first_name, last_name, contact)
JOIN roles r ON r.role_name = 'Cashier';

-- Terminals -----------------------------------------------------------------
-- registered_at stays NULL until each PC registers itself on first launch.
INSERT INTO terminals (terminal_code, display_name) VALUES
  ('PC-01', 'Counter 1'),
  ('PC-02', 'Counter 2'),
  ('PC-03', 'Counter 3');

INSERT INTO invoice_sequences (terminal_id, sequence_year, last_number)
SELECT terminal_id, YEAR(CURDATE()), 0 FROM terminals;

INSERT INTO hardware_config (terminal_id, config_type, connection_type, settings, updated_by)
SELECT t.terminal_id, v.config_type, v.connection_type, CAST(v.settings AS JSON), @owner_id
FROM terminals t
CROSS JOIN (VALUES
  ROW('receipt_printer', 'usb', '{"protocol": "ESC/POS", "paperWidthMm": 58, "charsPerLine": 32, "vendorId": null, "productId": null}'),
  ROW('barcode_scanner', 'keyboard_wedge', '{"suffixKey": "Enter", "minLength": 6, "maxInterKeyMs": 40}'),
  ROW('cash_drawer', 'printer_pulse', '{"pin": 2, "onMs": 100, "offMs": 100}')
) AS v (config_type, connection_type, settings);

-- Categories and suppliers (sample) ---------------------------------------------
INSERT INTO categories (category_name) VALUES
  ('Rice & Grains'), ('Canned Goods'), ('Beverages'), ('Dairy & Eggs'),
  ('Noodles & Pasta'), ('Condiments'), ('Snacks'), ('Bakery'),
  ('Personal Care'), ('Household');

INSERT INTO suppliers (supplier_name, contact_person, contact_number, address, lead_time_days) VALUES
  ('Sample Grains Supplier', 'Sales Desk', '09180000001', 'Cebu City (sample)', 2),
  ('Sample Grocery Distributor', 'Sales Desk', '09180000002', 'Mandaue City (sample)', 3),
  ('Sample Beverage Distributor', 'Sales Desk', '09180000003', 'Cebu City (sample)', 4),
  ('Sample Dairy & Bakery Supplier', 'Sales Desk', '09180000004', 'Lapu-Lapu City (sample)', 1);

-- Products (sample) -------------------------------------------------------------
-- unit_price is VAT-inclusive. Barcodes are placeholders, not real GTINs.
INSERT INTO products (product_code, barcode, product_name, category_id, supplier_id, unit_of_measure,
                      unit_price, cost_price, reorder_level, shelf_life_days, is_perishable, is_vat_exempt, created_by)
SELECT v.code, v.barcode, v.name, c.category_id, s.supplier_id, v.uom, v.price, v.cost, v.reorder_level,
       v.shelf_life, v.perishable, v.vat_exempt, @owner_id
FROM (VALUES
  ROW('SKU-0001', '2000000000015', 'Rice 5kg',                    'Rice & Grains',   'Sample Grains Supplier',        'sack',   280.00, 235.00, 15, NULL, 0, 1),
  ROW('SKU-0002', '2000000000022', 'Rice 1kg',                    'Rice & Grains',   'Sample Grains Supplier',        'pack',    58.00,  48.00, 20, NULL, 0, 1),
  ROW('SKU-0003', '2000000000039', 'Canned Tuna 155g',            'Canned Goods',    'Sample Grocery Distributor',    'can',     45.00,  36.00, 24, 730,  0, 0),
  ROW('SKU-0004', '2000000000046', 'Sardines in Tomato Sauce 155g','Canned Goods',   'Sample Grocery Distributor',    'can',     26.00,  20.50, 30, 730,  0, 0),
  ROW('SKU-0005', '2000000000053', 'Corned Beef 150g',            'Canned Goods',    'Sample Grocery Distributor',    'can',     48.00,  39.00, 18, 730,  0, 0),
  ROW('SKU-0006', '2000000000060', 'Bottled Water 1L',            'Beverages',       'Sample Beverage Distributor',   'bottle',  20.00,  14.00, 36, 365,  0, 0),
  ROW('SKU-0007', '2000000000077', 'Cola 1.5L',                   'Beverages',       'Sample Beverage Distributor',   'bottle',  75.00,  61.00, 12, 180,  0, 0),
  ROW('SKU-0008', '2000000000084', 'Coffee 3-in-1 Sachet',        'Beverages',       'Sample Grocery Distributor',    'sachet',   9.00,   6.80, 60, 365,  0, 0),
  ROW('SKU-0009', '2000000000091', 'Fresh Milk 1L',               'Dairy & Eggs',    'Sample Dairy & Bakery Supplier','carton',  98.00,  82.00,  8, 10,   1, 0),
  ROW('SKU-0010', '2000000000107', 'Eggs (Tray of 30)',           'Dairy & Eggs',    'Sample Dairy & Bakery Supplier','tray',   240.00, 205.00, 12, 21,   1, 0),
  ROW('SKU-0011', '2000000000114', 'Instant Noodles Chicken 55g', 'Noodles & Pasta', 'Sample Grocery Distributor',    'pack',    14.00,  10.50, 48, 240,  0, 0),
  ROW('SKU-0012', '2000000000121', 'Cooking Oil 1L',              'Condiments',      'Sample Grocery Distributor',    'bottle', 115.00,  96.00, 10, 540,  0, 0),
  ROW('SKU-0013', '2000000000138', 'Soy Sauce 1L',                'Condiments',      'Sample Grocery Distributor',    'bottle',  52.00,  41.00, 10, 540,  0, 0),
  ROW('SKU-0014', '2000000000145', 'White Sugar 1kg',             'Condiments',      'Sample Grains Supplier',        'pack',    85.00,  72.00, 12, 730,  0, 0),
  ROW('SKU-0015', '2000000000152', 'Pandesal (10 pcs)',           'Bakery',          'Sample Dairy & Bakery Supplier','pack',    50.00,  38.00,  6, 3,    1, 0),
  ROW('SKU-0016', '2000000000169', 'Loaf Bread',                  'Bakery',          'Sample Dairy & Bakery Supplier','loaf',    75.00,  60.00,  6, 5,    1, 0),
  ROW('SKU-0017', '2000000000176', 'Potato Chips 60g',            'Snacks',          'Sample Grocery Distributor',    'pack',    35.00,  27.00, 20, 180,  0, 0),
  ROW('SKU-0018', '2000000000183', 'Bath Soap 90g',               'Personal Care',   'Sample Grocery Distributor',    'bar',     38.00,  29.50, 15, NULL, 0, 0),
  ROW('SKU-0019', '2000000000190', 'Shampoo Sachet 12ml',         'Personal Care',   'Sample Grocery Distributor',    'sachet',   8.00,   5.90, 40, NULL, 0, 0),
  ROW('SKU-0020', '2000000000206', 'Laundry Powder 1kg',          'Household',       'Sample Grocery Distributor',    'pack',   110.00,  91.00, 10, NULL, 0, 0)
) AS v (code, barcode, name, category, supplier, uom, price, cost, reorder_level, shelf_life, perishable, vat_exempt)
JOIN categories c ON c.category_name = v.category
JOIN suppliers s ON s.supplier_name = v.supplier;

-- Opening stock: one batch per product. Perishables get an expiry based on shelf life;
-- a few are seeded below reorder level or near expiry so alerts have something to show.
INSERT INTO inventory (product_id, batch_number, quantity_on_hand, expiry_date)
SELECT p.product_id,
       CONCAT('OPEN-', DATE_FORMAT(CURDATE(), '%Y%m%d')),
       CASE p.product_code
         WHEN 'SKU-0012' THEN 6     -- cooking oil: below reorder level (10)
         WHEN 'SKU-0010' THEN 9     -- eggs: below reorder level (12)
         WHEN 'SKU-0015' THEN 14
         ELSE p.reorder_level * 3
       END,
       CASE
         WHEN p.product_code = 'SKU-0009' THEN DATE_ADD(CURDATE(), INTERVAL 4 DAY)  -- milk: near expiry
         WHEN p.product_code = 'SKU-0015' THEN DATE_ADD(CURDATE(), INTERVAL 2 DAY)  -- pandesal: near expiry
         WHEN p.shelf_life_days IS NOT NULL THEN DATE_ADD(CURDATE(), INTERVAL p.shelf_life_days DAY)
         ELSE NULL
       END
FROM products p;

INSERT INTO inventory_adjustments (inventory_id, product_id, user_id, adjustment_type, quantity_change,
                                   quantity_before, quantity_after, reason, reference_type)
SELECT i.inventory_id, i.product_id, @owner_id, 'initial_stock', i.quantity_on_hand, 0, i.quantity_on_hand,
       'Opening stock (seed data)', 'seed'
FROM inventory i;

-- System settings -------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, category, description, updated_by) VALUES
  -- Business profile (printed on invoices and reports)
  ('business_name',            'Rey Pazon''s 9010 Grocery Store', 'string',  'business', 'Registered business name', @owner_id),
  ('business_owner',           'Rey Pazon',                      'string',  'business', 'Proprietor name', @owner_id),
  ('business_address',         'Cebu, Philippines (update before deployment)', 'string', 'business', 'Registered address', @owner_id),
  ('business_tin',             '000-000-000-00000',              'string',  'business', 'VAT Reg TIN (placeholder)', @owner_id),
  ('vat_registered',           'true',                           'boolean', 'business', 'Whether the business is VAT-registered', @owner_id),
  ('currency',                 'PHP',                            'string',  'business', 'Currency code', @owner_id),
  ('timezone',                 'Asia/Manila',                    'string',  'business', 'Store time zone', @owner_id),
  -- Tax, discounts and invoices
  ('vat_rate',                 '0.12',                           'number',  'tax',      'VAT rate (fraction)', @owner_id),
  ('sc_pwd_discount_rate',     '0.20',                           'number',  'tax',      'Senior Citizen / PWD discount (RA 9994, RA 10754)', @owner_id),
  ('discount_pin_threshold',   '0.20',                           'number',  'tax',      'Manual discounts above this fraction need the Owner PIN', @owner_id),
  ('invoice_prefix',           'INV',                            'string',  'invoice',  'Invoice number prefix (INV-YYYY-NNNNNN)', @owner_id),
  ('invoice_title',            'SALES INVOICE',                  'string',  'invoice',  'Document title printed on receipts', @owner_id),
  ('invoice_footer',           'Thank you for shopping with us!', 'string', 'invoice',  'Footer printed on receipts', @owner_id),
  ('return_window_days',       '7',                              'number',  'invoice',  'Days after a sale that refunds are accepted', @owner_id),
  -- Inventory
  ('default_reorder_level',    '10',                             'number',  'inventory','Default reorder level for new products', @owner_id),
  ('expiry_warning_days',      '7',                              'number',  'inventory','Warn when stock expires within this many days', @owner_id),
  -- AI / forecasting (engine still to be chosen)
  ('forecast_engine',          'forecast-engine-tbd',            'string',  'ai',       'Forecasting engine in use (placeholder until chosen)', @owner_id),
  ('forecast_min_history_weeks','8',                             'number',  'ai',       'Weeks of sales needed before AI forecasts replace reorder-level fallback (to be finalized)', @owner_id),
  ('forecast_horizon_weeks',   '4',                              'number',  'ai',       'How many weeks ahead to forecast', @owner_id),
  -- Security and anomaly thresholds
  ('owner_pin_max_attempts',   '5',                              'number',  'security', 'Wrong PIN attempts before a temporary lockout', @owner_id),
  ('owner_pin_lockout_minutes','5',                              'number',  'security', 'Lockout length after too many wrong PINs', @owner_id),
  ('void_alert_per_shift',     '3',                              'number',  'security', 'Flag a session with more voids than this', @owner_id),
  ('unusual_hours_start',      '21:00',                          'string',  'security', 'Sales after this time are flagged', @owner_id),
  ('unusual_hours_end',        '06:00',                          'string',  'security', 'Sales before this time are flagged', @owner_id),
  ('session_poll_seconds',     '3',                              'number',  'security', 'How often terminals check their assignment status', @owner_id),
  -- Payments
  ('payment_methods',          '["cash","gcash","maya","card"]', 'json',    'payments', 'Enabled payment methods', @owner_id),
  -- Network and maintenance
  ('server_port',              '4010',                           'number',  'system',   'API port on the server PC', @owner_id),
  ('backup_directory',         '',                               'string',  'system',   'Folder for database backups (set in Settings)', @owner_id);

-- Record the seed in the audit log.
INSERT INTO audit_logs (user_id, action, entity_type, new_values)
VALUES (@owner_id, 'system.seed', 'database', JSON_OBJECT('note', 'Initial seed data loaded'));
