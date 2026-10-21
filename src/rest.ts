/**
 * The public REST API: GET only, JSON only, no key.
 *
 *   GET /v1/contractors?trade=roofing&city=Austin&state=TX&limit=10
 *     200 { "contractors": PublicContractor[] }
 *   GET /v1/contractors/{id}
 *     200 PublicContractor
 *   GET /openapi.json
 *     200 the OpenAPI 3.1 document (src/openapi.ts)
 *
 * Errors are { "error": "..." } with 400, 404, 405, 429 or 503.
 * The lookups are the same ones the MCP tools call (src/lookup.ts).
 */
import { formatIssues, getContractor, getInput, searchContractors, searchInput, type LookupDeps, type LookupError } from './lookup'
import { openapi } from './openapi'
import { isLimited, RETRY_AFTER_SECONDS, type Limiter } from './ratelimit'

export const REST_PREFIX = '/v1/'
export const OPENAPI_ROUTE = '/openapi.json'
const SEARCH_ROUTE = '/v1/contractors'

export type RestDeps = LookupDeps & { limiter: Limiter; rapidApiProxySecret?: string }

const CORS = {
  'access-control-allow-origin': '*',
}

const PREFLIGHT = {
  ...CORS,
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
}

const CACHE_5_MIN = 'public, max-age=300'
const CACHE_1_HOUR = 'public, max-age=3600'
// A 429 or 503 is short-lived. Do not let a cache keep it for 5 minutes.
const NO_STORE = 'no-store'

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 429 || status === 503 ? NO_STORE : CACHE_5_MIN,
      ...CORS,
      ...extra,
    },
  })
}

const errorJson = (status: number, error: string, extra?: Record<string, string>) => json({ error }, status, extra)

const STATUS: Record<LookupError['kind'], number> = { invalid: 400, not_found: 404, upstream: 503 }
const lookupError = (e: LookupError) => errorJson(STATUS[e.kind], e.message)

/** True for the paths this module owns. */
export function isRestPath(pathname: string): boolean {
  return pathname === OPENAPI_ROUTE || pathname.startsWith(REST_PREFIX)
}

/**
 * Query strings carry text. Turn a number-like limit into a number so
 * searchInput can check it. Anything else goes through as text, and zod
 * rejects it with its usual message.
 */
const NUMBER_LIKE = /^-?\d+(\.\d+)?$/
const toNumber = (s: string): number | string => (NUMBER_LIKE.test(s) ? Number(s) : s)

async function search(deps: RestDeps, url: URL): Promise<Response> {
  const q = url.searchParams
  const raw: Record<string, unknown> = {}
  for (const key of ['trade', 'city', 'state'] as const) {
    const v = q.get(key)
    if (v !== null) raw[key] = v
  }
  const limit = q.get('limit')
  if (limit !== null) raw.limit = toNumber(limit)

  const parsed = searchInput.safeParse(raw)
  if (!parsed.success) return errorJson(400, `Invalid input: ${formatIssues(parsed.error)}`)

  const result = await searchContractors(deps, parsed.data)
  if (!result.ok) return lookupError(result)
  return json({ contractors: result.value })
}

async function get(deps: RestDeps, idText: string): Promise<Response> {
  const parsed = getInput.safeParse({ id: toNumber(idText) })
  if (!parsed.success) return errorJson(400, `Invalid input: ${formatIssues(parsed.error)}`)

  const result = await getContractor(deps, parsed.data.id)
  if (!result.ok) return lookupError(result)
  return json(result.value)
}

/** Handles /v1/* and /openapi.json. Call only when isRestPath() is true. */
export async function handleRest(deps: RestDeps, request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PREFLIGHT })
  if (request.method !== 'GET') {
    return errorJson(405, 'Method not allowed. Use GET.', { allow: 'GET, OPTIONS' })
  }

  if (url.pathname === OPENAPI_ROUTE) return json(openapi, 200, { 'cache-control': CACHE_1_HOUR })

  if (await isLimited(deps.limiter, request, 'rest', deps.rapidApiProxySecret)) {
    return errorJson(429, 'Rate limit exceeded. Try again in a minute.', {
      'retry-after': String(RETRY_AFTER_SECONDS),
    })
  }

  if (url.pathname === SEARCH_ROUTE) return search(deps, url)

  const match = /^\/v1\/contractors\/([^/]+)$/.exec(url.pathname)
  if (match?.[1]) return get(deps, match[1])

  return errorJson(404, 'Not found. See /openapi.json for the routes.')
}
