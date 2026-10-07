-- Run once on the server PC as the MySQL root user, e.g.:
--   mysql -u root -p < server/database/create-db-user.sql
-- Change the password, then put the same values in .env (dev) or the setup screen (production).

CREATE DATABASE IF NOT EXISTS grocery9010 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'GroceryApp!'@'localhost' IDENTIFIED BY 'MyPassword123!';
GRANT ALL PRIVILEGES ON grocery9010.* TO 'GroceryApp!'@'localhost';
FLUSH PRIVILEGES;
