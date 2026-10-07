import { Router } from 'express'
import { getHealth } from '../services/health.service.js'

export function healthRoutes(appVersion: string): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    const report = await getHealth(appVersion)
    res.status(report.status === 'ok' ? 200 : 503).json(report)
  })

  return router
}
