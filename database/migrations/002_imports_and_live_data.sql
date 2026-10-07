-- =====================================================
-- Schema version 2: the workspace screens read and write MySQL, and data can be imported
-- from the old system. Adds the fields those screens already use but version 1 lacked.
-- Written for MySQL 8 and MariaDB 10.4+ (XAMPP).
-- =====================================================

-- Products: supplier and delivery lead time drive reorder suggestions and purchase orders.
ALTER TABLE products
  ADD COLUMN supplier_name VARCHAR(100) NULL AFTER category,
  ADD COLUMN lead_time_days INT NULL AFTER reorder_level;

-- Employees can be marked on leave without deactivating them.
ALTER TABLE users
  ADD COLUMN on_leave BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;

-- Waste: theft/shrink and customer returns written off are tracked separately.
ALTER TABLE waste_records
  MODIFY reason ENUM('damaged','expired','spoiled','theft','customer_return','other') NOT NULL;

-- Customer requests: the full status flow, who asked, and requests imported without a cashier.
ALTER TABLE customer_requests
  MODIFY cashier_id INT NULL,
  MODIFY status ENUM('pending','reviewing','ordered','available','declined','closed') DEFAULT 'pending',
  ADD COLUMN category VARCHAR(50) NULL AFTER product_name_requested,
  ADD COLUMN requested_by VARCHAR(100) NULL AFTER category,
  ADD COLUMN contact VARCHAR(100) NULL AFTER requested_by;

-- PC-00 is not a real cashier PC. Sales rung up by the owner on the server PC, and sales imported
-- from the old system, are recorded against sessions on it. It is disabled so nobody can be assigned
-- to it, and the Admin Station and terminal setup screens do not list it.
INSERT INTO terminals (terminal_id, terminal_name, is_active)
SELECT 'PC-00', 'Server PC / imported history', FALSE
WHERE NOT EXISTS (SELECT 1 FROM terminals WHERE terminal_id = 'PC-00');
