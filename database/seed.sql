-- =====================================================
-- Seed data (runs once on first launch, in one transaction).
-- There is no owner account here: on start-up the server adds the default admin (username "admin",
-- PIN 000000) whenever no owner exists, and the first sign-in must replace its username, name and PIN.
-- =====================================================

INSERT INTO roles (role_name, description, permissions) VALUES
('Owner', 'Full system access', '{"all": true}'),
('Cashier', 'POS access only', '{"pos": true, "customer_requests": true}');

-- Terminals
INSERT INTO terminals (terminal_id, terminal_name) VALUES
('PC-01', 'Cashier Terminal 1'),
('PC-02', 'Cashier Terminal 2'),
('PC-03', 'Cashier Terminal 3');

-- System settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('business_name', '', 'Business name for receipts'),
('business_tin', '', 'BIR TIN'),
('business_address', '', 'Business address'),
('vat_rate', '12', 'VAT percentage'),
('discount_threshold', '20', 'Discount % requiring owner approval'),
('void_threshold', '1', 'Any void requires owner approval'),
('currency', 'PHP', 'Currency'),
('receipt_prefix', 'INV', 'Receipt number prefix'),
('receipt_counter', '0', 'Current receipt counter'),
('senior_pwd_discount', '20', 'Senior/PWD discount percent (RA 9994 / RA 10754)'),
('ml_min_samples', '30', 'Minimum days of history to train ML models');

INSERT INTO grand_total (id, accumulated_total) VALUES (1, 0);
