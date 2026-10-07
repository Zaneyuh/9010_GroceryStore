# 9010 Grocery Store

An offline point-of-sale and store management system for a small grocery. One **server PC** holds the
database; **cashier PCs** connect to it over the store network. Includes sales, inventory, waste, customer
requests, reports, AI demand forecasting, and importing data from an old system.

Built with Electron, React, TypeScript, Node.js/Express, MySQL and a Python ML service.

> Not a PHP project: don't put it in XAMPP's `htdocs`. From XAMPP you only need **MySQL**.

## Start the app

You need **Node.js 20+** and **MySQL** (XAMPP is fine). Python 3.11/3.12 is only needed for the AI features.

1. **Start MySQL** (XAMPP Control Panel → MySQL → Start).
2. **Create `.env`**: copy `.env.example` to `.env` and set `DB_PASSWORD`.
3. **Create the database user**: put the same password in `database/create-db-user.sql`, then run
   ```
   C:\xampp\mysql\bin\mysql.exe -u root < database/create-db-user.sql
   ```
4. **Install and run**:
   ```
   npm install
   npm run db:init
   npm run electron:dev
   ```

## First sign-in

Choose **I am the owner** and sign in with username **`admin`** and PIN **`000000`**. You'll be taken to
**Settings → My account** to set your own name, username and PIN; after that, only your new details work.

Cashiers don't sign in: the owner assigns them to a register from **Admin Station**.

## Useful commands

| Command | What it does |
|---|---|
| `npm run electron:dev` | Run the desktop app (starts the server too) |
| `npm run db:reset` | Wipe the database and start over with `admin` / `000000` |
| `npm run ml:install` | Install the Python packages for AI forecasting |

**Something not working?** See the full guide: [docs/GUIDE.md](docs/GUIDE.md) (setup details, cashier
registers, importing data, troubleshooting, project structure).
