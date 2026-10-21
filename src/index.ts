/**
 * theroofinglist-mcp: a public, read-only, stateless MCP server over
 * Streamable HTTP at /mcp, plus a small REST API at /v1/*. No login.
 * Rate-limited per IP, or per RapidAPI user for RapidAPI traffic.
 *
 * Only the default handler is exported: workerd treats every named export
 * of the main module as an entrypoint.
 */
import { createApp, type Env } from './app'
import { serviceBindingDirectory } from './directory'

export default {
  async fetch(request, env, ctx) {
    if (!env.INTERNAL_API_TOKEN) {
      console.error('INTERNAL_API_TOKEN is not set')
      return new Response('Server not configured', { status: 503 })
    }
    const app = createApp({
      directory: serviceBindingDirectory(env.WEB, env.INTERNAL_API_TOKEN),
      limiter: env.RATE_LIMITER,
      siteUrl: env.SITE_URL,
      allowedHostnames: env.ALLOWED_HOSTNAMES?.split(',').map((h) => h.trim()).filter(Boolean),
      rapidApiProxySecret: env.RAPIDAPI_PROXY_SECRET,
    })
    return app(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
