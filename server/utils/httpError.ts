/** Thrown by services and routes; the error middleware turns it into `{ error, details? }`. */
export class HttpError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details)
  }

  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, message)
  }

  static forbidden(message = 'Forbidden') {
    return new HttpError(403, message)
  }

  static notFound(message = 'Not found') {
    return new HttpError(404, message)
  }

  static conflict(message: string, details?: unknown) {
    return new HttpError(409, message, details)
  }
}
