import { describe, expect, it } from 'vitest'

import { INTERNAL_TOKEN_HEADER } from '../src/contract'
import { serviceBindingDirectory } from '../src/directory'
import { appFetch, connect, countingLimiter, SITE, stubWeb } from './helpers'

const post = (body = '{}', ip = '203.0.113.7') =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'cf-connecting-ip': ip,
    },
    body,
  })

describe('rate limit', () => {
  it('returns 429 with Retry-After once an IP is over the limit', async () => {
    const limiter = countingLimiter(3)
    const fetch = appFetch({ limiter })
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await fetch(post())).status)
    expect(statuses.slice(0, 3)).not.toContain(429)
    expect(statuses.slice(3)).toEqual([429, 429])

    const res = await fetch(post())
    expect(res.headers.get('retry-after')).toBe('60')
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } })
  })

  it('counts each IP on its own', async () => {
    const limiter = countingLimiter(1)
    const fetch = appFetch({ limiter })
    expect((await fetch(post('{}', '198.51.100.1'))).status).not.toBe(429)
    expect((await fetch(post('{}', '198.51.100.1'))).status).toBe(429)
    expect((await fetch(post('{}', '198.51.100.2'))).status).not.toBe(429)
    expect(limiter.keys).toEqual(['mcp:198.51.100.1', 'mcp:198.51.100.1', 'mcp:198.51.100.2'])
  })

  it('blocks a real MCP client once the limit is hit', async () => {
    const limiter = countingLimiter(3)
    const client = await connect({ limiter }).catch((e) => e)
    // Connecting uses some of the budget; keep calling until the limit bites.
    let error: unknown
    for (let i = 0; i < 5 && !error; i++) {
      try {
        if (client instanceof Error) throw client
        await client.listTools()
      } catch (e) {
        error = e
      }
    }
    expect(String(error)).toMatch(/429|Rate limit/)
  })

  it('does not count CORS preflight or other paths', async () => {
    const limiter = countingLimiter(0)
    const fetch = appFetch({ limiter })
    const pre = await fetch(
      new Request('http://localhost/mcp', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST' },
      }),
    )
    expect(pre.status).not.toBe(429)
    expect((await fetch('http://localhost/')).status).toBe(301)
    expect((await fetch('http://localhost/nope')).status).toBe(404)
    expect(limiter.keys).toEqual([])
  })
})

describe('root path', () => {
  it('sends GET and HEAD on / to the about page on the main domain with a 301', async () => {
    const fetch = appFetch()
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(new Request('http://localhost/', { method, redirect: 'manual' }))
      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe(`${SITE}/mcp/`)
    }
  })

  it('keeps the plain-text answer for other methods on /, and 404 elsewhere', async () => {
    const fetch = appFetch()
    expect((await fetch(new Request('http://localhost/', { method: 'POST' }))).status).toBe(200)
    expect((await fetch('http://localhost/mcp/')).status).toBe(404)
  })
})

describe('service binding client', () => {
  it('sends the internal token', async () => {
    const seen: string[] = []
    const web = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        seen.push(`${new URL(req.url).pathname}${new URL(req.url).search} ${req.headers.get(INTERNAL_TOKEN_HEADER)}`)
        return stubWeb().fetch(req)
      },
    } as unknown as Fetcher
    await serviceBindingDirectory(web, 'test-token').search({ trade: 'roofing', state: 'TX', city: 'austin', limit: 10 })
    expect(seen).toEqual(['/internal/mcp/contractors?trade=roofing&state=TX&city=austin&limit=10 test-token'])
  })

  it('fails on a wrong token instead of returning data', async () => {
    await expect(
      serviceBindingDirectory(stubWeb(), 'wrong').search({ trade: 'roofing', state: 'TX', city: 'austin', limit: 10 }),
    ).rejects.toThrow('HTTP 401')
  })
})
