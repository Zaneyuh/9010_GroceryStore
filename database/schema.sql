-- =====================================================
-- AI-Assisted Business Management System
-- Rey Pazon's 9010 Grocery Store — MySQL 8 schema (version 1)
--
-- Based on the project spec schema. Changes from the spec are marked "FIX (a)"–"FIX (e)":
--   (a) users.username is optional so cashiers need no credentials
--   (b) payment methods are cash / gcash / maya / card (+ payment_reference)
--   (c) transactions store Senior/PWD details and the VAT breakdown for the receipt
--   (d) the database itself allows only one active session per terminal and per employee
--   (e) refunds and refund_items record full and partial refunds
-- schema_migrations is setup bookkeeping used by the first-run initializer.
-- =====================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE schema_migrations (
  version INT PRIMARY KEY,
  description VARCHAR(255) NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ROLES
-- =====================================================
CREATE TABLE roles (
  role_id INT PRIMARY KEY AUTO_INCREMENT,
  role_name VARCHAR(50) NOT NULL UNIQUE,      -- 'Owner', 'Cashier'
  description VARCHAR(255),
  permissions JSON
);

-- =====================================================
-- USERS
-- =====================================================
CREATE TABLE users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NULL,            -- FIX (a): only the owner has one
  pin_hash VARCHAR(255),                       -- bcrypt; ONLY owner has this
  role_id INT NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  failed_attempts INT DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME NULL,
  FOREIGN KEY (role_id) REFERENCES roles(role_id),
  -- FIX (a): a username and a PIN always come together (owner), or neither is set (cashier)
  CONSTRAINT chk_users_credentials CHECK ((username IS NULL) = (pin_hash IS NULL))
);

-- =====================================================
-- TERMINALS
-- =====================================================
CREATE TABLE terminals (
  terminal_id VARCHAR(20) PRIMARY KEY,         -- 'PC-01', 'PC-02', 'PC-03'
  terminal_name VARCHAR(50),
  ip_address VARCHAR(45),
  is_active BOOLEAN DEFAULT TRUE,
  last_seen DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SESSIONS (Owner-controlled terminal assignment)
-- =====================================================
CREATE TABLE sessions (
  session_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  terminal_id VARCHAR(20) NOT NULL,
  assigned_by INT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  login_time DATETIME NULL,
  logout_time DATETIME NULL,
  is_active BOOLEAN DEFAULT TRUE,
  end_reason VARCHAR(50),                      -- 'owner_ended' | 'cashier_logout' | 'system'
  -- FIX (d): these columns are filled only while the session is active, and are UNIQUE,
  -- so MySQL rejects a second active session on the same terminal or for the same employee.
  active_terminal_id VARCHAR(20) GENERATED ALWAYS AS (IF(is_active, terminal_id, NULL)) STORED,
  active_user_id INT GENERATED ALWAYS AS (IF(is_active, user_id, NULL)) STORED,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id),
  FOREIGN KEY (assigned_by) REFERENCES users(user_id),
  UNIQUE KEY uq_one_active_session_per_terminal (active_terminal_id),
  UNIQUE KEY uq_one_active_session_per_user (active_user_id),
  INDEX idx_active_terminal (terminal_id, is_active),
  INDEX idx_active_user (user_id, is_active)
);

-- =====================================================
-- PRODUCTS
-- =====================================================
CREATE TABLE products (
  product_id INT PRIMARY KEY AUTO_INCREMENT,
  barcode VARCHAR(50) UNIQUE,
  product_code VARCHAR(50) UNIQUE,
  product_name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  unit_of_measure VARCHAR(20),
  unit_price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2),
  reorder_level INT DEFAULT 10,
  shelf_life_days INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_barcode (barcode),
  INDEX idx_name (product_name)
);

-- =====================================================
-- INVENTORY
-- =====================================================
CREATE TABLE inventory (
  inventory_id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  quantity_on_hand INT NOT NULL DEFAULT 0,
  reorder_point INT DEFAULT 10,
  location VARCHAR(50),
  batch_number VARCHAR(50),
  expiry_date DATE NULL,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  INDEX idx_product (product_id),
  INDEX idx_expiry (expiry_date)
);

-- =====================================================
-- INVENTORY ADJUSTMENTS
-- =====================================================
CREATE TABLE inventory_adjustments (
  adjustment_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  inventory_id INT NOT NULL,
  user_id INT NOT NULL,
  session_id INT,
  quantity_change INT NOT NULL,
  reason VARCHAR(255),
  adjustment_type ENUM('sale','receive','waste','adjustment','void_return') NOT NULL,
  reference_id BIGINT,
  adjustment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_id) REFERENCES inventory(inventory_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  INDEX idx_type (adjustment_type),
  INDEX idx_date (adjustment_date)
);

