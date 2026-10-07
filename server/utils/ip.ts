import type { Request } from 'express'

/** Client IP without the IPv6 prefix Node adds to IPv4 addresses (::ffff:192.168.1.12 → 192.168.1.12). */
export function clientIp(req: Request): string | null {
  const ip = req.ip ?? req.socket.remoteAddress ?? null
  return ip?.startsWith('::ffff:') ? ip.slice(7) : ip
}
