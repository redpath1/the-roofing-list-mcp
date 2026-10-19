/**
 * The request pipeline: route check, per-IP rate limit, then the stateless
 * MCP handler. Dependencies come in so tests can swap them.
 */
import { createMcpHandler } from 'agents/mcp/server'

import type { Directory } from './directory'
import { rateLimit, type Limiter } from './ratelimit'
import { createServer } from './server'

export interface Env {
  WEB: Fetcher
  RATE_LIMITER: Limiter
  SITE_URL: string
  /** Shared with theroofinglist-web. A secret in production; .dev.vars locally. */
  INTERNAL_API_TOKEN?: string
  /** Optional comma-separated Host allowlist, for example "mcp.theroofinglist.com". */
  ALLOWED_HOSTNAMES?: string
}

export const MCP_ROUTE = '/mcp'

export type AppDeps = { directory: Directory; limiter: Limiter; siteUrl: string; allowedHostnames?: string[] }

/** The request pipeline, with its dependencies passed in so tests can swap them. */
export function createApp(deps: AppDeps) {
  const handler = createMcpHandler(
    () => createServer({ directory: deps.directory, siteUrl: deps.siteUrl }),
    { route: MCP_ROUTE, ...(deps.allowedHostnames ? { allowedHostnames: deps.allowedHostnames } : {}) },
  )

  return async (request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      // The subdomain root sends people to the about page on the main domain.
      return Response.redirect(`${deps.siteUrl.replace(/\/+$/, '')}/mcp/`, 301)
    }
    if (url.pathname !== MCP_ROUTE) {
      return new Response('The Roofing List MCP server. Connect an MCP client to /mcp.\n', {
        status: url.pathname === '/' ? 200 : 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    if (request.method !== 'OPTIONS') {
      const limited = await rateLimit(deps.limiter, request)
      if (limited) return limited
    }
    return handler(request, env, ctx)
  }
}
