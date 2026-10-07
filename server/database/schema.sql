-- =====================================================================
-- AI-Assisted Business Management System
-- Rey Pazon's 9010 Grocery Store — MySQL 8.0 schema (version 1)
--
-- Conventions
--   * InnoDB, utf8mb4, DATETIME stored in Philippine time (+08:00)
--   * Money: DECIMAL(12,2); rates: DECIMAL(5,4); quantities: INT (whole units)
--   * Records referenced by sales/audit history are deactivated (is_active = 0), never deleted
--   * Every high-risk action links to supervisor_overrides; every mutation is written to audit_logs
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE schema_version (
  version      INT          NOT NULL PRIMARY KEY,
  description  VARCHAR(255) NOT NULL,
  applied_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- People, terminals and sessions (Owner-Controlled Terminal Assignment)
-- ---------------------------------------------------------------------

CREATE TABLE roles (
  role_id      TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role_name    VARCHAR(30)  NOT NULL,
  description  VARCHAR(255) NULL,
  permissions  JSON         NOT NULL,
  CONSTRAINT uq_roles_name UNIQUE (role_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Only the Owner has credentials (username + 6-digit PIN, bcrypt). Cashiers have none:
-- they are assigned to a terminal by the Owner from the Admin Station.
CREATE TABLE users (
  user_id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  employee_code    VARCHAR(20)  NOT NULL,
  role_id          TINYINT UNSIGNED NOT NULL,
  first_name       VARCHAR(60)  NOT NULL,
  last_name        VARCHAR(60)  NOT NULL,
  contact_number   VARCHAR(20)  NULL,
  email            VARCHAR(120) NULL,
  username         VARCHAR(40)  NULL,
  pin_hash         CHAR(60)     NULL,
  must_change_pin  TINYINT(1)   NOT NULL DEFAULT 0,
  failed_pin_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until     DATETIME     NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  last_login       DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT UNSIGNED NULL,
  CONSTRAINT uq_users_employee_code UNIQUE (employee_code),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (role_id),
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users (user_id),
  CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id),
  CONSTRAINT ck_users_credentials CHECK ((username IS NULL AND pin_hash IS NULL) OR (username IS NOT NULL AND pin_hash IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per cashier PC. Each terminal registers itself on first launch.
-- accumulated_grand_total is the BIR non-resettable running sales total for this machine.
CREATE TABLE terminals (
  terminal_id              TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  terminal_code            VARCHAR(10)   NOT NULL,
  display_name             VARCHAR(60)   NOT NULL,
  machine_serial_number    VARCHAR(40)   NULL,
  permit_to_use_number     VARCHAR(40)   NULL,
  last_ip_address          VARCHAR(45)   NULL,
  accumulated_grand_total  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  is_active                TINYINT(1)    NOT NULL DEFAULT 1,
  registered_at            DATETIME      NULL,
  last_seen_at             DATETIME      NULL,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_terminals_code UNIQUE (terminal_code),
  CONSTRAINT ck_terminals_agt CHECK (accumulated_grand_total >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A cashier assignment to a terminal. The generated columns let MySQL guarantee
-- at most one active session per terminal and per cashier.
CREATE TABLE sessions (
  session_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  terminal_id    TINYINT UNSIGNED NOT NULL,
  assigned_by    INT UNSIGNED NOT NULL,
  assigned_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  ended_at       DATETIME     NULL,
  ended_by       INT UNSIGNED NULL,
  end_reason     ENUM('shift_end', 'reassigned', 'owner_ended', 'terminal_offline', 'system') NULL,
  opening_float  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  active_terminal_id TINYINT UNSIGNED GENERATED ALWAYS AS (IF(is_active = 1, terminal_id, NULL)) STORED,
  active_user_id     INT UNSIGNED     GENERATED ALWAYS AS (IF(is_active = 1, user_id, NULL)) STORED,
  CONSTRAINT uq_sessions_active_terminal UNIQUE (active_terminal_id),
  CONSTRAINT uq_sessions_active_user UNIQUE (active_user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_sessions_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_sessions_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (user_id),
  CONSTRAINT fk_sessions_ended_by FOREIGN KEY (ended_by) REFERENCES users (user_id),
  CONSTRAINT ck_sessions_end CHECK ((is_active = 1 AND ended_at IS NULL) OR (is_active = 0 AND ended_at IS NOT NULL)),
  INDEX ix_sessions_terminal_time (terminal_id, assigned_at),
  INDEX ix_sessions_user_time (user_id, assigned_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Owner PIN approvals entered at a terminal: voids, refunds, discounts above the threshold, no-sale drawer opens.
CREATE TABLE supervisor_overrides (
  override_id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action_type       ENUM('void', 'refund', 'discount_above_threshold', 'open_drawer_no_sale', 'other') NOT NULL,
  approved_by       INT UNSIGNED NOT NULL,
  session_id        INT UNSIGNED NULL,
  terminal_id       TINYINT UNSIGNED NULL,
  requested_by      INT UNSIGNED NULL,
  reference_type    VARCHAR(30)  NULL,
  reference_id      INT UNSIGNED NULL,
  reason            VARCHAR(255) NOT NULL,
  approved_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_overrides_owner FOREIGN KEY (approved_by) REFERENCES users (user_id),
  CONSTRAINT fk_overrides_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_overrides_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_overrides_requested_by FOREIGN KEY (requested_by) REFERENCES users (user_id),
  INDEX ix_overrides_time (approved_at),
  INDEX ix_overrides_session_action (session_id, action_type)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Catalog and inventory
-- ---------------------------------------------------------------------

CREATE TABLE suppliers (
  supplier_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_name   VARCHAR(120) NOT NULL,
  contact_person  VARCHAR(120) NULL,
  contact_number  VARCHAR(20)  NULL,
  email           VARCHAR(120) NULL,
  address         VARCHAR(255) NULL,
  lead_time_days  SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_suppliers_name UNIQUE (supplier_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE categories (
  category_id    SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_name  VARCHAR(60) NOT NULL,
  is_active      TINYINT(1)  NOT NULL DEFAULT 1,
  CONSTRAINT uq_categories_name UNIQUE (category_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- unit_price is the VAT-inclusive shelf price. is_vat_exempt marks goods exempt from VAT by law.
CREATE TABLE products (
  product_id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_code     VARCHAR(30)  NOT NULL,
  barcode          VARCHAR(32)  NULL,
  product_name     VARCHAR(120) NOT NULL,
  category_id      SMALLINT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NULL,
  unit_of_measure  VARCHAR(20)  NOT NULL DEFAULT 'pc',
  unit_price       DECIMAL(12,2) NOT NULL,
  cost_price       DECIMAL(12,2) NOT NULL,
  reorder_level    INT UNSIGNED NOT NULL DEFAULT 0,
  shelf_life_days  SMALLINT UNSIGNED NULL,
  is_perishable    TINYINT(1)   NOT NULL DEFAULT 0,
  is_vat_exempt    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT UNSIGNED NULL,
  CONSTRAINT uq_products_code UNIQUE (product_code),
  CONSTRAINT uq_products_barcode UNIQUE (barcode),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (category_id),
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by) REFERENCES users (user_id),
  CONSTRAINT fk_products_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id),
  CONSTRAINT ck_products_prices CHECK (unit_price >= 0 AND cost_price >= 0),
  INDEX ix_products_name (product_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Stock is held per batch so expiry can be tracked; a product's stock on hand is SUM(quantity_on_hand).
CREATE TABLE inventory (
  inventory_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id        INT UNSIGNED NOT NULL,
  batch_number      VARCHAR(40)  NOT NULL DEFAULT 'DEFAULT',
  quantity_on_hand  INT          NOT NULL DEFAULT 0,
  expiry_date       DATE         NULL,
  location          VARCHAR(60)  NULL,
  received_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_inventory_batch UNIQUE (product_id, batch_number),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT ck_inventory_non_negative CHECK (quantity_on_hand >= 0),
  INDEX ix_inventory_expiry (expiry_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Inventory movement ledger: every addition, deduction and correction (REQ-4.4-12, 4.4-13).
CREATE TABLE inventory_adjustments (
  adjustment_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inventory_id      INT UNSIGNED NOT NULL,
  product_id        INT UNSIGNED NOT NULL,
  user_id           INT UNSIGNED NOT NULL,
  session_id        INT UNSIGNED NULL,
  adjustment_type   ENUM('sale', 'void_return', 'refund_restock', 'waste', 'receiving', 'manual_correction', 'stock_count', 'initial_stock') NOT NULL,
  quantity_change   INT          NOT NULL,
  quantity_before   INT          NOT NULL,
  quantity_after    INT          NOT NULL,
  reason            VARCHAR(255) NOT NULL,
  reference_type    VARCHAR(30)  NULL,
  reference_id      INT UNSIGNED NULL,
  adjustment_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_adjustments_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (inventory_id),
  CONSTRAINT fk_adjustments_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT fk_adjustments_user FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_adjustments_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT ck_adjustments_math CHECK (quantity_after = quantity_before + quantity_change AND quantity_after >= 0),
  INDEX ix_adjustments_product_time (product_id, adjustment_date),
  INDEX ix_adjustments_reference (reference_type, reference_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Sales (POS)
-- ---------------------------------------------------------------------

-- Next invoice number per terminal and year: INV-YYYY-NNNNNN.
CREATE TABLE invoice_sequences (
  terminal_id   TINYINT UNSIGNED NOT NULL,
  sequence_year SMALLINT UNSIGNED NOT NULL,
  last_number   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (terminal_id, sequence_year),
  CONSTRAINT fk_invoice_seq_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE transactions (
  transaction_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_number     VARCHAR(20)  NOT NULL,
  terminal_id        TINYINT UNSIGNED NOT NULL,
  session_id         INT UNSIGNED NOT NULL,
  cashier_id         INT UNSIGNED NOT NULL,
  transaction_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  customer_type      ENUM('regular', 'senior', 'pwd') NOT NULL DEFAULT 'regular',
  sc_pwd_id_number   VARCHAR(40)  NULL,
  sc_pwd_name        VARCHAR(120) NULL,
  gross_amount       DECIMAL(12,2) NOT NULL,
  vatable_sales      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  vat_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  vat_exempt_sales   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  zero_rated_sales   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  sc_pwd_discount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  other_discount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_override_id INT UNSIGNED NULL,
  total_amount       DECIMAL(12,2) NOT NULL,
  payment_method     ENUM('cash', 'gcash', 'maya', 'card') NOT NULL,
  amount_tendered    DECIMAL(12,2) NOT NULL,
  change_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_reference  VARCHAR(60)  NULL,
  status             ENUM('completed', 'voided', 'partially_refunded', 'refunded') NOT NULL DEFAULT 'completed',
  voided_at          DATETIME     NULL,
  void_override_id   INT UNSIGNED NULL,
  void_reason        VARCHAR(255) NULL,
  reprint_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT uq_transactions_invoice UNIQUE (terminal_id, invoice_number),
  CONSTRAINT fk_transactions_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_transactions_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_transactions_cashier FOREIGN KEY (cashier_id) REFERENCES users (user_id),
  CONSTRAINT fk_transactions_discount_override FOREIGN KEY (discount_override_id) REFERENCES supervisor_overrides (override_id),
  CONSTRAINT fk_transactions_void_override FOREIGN KEY (void_override_id) REFERENCES supervisor_overrides (override_id),
  CONSTRAINT ck_transactions_amounts CHECK (gross_amount >= 0 AND total_amount >= 0 AND amount_tendered >= total_amount AND change_amount >= 0),
  CONSTRAINT ck_transactions_sc_pwd CHECK (customer_type = 'regular' OR (sc_pwd_id_number IS NOT NULL AND sc_pwd_name IS NOT NULL)),
  CONSTRAINT ck_transactions_void CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_override_id IS NOT NULL AND void_reason IS NOT NULL)),
  INDEX ix_transactions_date (transaction_date),
  INDEX ix_transactions_session (session_id),
  INDEX ix_transactions_cashier_date (cashier_id, transaction_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- product_name and unit_price are copied at the time of sale so receipts never change.
CREATE TABLE transaction_items (
  transaction_item_id  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transaction_id       INT UNSIGNED NOT NULL,
  product_id           INT UNSIGNED NOT NULL,
  product_name         VARCHAR(120) NOT NULL,
  quantity             INT UNSIGNED NOT NULL,
  unit_price           DECIMAL(12,2) NOT NULL,
  discount_applied     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  vat_amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  is_vat_exempt        TINYINT(1)   NOT NULL DEFAULT 0,
  subtotal             DECIMAL(12,2) NOT NULL,
  quantity_refunded    INT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_items_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT ck_items_quantity CHECK (quantity > 0 AND quantity_refunded <= quantity),
  INDEX ix_items_product (product_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE refunds (
  refund_id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  refund_number    VARCHAR(20)  NOT NULL,
  transaction_id   INT UNSIGNED NOT NULL,
  session_id       INT UNSIGNED NULL,
  terminal_id      TINYINT UNSIGNED NOT NULL,
  processed_by     INT UNSIGNED NOT NULL,
  override_id      INT UNSIGNED NOT NULL,
  reason           VARCHAR(255) NOT NULL,
  refund_method    ENUM('cash', 'gcash', 'maya', 'card') NOT NULL,
  total_amount     DECIMAL(12,2) NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_refunds_number UNIQUE (refund_number),
  CONSTRAINT fk_refunds_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
  CONSTRAINT fk_refunds_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_refunds_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_refunds_processed_by FOREIGN KEY (processed_by) REFERENCES users (user_id),
  CONSTRAINT fk_refunds_override FOREIGN KEY (override_id) REFERENCES supervisor_overrides (override_id),
  CONSTRAINT ck_refunds_amount CHECK (total_amount > 0),
  INDEX ix_refunds_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE refund_items (
  refund_item_id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  refund_id            INT UNSIGNED NOT NULL,
  transaction_item_id  INT UNSIGNED NOT NULL,
  product_id           INT UNSIGNED NOT NULL,
  quantity             INT UNSIGNED NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,
  restocked            TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_refund_items_refund FOREIGN KEY (refund_id) REFERENCES refunds (refund_id),
  CONSTRAINT fk_refund_items_txn_item FOREIGN KEY (transaction_item_id) REFERENCES transaction_items (transaction_item_id),
  CONSTRAINT fk_refund_items_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT ck_refund_items_quantity CHECK (quantity > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Cash drawer movements per session (opening float is on sessions).
CREATE TABLE cash_movements (
  movement_id    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id     INT UNSIGNED NOT NULL,
  terminal_id    TINYINT UNSIGNED NOT NULL,
  movement_type  ENUM('cash_in', 'cash_out', 'drawer_open_no_sale', 'cash_count') NOT NULL,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  reason         VARCHAR(255) NOT NULL,
  override_id    INT UNSIGNED NULL,
  recorded_by    INT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cash_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_cash_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_cash_override FOREIGN KEY (override_id) REFERENCES supervisor_overrides (override_id),
  CONSTRAINT fk_cash_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (user_id),
  CONSTRAINT ck_cash_amount CHECK (amount >= 0),
  CONSTRAINT ck_cash_no_sale_override CHECK (movement_type <> 'drawer_open_no_sale' OR override_id IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- X-Reading (end of shift / session) and Z-Reading (end of day). Stored as snapshots so they can be reprinted.
CREATE TABLE readings (
  reading_id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reading_type                 ENUM('X', 'Z') NOT NULL,
  reading_number               INT UNSIGNED NOT NULL,
  terminal_id                  TINYINT UNSIGNED NOT NULL,
  session_id                   INT UNSIGNED NULL,
  business_date                DATE          NOT NULL,
  period_start                 DATETIME      NOT NULL,
  period_end                   DATETIME      NOT NULL,
  beginning_invoice            VARCHAR(20)   NULL,
  ending_invoice               VARCHAR(20)   NULL,
  transaction_count            INT UNSIGNED  NOT NULL DEFAULT 0,
  gross_sales                  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vatable_sales                DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount                   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_exempt_sales             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  zero_rated_sales             DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sc_discount                  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  pwd_discount                 DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  other_discount               DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  void_count                   INT UNSIGNED  NOT NULL DEFAULT 0,
  void_amount                  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  refund_count                 INT UNSIGNED  NOT NULL DEFAULT 0,
  refund_amount                DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  net_sales                    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cash_sales                   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  non_cash_sales               DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  opening_float                DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  expected_cash                DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  counted_cash                 DECIMAL(14,2) NULL,
  beginning_accumulated_sales  DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ending_accumulated_sales     DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  generated_by                 INT UNSIGNED  NOT NULL,
  generated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_readings_number UNIQUE (terminal_id, reading_type, reading_number),
  CONSTRAINT fk_readings_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_readings_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_readings_generated_by FOREIGN KEY (generated_by) REFERENCES users (user_id),
  CONSTRAINT ck_readings_period CHECK (period_end >= period_start),
  CONSTRAINT ck_readings_accumulated CHECK (ending_accumulated_sales >= beginning_accumulated_sales),
  CONSTRAINT ck_readings_x_session CHECK (reading_type = 'Z' OR session_id IS NOT NULL),
  INDEX ix_readings_date (business_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Waste and customer requests
-- ---------------------------------------------------------------------

CREATE TABLE waste_records (
  waste_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id    INT UNSIGNED NOT NULL,
  inventory_id  INT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  reason        ENUM('damaged', 'expired', 'spoiled', 'customer_return', 'other') NOT NULL,
  unit_cost     DECIMAL(12,2) NOT NULL,
  total_cost    DECIMAL(12,2) NOT NULL,
  notes         VARCHAR(255) NULL,
  recorded_by   INT UNSIGNED NOT NULL,
  session_id    INT UNSIGNED NULL,
  recorded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_waste_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT fk_waste_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (inventory_id),
  CONSTRAINT fk_waste_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (user_id),
  CONSTRAINT fk_waste_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT ck_waste_quantity CHECK (quantity > 0),
  CONSTRAINT ck_waste_other_notes CHECK (reason <> 'other' OR notes IS NOT NULL),
  INDEX ix_waste_time (recorded_at),
  INDEX ix_waste_product (product_id, recorded_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE customer_requests (
  request_id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_name_requested  VARCHAR(120) NOT NULL,
  product_id              INT UNSIGNED NULL,
  category_id             SMALLINT UNSIGNED NULL,
  quantity                INT UNSIGNED NULL,
  customer_name           VARCHAR(120) NULL,
  customer_contact        VARCHAR(40)  NULL,
  notes                   VARCHAR(255) NULL,
  status                  ENUM('pending', 'available', 'closed') NOT NULL DEFAULT 'pending',
  recorded_by             INT UNSIGNED NOT NULL,
  session_id              INT UNSIGNED NULL,
  request_date            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by              INT UNSIGNED NULL,
  CONSTRAINT fk_requests_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT fk_requests_category FOREIGN KEY (category_id) REFERENCES categories (category_id),
  CONSTRAINT fk_requests_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (user_id),
  CONSTRAINT fk_requests_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_requests_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id),
  INDEX ix_requests_status_date (status, request_date),
  INDEX ix_requests_name (product_name_requested)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Forecasting and purchasing
-- ---------------------------------------------------------------------

-- model_name stays free text until the forecasting algorithm is chosen.
CREATE TABLE demand_forecasts (
  forecast_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id       INT UNSIGNED NOT NULL,
  model_name       VARCHAR(40)  NOT NULL,
  model_version    VARCHAR(20)  NULL,
  is_fallback      TINYINT(1)   NOT NULL DEFAULT 0,
  period_type      ENUM('day', 'week') NOT NULL DEFAULT 'week',
  period_start     DATE         NOT NULL,
  period_end       DATE         NOT NULL,
  predicted_qty    DECIMAL(10,2) NOT NULL,
  lower_bound      DECIMAL(10,2) NULL,
  upper_bound      DECIMAL(10,2) NULL,
  backtest_mae     DECIMAL(10,4) NULL,
  backtest_mape    DECIMAL(10,4) NULL,
  features_used    JSON         NULL,
  generated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_forecasts_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT ck_forecasts_period CHECK (period_end >= period_start AND predicted_qty >= 0),
  INDEX ix_forecasts_product_period (product_id, period_start),
  INDEX ix_forecasts_generated (generated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Reorder recommendations awaiting the Owner's decision (advisory only).
CREATE TABLE reorder_lists (
  reorder_list_id  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  list_number      VARCHAR(20)  NOT NULL,
  source           ENUM('ai', 'fallback', 'manual') NOT NULL,
  status           ENUM('pending', 'approved', 'partially_approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_by       INT UNSIGNED NULL,
  created_date     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by      INT UNSIGNED NULL,
  approval_date    DATETIME     NULL,
  notes            VARCHAR(255) NULL,
  CONSTRAINT uq_reorder_lists_number UNIQUE (list_number),
  CONSTRAINT fk_reorder_lists_created_by FOREIGN KEY (created_by) REFERENCES users (user_id),
  CONSTRAINT fk_reorder_lists_approved_by FOREIGN KEY (approved_by) REFERENCES users (user_id),
  CONSTRAINT ck_reorder_lists_decision CHECK (status = 'pending' OR (approved_by IS NOT NULL AND approval_date IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE reorder_items (
  reorder_item_id  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reorder_list_id  INT UNSIGNED NOT NULL,
  product_id       INT UNSIGNED NOT NULL,
  forecast_id      INT UNSIGNED NULL,
  current_stock    INT          NOT NULL,
  suggested_qty    INT UNSIGNED NOT NULL,
  approved_qty     INT UNSIGNED NULL,
  decision         ENUM('pending', 'approved', 'modified', 'rejected') NOT NULL DEFAULT 'pending',
  basis            VARCHAR(255) NOT NULL,
  CONSTRAINT uq_reorder_items_product UNIQUE (reorder_list_id, product_id),
  CONSTRAINT fk_reorder_items_list FOREIGN KEY (reorder_list_id) REFERENCES reorder_lists (reorder_list_id),
  CONSTRAINT fk_reorder_items_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT fk_reorder_items_forecast FOREIGN KEY (forecast_id) REFERENCES demand_forecasts (forecast_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE purchase_orders (
  po_id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_number        VARCHAR(20)  NOT NULL,
  supplier_id      INT UNSIGNED NOT NULL,
  reorder_list_id  INT UNSIGNED NULL,
  status           ENUM('pending', 'partially_received', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  order_date       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_date    DATE         NULL,
  created_by       INT UNSIGNED NOT NULL,
  cancelled_by     INT UNSIGNED NULL,
  cancelled_at     DATETIME     NULL,
  notes            VARCHAR(255) NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_purchase_orders_number UNIQUE (po_number),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id),
  CONSTRAINT fk_po_reorder_list FOREIGN KEY (reorder_list_id) REFERENCES reorder_lists (reorder_list_id),
  CONSTRAINT fk_po_created_by FOREIGN KEY (created_by) REFERENCES users (user_id),
  CONSTRAINT fk_po_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (user_id),
  INDEX ix_po_status (status, order_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE purchase_order_items (
  po_item_id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_id              INT UNSIGNED NOT NULL,
  product_id         INT UNSIGNED NOT NULL,
  quantity_ordered   INT UNSIGNED NOT NULL,
  quantity_received  INT UNSIGNED NOT NULL DEFAULT 0,
  unit_cost          DECIMAL(12,2) NOT NULL,
  CONSTRAINT uq_po_items_product UNIQUE (po_id, product_id),
  CONSTRAINT fk_po_items_po FOREIGN KEY (po_id) REFERENCES purchase_orders (po_id),
  CONSTRAINT fk_po_items_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT ck_po_items_quantity CHECK (quantity_ordered > 0 AND quantity_received <= quantity_ordered)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Deliveries. A receiving may be tied to a purchase order or be a direct stock-in.
CREATE TABLE receivings (
  receiving_id   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  po_id          INT UNSIGNED NULL,
  supplier_id    INT UNSIGNED NULL,
  reference_no   VARCHAR(60)  NULL,
  received_by    INT UNSIGNED NOT NULL,
  received_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes          VARCHAR(255) NULL,
  CONSTRAINT fk_receivings_po FOREIGN KEY (po_id) REFERENCES purchase_orders (po_id),
  CONSTRAINT fk_receivings_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id),
  CONSTRAINT fk_receivings_received_by FOREIGN KEY (received_by) REFERENCES users (user_id),
  INDEX ix_receivings_time (received_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE receiving_items (
  receiving_item_id  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receiving_id       INT UNSIGNED NOT NULL,
  po_item_id         INT UNSIGNED NULL,
  product_id         INT UNSIGNED NOT NULL,
  inventory_id       INT UNSIGNED NOT NULL,
  quantity           INT UNSIGNED NOT NULL,
  unit_cost          DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_receiving_items_receiving FOREIGN KEY (receiving_id) REFERENCES receivings (receiving_id),
  CONSTRAINT fk_receiving_items_po_item FOREIGN KEY (po_item_id) REFERENCES purchase_order_items (po_item_id),
  CONSTRAINT fk_receiving_items_product FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT fk_receiving_items_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (inventory_id),
  CONSTRAINT ck_receiving_items_quantity CHECK (quantity > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Anomaly detection, audit, configuration
-- ---------------------------------------------------------------------

CREATE TABLE anomaly_flags (
  flag_id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  anomaly_type    ENUM('simultaneous_login', 'void_threshold', 'unusual_transaction', 'unusual_hours', 'other') NOT NULL,
  severity        ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
  detector        VARCHAR(40)  NOT NULL,
  score           DECIMAL(10,4) NULL,
  user_id         INT UNSIGNED NULL,
  session_id      INT UNSIGNED NULL,
  terminal_id     TINYINT UNSIGNED NULL,
  transaction_id  INT UNSIGNED NULL,
  details         JSON         NULL,
  status          ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
  detected_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by     INT UNSIGNED NULL,
  reviewed_at     DATETIME     NULL,
  CONSTRAINT fk_anomaly_user FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_anomaly_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_anomaly_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_anomaly_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
  CONSTRAINT fk_anomaly_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users (user_id),
  INDEX ix_anomaly_status_time (status, detected_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Append-only activity log. The app never updates or deletes rows here.
CREATE TABLE audit_logs (
  audit_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NULL,
  session_id   INT UNSIGNED NULL,
  terminal_id  TINYINT UNSIGNED NULL,
  action       VARCHAR(60)  NOT NULL,
  entity_type  VARCHAR(40)  NULL,
  entity_id    VARCHAR(40)  NULL,
  old_values   JSON         NULL,
  new_values   JSON         NULL,
  ip_address   VARCHAR(45)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_audit_session FOREIGN KEY (session_id) REFERENCES sessions (session_id),
  CONSTRAINT fk_audit_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  INDEX ix_audit_time (created_at),
  INDEX ix_audit_entity (entity_type, entity_id),
  INDEX ix_audit_user_time (user_id, created_at),
  INDEX ix_audit_action (action)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE hardware_config (
  config_id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  terminal_id      TINYINT UNSIGNED NOT NULL,
  config_type      ENUM('receipt_printer', 'barcode_scanner', 'cash_drawer') NOT NULL,
  connection_type  ENUM('usb', 'serial', 'hid', 'keyboard_wedge', 'printer_pulse') NOT NULL,
  settings         JSON         NOT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by       INT UNSIGNED NULL,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_hardware_terminal_type UNIQUE (terminal_id, config_type),
  CONSTRAINT fk_hardware_terminal FOREIGN KEY (terminal_id) REFERENCES terminals (terminal_id),
  CONSTRAINT fk_hardware_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  setting_id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setting_key    VARCHAR(60)  NOT NULL,
  setting_value  TEXT         NOT NULL,
  value_type     ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
  category       VARCHAR(30)  NOT NULL DEFAULT 'general',
  description    VARCHAR(255) NULL,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_settings_key UNIQUE (setting_key),
  CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Convenience view: current stock and nearest expiry per product.
CREATE VIEW v_product_stock AS
SELECT
  p.product_id,
  p.product_code,
  p.barcode,
  p.product_name,
  p.reorder_level,
  p.is_active,
  COALESCE(SUM(i.quantity_on_hand), 0) AS stock_on_hand,
  MIN(CASE WHEN i.quantity_on_hand > 0 THEN i.expiry_date END) AS nearest_expiry,
  COALESCE(SUM(i.quantity_on_hand), 0) <= p.reorder_level AS is_low_stock
FROM products p
LEFT JOIN inventory i ON i.product_id = p.product_id
GROUP BY p.product_id, p.product_code, p.barcode, p.product_name, p.reorder_level, p.is_active;