-- =====================================================
-- TRANSACTIONS
-- =====================================================
CREATE TABLE transactions (
  transaction_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_number VARCHAR(30) UNIQUE NOT NULL,  -- e.g. 'INV-2026-000123'
  cashier_id INT NOT NULL,
  session_id INT NOT NULL,
  terminal_id VARCHAR(20) NOT NULL,
  transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- FIX (c): customer type and Senior/PWD details (RA 9994 / RA 10754)
  customer_type ENUM('regular','senior','pwd') NOT NULL DEFAULT 'regular',
  senior_pwd_id VARCHAR(50) NULL,
  senior_pwd_name VARCHAR(100) NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  discount_total DECIMAL(10,2) DEFAULT 0,
  -- FIX (c): VAT breakdown printed on the receipt
  vatable_sales DECIMAL(10,2) NOT NULL DEFAULT 0,
  vat_exempt_sales DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('cash','gcash','maya','card') DEFAULT 'cash',   -- FIX (b)
  payment_reference VARCHAR(60) NULL,                                  -- FIX (b): GCash/Maya ref or card approval code
  amount_received DECIMAL(10,2),
  change_given DECIMAL(10,2),
  status ENUM('completed','voided','refunded','partially_refunded') DEFAULT 'completed',  -- FIX (e)
  voided_by INT NULL,
  void_reason VARCHAR(255),
  voided_at DATETIME NULL,
  FOREIGN KEY (cashier_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id),
  FOREIGN KEY (voided_by) REFERENCES users(user_id),
  -- FIX (c): Senior/PWD sales must carry the ID number and name
  CONSTRAINT chk_transactions_senior_pwd CHECK (customer_type = 'regular' OR (senior_pwd_id IS NOT NULL AND senior_pwd_name IS NOT NULL)),
  INDEX idx_date (transaction_date),
  INDEX idx_cashier (cashier_id),
  INDEX idx_status (status)
);

-- =====================================================
-- TRANSACTION ITEMS
-- =====================================================
CREATE TABLE transaction_items (
  transaction_item_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  transaction_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(100) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  discount_applied DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  INDEX idx_transaction (transaction_id)
);

