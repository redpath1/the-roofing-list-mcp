/**
 * Per-IP rate limit with the Workers rate limiting binding.
 * The binding counts per Cloudflare location and is eventually consistent,
 * so treat it as abuse protection, not exact accounting.
 */

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export const RETRY_AFTER_SECONDS = 60

export function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export async function rateLimit(limiter: Limiter, request: Request): Promise<Response | null> {
  const { success } = await limiter.limit({ key: `mcp:${clientKey(request)}` })
  if (success) return null
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Rate limit exceeded. Try again in a minute.' },
    },
    { status: 429, headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } },
  )
}
