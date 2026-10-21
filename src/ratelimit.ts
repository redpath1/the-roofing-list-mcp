/**
 * Rate limit with the Workers rate limiting binding.
 * The binding counts per Cloudflare location and is eventually consistent,
 * so treat it as abuse protection, not exact accounting.
 *
 * The key is the caller's IP. RapidAPI sends all its traffic from its own
 * servers, so for RapidAPI the key is the RapidAPI user instead. We trust
 * the user header only when the request also carries our proxy secret.
 */

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export const RETRY_AFTER_SECONDS = 60

export const RAPIDAPI_SECRET_HEADER = 'x-rapidapi-proxy-secret'
export const RAPIDAPI_USER_HEADER = 'x-rapidapi-user'

const encoder = new TextEncoder()

/** Constant-time string compare. A length difference returns false. */
function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  // timingSafeEqual needs equal lengths. Compare x with itself so the time
  // does not depend on where the strings differ.
  if (x.byteLength !== y.byteLength) {
    crypto.subtle.timingSafeEqual(x, x)
    return false
  }
  return crypto.subtle.timingSafeEqual(x, y)
}

/** The caller's IP, or `rapidapi:<user>` for a request from the RapidAPI proxy. */
export function clientKey(request: Request, rapidApiProxySecret?: string): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!rapidApiProxySecret) return ip
  const sent = request.headers.get(RAPIDAPI_SECRET_HEADER)
  if (sent === null || !safeEqual(sent, rapidApiProxySecret)) return ip
  const user = request.headers.get(RAPIDAPI_USER_HEADER)?.trim()
  return user ? `rapidapi:${user}` : ip
}

/** True when the caller is over the limit. `prefix` keeps the MCP and REST budgets apart. */
export async function isLimited(
  limiter: Limiter,
  request: Request,
  prefix: 'mcp' | 'rest',
  rapidApiProxySecret?: string,
): Promise<boolean> {
  const { success } = await limiter.limit({ key: `${prefix}:${clientKey(request, rapidApiProxySecret)}` })
  return !success
}

/** For /mcp: returns a JSON-RPC 429 response when the caller is over the limit, otherwise null. */
export async function rateLimit(limiter: Limiter, request: Request, rapidApiProxySecret?: string): Promise<Response | null> {
  if (!(await isLimited(limiter, request, 'mcp', rapidApiProxySecret))) return null
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Rate limit exceeded. Try again in a minute.' },
    },
    { status: 429, headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } },
  )
}