-- =====================================================
-- WASTE RECORDS
-- =====================================================
CREATE TABLE waste_records (
  waste_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  inventory_id INT NOT NULL,
  user_id INT NOT NULL,
  quantity INT NOT NULL,
  reason ENUM('damaged','expired','spoiled','other') NOT NULL,
  notes VARCHAR(255),
  waste_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  FOREIGN KEY (inventory_id) REFERENCES inventory(inventory_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_date (waste_date)
);

-- =====================================================
-- CUSTOMER REQUESTS
-- =====================================================
CREATE TABLE customer_requests (
  request_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  cashier_id INT NOT NULL,
  product_name_requested VARCHAR(100) NOT NULL,
  quantity_requested INT,
  request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','available','closed') DEFAULT 'pending',
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  notes VARCHAR(255),
  FOREIGN KEY (cashier_id) REFERENCES users(user_id),
  FOREIGN KEY (reviewed_by) REFERENCES users(user_id),
  INDEX idx_status (status)
);

-- =====================================================
-- REORDER LISTS
-- =====================================================
CREATE TABLE reorder_lists (
  reorder_list_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  created_by INT NOT NULL,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','approved','rejected','completed') DEFAULT 'pending',
  approved_by INT NULL,
  approval_date DATETIME NULL,
  notes TEXT,
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

CREATE TABLE reorder_items (
  reorder_item_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  reorder_list_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  suggested_quantity INT NOT NULL,
  approved_quantity INT,
  actual_cost DECIMAL(10,2),
  is_approved BOOLEAN DEFAULT FALSE,
  reason VARCHAR(255),
  FOREIGN KEY (reorder_list_id) REFERENCES reorder_lists(reorder_list_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- =====================================================
-- PURCHASE ORDERS (full lifecycle)
-- =====================================================
CREATE TABLE purchase_orders (
  po_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  po_number VARCHAR(30) UNIQUE NOT NULL,
  reorder_list_id BIGINT NULL,
  supplier VARCHAR(100),
  expected_delivery DATE,
  status ENUM('pending','partially_received','completed','cancelled') DEFAULT 'pending',
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  notes TEXT,
  FOREIGN KEY (reorder_list_id) REFERENCES reorder_lists(reorder_list_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE purchase_order_items (
  po_item_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  po_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  ordered_quantity INT NOT NULL,
  received_quantity INT DEFAULT 0,
  unit_cost DECIMAL(10,2),
  FOREIGN KEY (po_id) REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- =====================================================
-- DEMAND FORECASTS (ML models, not WMA)
-- =====================================================
CREATE TABLE demand_forecasts (
  forecast_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  forecast_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  predicted_demand DECIMAL(10,2),
  confidence_score DECIMAL(5,2),
  historical_data_used JSON,
  model_name VARCHAR(30) NOT NULL,             -- 'xgboost' | 'catboost' | 'lightgbm' | 'random_forest'
  backtest_mae DECIMAL(10,4),
  backtest_mape DECIMAL(10,4),
  model_version VARCHAR(20),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  UNIQUE KEY unique_forecast (product_id, forecast_date, period_start, period_end)
);

-- =====================================================
-- SUPERVISOR OVERRIDES
-- =====================================================
CREATE TABLE supervisor_overrides (
  override_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id INT NOT NULL,
  terminal_id VARCHAR(20) NOT NULL,
  requested_by INT NOT NULL,
  approved_by INT NOT NULL,
  action_type ENUM('void','discount','drawer_open','refund') NOT NULL,
  reference_id BIGINT,
  details JSON,
  reason VARCHAR(255),
  override_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (requested_by) REFERENCES users(user_id),
  FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

-- =====================================================
-- REFUNDS — FIX (e)
-- One row per refund event; a sale can have several partial refunds.
-- Every refund needs an owner PIN approval (supervisor_overrides, action_type 'refund').
-- =====================================================
CREATE TABLE refunds (
  refund_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  transaction_id BIGINT NOT NULL,
  session_id INT NOT NULL,
  terminal_id VARCHAR(20) NOT NULL,
  processed_by INT NOT NULL,                   -- cashier on the terminal
  approved_by INT NOT NULL,                    -- owner who entered the PIN
  override_id BIGINT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  refund_method ENUM('cash','gcash','maya','card') NOT NULL,
  refund_amount DECIMAL(10,2) NOT NULL,
  refunded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id),
  FOREIGN KEY (processed_by) REFERENCES users(user_id),
  FOREIGN KEY (approved_by) REFERENCES users(user_id),
  FOREIGN KEY (override_id) REFERENCES supervisor_overrides(override_id),
  CONSTRAINT chk_refunds_amount CHECK (refund_amount > 0),
  INDEX idx_refund_transaction (transaction_id),
  INDEX idx_refund_date (refunded_at)
);

CREATE TABLE refund_items (
  refund_item_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  refund_id BIGINT NOT NULL,
  transaction_item_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  restocked BOOLEAN DEFAULT TRUE,              -- FALSE = item written off instead of returned to stock
  FOREIGN KEY (refund_id) REFERENCES refunds(refund_id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_item_id) REFERENCES transaction_items(transaction_item_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id),
  CONSTRAINT chk_refund_items_quantity CHECK (quantity > 0)
);

-- =====================================================
-- AUDIT LOGS
-- =====================================================
CREATE TABLE audit_logs (
  log_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  session_id INT,
  action VARCHAR(50) NOT NULL,
  module VARCHAR(50),
  details JSON,
  terminal_id VARCHAR(20),
  ip_address VARCHAR(45),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_action (action),
  INDEX idx_flagged (is_flagged)
);

-- =====================================================
-- HARDWARE CONFIG
-- =====================================================
CREATE TABLE hardware_config (
  config_id INT PRIMARY KEY AUTO_INCREMENT,
  terminal_id VARCHAR(20) NOT NULL,
  config_type ENUM('printer','scanner','drawer') NOT NULL,
  settings JSON,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id)
);

-- =====================================================
-- SYSTEM SETTINGS
-- =====================================================
CREATE TABLE system_settings (
  setting_id INT PRIMARY KEY AUTO_INCREMENT,
  setting_key VARCHAR(50) UNIQUE NOT NULL,
  setting_value TEXT,
  description VARCHAR(255),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =====================================================
-- X/Z READINGS
-- =====================================================
CREATE TABLE readings (
  reading_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  reading_type ENUM('X','Z') NOT NULL,
  terminal_id VARCHAR(20) NOT NULL,
  cashier_id INT NOT NULL,
  session_id INT NOT NULL,
  reading_date DATE NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  gross_sales DECIMAL(10,2),
  discounts DECIMAL(10,2),
  voids DECIMAL(10,2),
  net_sales DECIMAL(10,2),
  transaction_count INT,
  payment_breakdown JSON,
  details JSON,
  FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id),
  FOREIGN KEY (cashier_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- =====================================================
-- ACCUMULATED GRAND TOTAL (BIR requirement)
-- =====================================================
CREATE TABLE grand_total (
  id INT PRIMARY KEY DEFAULT 1,
  accumulated_total DECIMAL(14,2) DEFAULT 0,
  last_z_reading_at DATETIME NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
