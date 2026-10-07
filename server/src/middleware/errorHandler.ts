import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../utils/httpError.js'

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
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
  let body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }

  if (err instanceof HttpError) {
    status = err.status
    body = { error: { code: err.code, message: err.message, details: err.details } }
  } else if (err instanceof ZodError) {
    status = 400
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are missing or invalid.',
        details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400
    body = { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } }
  }

  if (status >= 500) console.error('[server]', err)
  res.status(status).json(body)
}
