import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../utils/httpError.js'

/** Every error response uses this shape. */
export interface ErrorBody {
  error: string
  details?: unknown
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`No route for ${req.method} ${req.originalUrl}`))
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }

  let status = 500
  let body: ErrorBody = { error: 'Something went wrong on the server' }

  if (err instanceof HttpError) {
    status = err.status
    body = err.details === undefined ? { error: err.message } : { error: err.message, details: err.details }
  } else if (err instanceof ZodError) {
    status = 400
    body = {
      error: 'Validation failed',
      details: err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400
    body = { error: 'Request body is not valid JSON' }
  }

  if (status >= 500) console.error('[api]', err)
  res.status(status).json(body)
}
