import cors from 'cors'
import express, { type Express } from 'express'
import type { ServerConfig } from './config.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { healthRoutes } from './routes/health.routes.js'

export function createApp(config: ServerConfig): Express {
  const app = express()

  app.disable('x-powered-by')
  // Terminals load the UI from disk (file://) or the Vite dev server, then call this API across the LAN.
  // Access is controlled by sessions and JWTs (Step 2), not by origin.
  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api/health', healthRoutes(config.appVersion))

  app.use('/api', notFoundHandler)
  app.use(errorHandler)
  return app
}
