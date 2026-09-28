# 9010 Grocery Store — POS

Electron + React + TypeScript + Vite + Tailwind CSS.

## Setup
```
npm install
```

## Run in dev (browser only, fastest feedback loop)
```
npm run dev
```
Opens at http://localhost:5173

## Run in dev (inside the Electron window)
```
npm run electron:dev
```
This starts the Vite dev server and opens the Electron window pointed at it, with hot reload.

## Build a production desktop app
```
npm run electron:build
```
Outputs installers to /release.

## Project structure
- `src/components/` — screen components (CashierMainMenu.tsx, more to come)
- `src/App.tsx` — currently renders CashierMainMenu directly; swap this for a router as more screens are added
- `main.js` — Electron's entry point (creates the app window)
