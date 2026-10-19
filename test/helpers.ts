import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

import { createApp } from '../src/app'
import type { InternalContractor } from '../src/contract'
import { serviceBindingDirectory, type Directory } from '../src/directory'
import type { Limiter } from '../src/ratelimit'
import { handleInternal } from '../stub/internal'

export const SITE = 'https://theroofinglist.com'
export const TOKEN = 'test-token'

/** A WEB service binding backed by the stub route. */
export const stubWeb = (): Fetcher =>
  ({
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => handleInternal(new Request(input, init), TOKEN),
  }) as unknown as Fetcher

export const allowAll: Limiter = { limit: async () => ({ success: true }) }

/** A fixed-window limiter, like the binding: `max` calls per key, then denied. */
export function countingLimiter(max: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= max }
    },
  }
}

/** A directory that returns fixed rows, for leak tests that bypass the stub. */
export const fixedDirectory = (rows: InternalContractor[]): Directory => ({
  search: async () => rows,
  get: async (id) => rows.find((r) => r.id === id),
})

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext

export function appFetch(opts: { directory?: Directory; limiter?: Limiter } = {}) {
  const app = createApp({
    directory: opts.directory ?? serviceBindingDirectory(stubWeb(), TOKEN),
    limiter: opts.limiter ?? allowAll,
    siteUrl: SITE,
  })
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    // In-process requests have no Host header; a real HTTP request always does.
    const headers = new Headers(req.headers)
    if (!headers.has('host')) headers.set('host', new URL(req.url).host)
    return app(new Request(req, { headers }), {}, ctx)
  }
}

/** The official MCP client, talking Streamable HTTP to the app in-process. */
export async function connect(opts: Parameters<typeof appFetch>[0] = {}) {
  const fetch = appFetch(opts)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch }))
  return client
}

export const row = (over: Partial<InternalContractor> = {}): InternalContractor => ({
  id: 1,
  name: 'Test Roofing',
  trades: ['roofing'],
  city: 'Austin',
  state: 'TX',
  phone: '+15125550000',
  tier: 'free',
  website: null,
  status: 'active',
  listed: true,
  path: '/roofers/texas/austin/test-roofing',
  rating: null,
  ...over,
})
