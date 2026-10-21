/**
 * The request pipeline. /v1/* and /openapi.json go to the REST routes
 * (src/rest.ts). /mcp gets a rate limit, then the stateless MCP handler.
 * Dependencies come in so tests can swap them.
 */
import { createMcpHandler } from 'agents/mcp/server'

import type { Directory } from './directory'
import { rateLimit, type Limiter } from './ratelimit'
import { handleRest, isRestPath } from './rest'
import { createServer } from './server'

export interface Env {
  WEB: Fetcher
  RATE_LIMITER: Limiter
  SITE_URL: string
  /** Shared with theroofinglist-web. A secret in production; .dev.vars locally. */
  INTERNAL_API_TOKEN?: string
  /** Optional comma-separated Host allowlist, for example "mcp.theroofinglist.com". */
  ALLOWED_HOSTNAMES?: string
  /**
   * Optional. The proxy secret from the RapidAPI provider dashboard. Set it
   * with `wrangler secret put RAPIDAPI_PROXY_SECRET`. When a request carries
   * it in `x-rapidapi-proxy-secret`, the rate limit counts per RapidAPI user
   * (`x-rapidapi-user`) instead of per IP.
   */
  RAPIDAPI_PROXY_SECRET?: string
}

export const MCP_ROUTE = '/mcp'

export type AppDeps = {
  directory: Directory
  limiter: Limiter
  siteUrl: string
  allowedHostnames?: string[]
  rapidApiProxySecret?: string
}

const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

const ROOT_TEXT = [
  'The Roofing List API. Read-only and free. No key needed.',
  '',
  'REST:    GET /v1/contractors?trade=roofing&city=Austin&state=TX',
  '         GET /v1/contractors/{id}',
  'OpenAPI: /openapi.json',
  'MCP:     connect an MCP client to /mcp',
  '',
].join('\n')

/** The request pipeline, with its dependencies passed in so tests can swap them. */
export function createApp(deps: AppDeps) {
  const handler = createMcpHandler(
    () => createServer({ directory: deps.directory, siteUrl: deps.siteUrl }),
    { route: MCP_ROUTE, ...(deps.allowedHostnames ? { allowedHostnames: deps.allowedHostnames } : {}) },
  )

  return async (request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD') && wantsHtml(request)) {
      // A browser at the subdomain root goes to the about page on the main domain.
      // API clients (curl, RapidAPI) still get the plain-text entry points below.
      return Response.redirect(`${deps.siteUrl.replace(/\/+$/, '')}/mcp/`, 301)
    }
    if (isRestPath(url.pathname)) return handleRest(deps, request)
    if (url.pathname !== MCP_ROUTE) {
      return new Response(ROOT_TEXT, {
        status: url.pathname === '/' ? 200 : 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    if (request.method !== 'OPTIONS') {
      const limited = await rateLimit(deps.limiter, request, deps.rapidApiProxySecret)
      if (limited) return limited
    }
    return handler(request, env, ctx)
  }
}
