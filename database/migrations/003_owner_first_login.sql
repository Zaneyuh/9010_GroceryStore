-- =====================================================
-- Schema version 3: the owner account starts as a default admin (username "admin", PIN 000000)
-- that must be personalised on first sign-in. The server creates that account on start-up when no
-- owner exists (server/config/dbInit.ts), with this flag set; it blocks everything else until the
-- owner has chosen their own username, name and PIN.
-- =====================================================

ALTER TABLE users
  ADD COLUMN must_change_credentials BOOLEAN NOT NULL DEFAULT FALSE AFTER pin_hash;
