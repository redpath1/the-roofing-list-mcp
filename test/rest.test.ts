import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { UpstreamError, type Directory } from '../src/directory'
import { publicContractor } from '../src/present'
import { clientKey } from '../src/ratelimit'
import { SERVER_VERSION } from '../src/server'
import { SITE, appFetch, connect, countingLimiter } from './helpers'

const BASE = 'http://localhost'
const get = (path: string, init?: RequestInit, opts?: Parameters<typeof appFetch>[0]) =>
  appFetch(opts)(`${BASE}${path}`, init)

const failing: Directory = {
  search: async () => {
    throw new UpstreamError('search: HTTP 500')
  },
  get: async () => {
    throw new UpstreamError('get: HTTP 500')
  },
}

function expectRestHeaders(res: Response) {
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
}

describe('GET /v1/contractors', () => {
  it('returns the same records as the MCP tool', async () => {
    const args = { trade: 'roofing', city: 'austin', state: 'texas' }
    const client = await connect()
    const mcp = (await client.callTool({ name: 'search_contractors', arguments: args })) as {
      structuredContent: { contractors: unknown[] }
    }
    await client.close()

    const res = await get(`/v1/contractors?${new URLSearchParams(args)}`)
    expect(res.status).toBe(200)
    expectRestHeaders(res)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const body = (await res.json()) as { contractors: { id: number }[] }
    expect(body.contractors.map((c) => c.id).sort()).toEqual([101, 102])
    expect(body).toEqual(mcp.structuredContent)
  })

  it('honours limit given as text', async () => {
    const res = await get('/v1/contractors?trade=roofing&city=Austin&state=TX&limit=1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { contractors: unknown[] }).contractors).toHaveLength(1)
  })

  it.each([
    ['trade=plumbing&city=Austin&state=TX', 'trade'],
    ['trade=roofing&state=TX', 'city'],
    ['trade=roofing&city=Austin', 'state'],
    ['trade=roofing&city=Austin&state=TX&limit=0', 'limit'],
    ['trade=roofing&city=Austin&state=TX&limit=26', 'limit'],
    ['trade=roofing&city=Austin&state=TX&limit=2.5', 'limit'],
    ['trade=roofing&city=Austin&state=TX&limit=ten', 'limit'],
  ])('returns 400 for %s', async (qs, field) => {
    const res = await get(`/v1/contractors?${qs}`)
    expect(res.status).toBe(400)
    expectRestHeaders(res)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain(field)
  })

  it('returns 400 for an unknown state, with the tool message', async () => {
    const res = await get('/v1/contractors?trade=roofing&city=Austin&state=Narnia')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Unknown US state "Narnia". Use a USPS code like "TX" or a name like "Texas".',
    })
  })

  it('returns 400 for a city with no letters or digits', async () => {
    const res = await get(`/v1/contractors?trade=roofing&city=${encodeURIComponent('!!!')}&state=TX`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '"!!!" is not a city name.' })
  })

  it('returns 503 when the web Worker fails', async () => {
    const res = await get('/v1/contractors?trade=roofing&city=Austin&state=TX', undefined, { directory: failing })
    expect(res.status).toBe(503)
    expectRestHeaders(res)
    expect(await res.json()).toEqual({ error: 'The directory is not available right now. Try again soon.' })
  })
})

describe('GET /v1/contractors/{id}', () => {
  it('returns one contractor, the same as the MCP tool', async () => {
    const client = await connect()
    const mcp = (await client.callTool({ name: 'get_contractor', arguments: { id: 101 } })) as {
      structuredContent: unknown
    }
    await client.close()

    const res = await get('/v1/contractors/101')
    expect(res.status).toBe(200)
    expectRestHeaders(res)
    const body = await res.json()
    expect(body).toEqual(mcp.structuredContent)
    expect(body).toMatchObject({
      id: 101,
      profileUrl: `${SITE}/roofers/texas/austin/lone-star-roofing`,
      rating: { value: 4.7, count: 12 },
    })
    expect(JSON.stringify(body)).not.toMatch(/google/i)
  })

  it.each([103, 104, 999])('returns 404 for id %i (closed, unlisted or missing)', async (id) => {
    const res = await get(`/v1/contractors/${id}`)
    expect(res.status).toBe(404)
    expectRestHeaders(res)
    expect(await res.json()).toEqual({ error: `No listed contractor with id ${id}.` })
  })

  it.each(['abc', '0', '-3', '1.5', '1e3'])('returns 400 for id %s', async (id) => {
    const res = await get(`/v1/contractors/${id}`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('id')
  })

  it('returns 503 when the web Worker fails', async () => {
    const res = await get('/v1/contractors/101', undefined, { directory: failing })
    expect(res.status).toBe(503)
  })
})

describe('methods and CORS', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('returns 405 for %s', async (method) => {
    const res = await get('/v1/contractors/101', { method })
    expect(res.status).toBe(405)
    expectRestHeaders(res)
    expect(res.headers.get('allow')).toBe('GET, OPTIONS')
  })

  it('answers a CORS preflight for GET', async () => {
    const res = await get('/v1/contractors', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'GET' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
  })

  it('returns a JSON 404 for an unknown /v1 path', async () => {
    const res = await get('/v1/nope')
    expect(res.status).toBe(404)
    expectRestHeaders(res)
  })

  it('mentions every entry point on the root page', async () => {
    const text = await (await get('/')).text()
    for (const s of ['/v1/contractors', '/openapi.json', '/mcp']) expect(text).toContain(s)
  })
})

describe('GET /openapi.json', () => {
  it('serves the OpenAPI document', async () => {
    const res = await get('/openapi.json')
    expect(res.status).toBe(200)
    expectRestHeaders(res)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const doc = (await res.json()) as any
    expect(doc.openapi).toMatch(/^3\.1\./)
    expect(doc.info.version).toBe(SERVER_VERSION)
    expect(doc.servers).toEqual([{ url: 'https://mcp.theroofinglist.com' }])
    expect(doc.components.securitySchemes).toBeUndefined()
    const ops = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId))
    expect(ops.sort()).toEqual(['getContractor', 'searchContractors'])
  })

  it('describes PublicContractor exactly as present.ts does', async () => {
    const doc = (await (await get('/openapi.json')).json()) as any
    // The OpenAPI file may add descriptions. Everything else must match the zod schema.
    const strip = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(strip)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v).filter(([k]) => k !== 'description' && k !== '$schema').map(([k, x]) => [k, strip(x)]),
            )
          : v
    const fromZod = z.toJSONSchema(publicContractor) as any
    expect(strip(doc.components.schemas.PublicContractor)).toEqual(strip(fromZod))
    // And the descriptions from present.ts are kept.
    expect(doc.components.schemas.PublicContractor.properties.website.description).toBe(fromZod.properties.website.description)
    expect(doc.components.schemas.PublicContractor.properties.rating.description).toBe(fromZod.properties.rating.description)
    expect(doc.components.schemas.PublicContractor.properties.rating.properties.value.description).toBe(
      fromZod.properties.rating.properties.value.description,
    )
  })

  it('shows error examples the API really returns', async () => {
    const doc = (await (await get('/openapi.json')).json()) as any
    const ex = (path: string, status: string) =>
      Object.values(doc.paths[path].get.responses[status].content['application/json'].examples).map((e: any) => e.value)
    const [unknownState, badLimit] = ex('/v1/contractors', '400')
    expect(await (await get('/v1/contractors?trade=roofing&city=Austin&state=Narnia')).json()).toEqual(unknownState)
    expect(await (await get('/v1/contractors?trade=roofing&city=Austin&state=TX&limit=26')).json()).toEqual(badLimit)
    expect(await (await get('/v1/contractors/abc')).json()).toEqual(ex('/v1/contractors/{id}', '400')[0])
    expect(await (await get('/v1/contractors/999')).json()).toEqual(ex('/v1/contractors/{id}', '404')[0])
  })

  it('is not rate-limited', async () => {
    const limiter = countingLimiter(0)
    const res = await get('/openapi.json', undefined, { limiter })
    expect(res.status).toBe(200)
    expect(limiter.keys).toEqual([])
  })
})

describe('REST rate limit', () => {
  const ip = (ip: string, headers: Record<string, string> = {}) => ({ headers: { 'cf-connecting-ip': ip, ...headers } })

  it('returns 429 with Retry-After and a JSON error', async () => {
    const limiter = countingLimiter(1)
    const fetch = appFetch({ limiter })
    const url = `${BASE}/v1/contractors/101`
    expect((await fetch(url, ip('203.0.113.7'))).status).toBe(200)
    const res = await fetch(url, ip('203.0.113.7'))
    expect(res.status).toBe(429)
    expectRestHeaders(res)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(await res.json()).toEqual({ error: 'Rate limit exceeded. Try again in a minute.' })
    expect(limiter.keys).toEqual(['rest:203.0.113.7', 'rest:203.0.113.7'])
  })

  it('counts each RapidAPI user on its own when the proxy secret is right', async () => {
    const limiter = countingLimiter(1)
    const fetch = appFetch({ limiter, rapidApiProxySecret: 'proxy-secret' })
    const url = `${BASE}/v1/contractors/101`
    const via = (user: string) => ip('198.51.100.9', { 'x-rapidapi-proxy-secret': 'proxy-secret', 'x-rapidapi-user': user })
    expect((await fetch(url, via('alice'))).status).toBe(200)
    expect((await fetch(url, via('bob'))).status).toBe(200)
    expect((await fetch(url, via('alice'))).status).toBe(429)
    expect(limiter.keys).toEqual(['rest:rapidapi:alice', 'rest:rapidapi:bob', 'rest:rapidapi:alice'])
  })
})

describe('clientKey', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/v1/contractors', { headers })
  const IP = { 'cf-connecting-ip': '203.0.113.7' }

  it('uses the IP when no secret is set', () => {
    expect(clientKey(req({ ...IP, 'x-rapidapi-proxy-secret': 's', 'x-rapidapi-user': 'alice' }))).toBe('203.0.113.7')
  })

  it('uses the RapidAPI user when the proxy secret is right', () => {
    expect(clientKey(req({ ...IP, 'x-rapidapi-proxy-secret': 's3cret', 'x-rapidapi-user': 'alice' }), 's3cret')).toBe(
      'rapidapi:alice',
    )
  })

  it('falls back to the IP when the user header is missing', () => {
    expect(clientKey(req({ ...IP, 'x-rapidapi-proxy-secret': 's3cret' }), 's3cret')).toBe('203.0.113.7')
  })

  it.each(['wrong!', 's3cre', 's3cret-and-more', ''])('uses the IP for a wrong secret (%j)', (sent) => {
    expect(clientKey(req({ ...IP, 'x-rapidapi-proxy-secret': sent, 'x-rapidapi-user': 'alice' }), 's3cret')).toBe(
      '203.0.113.7',
    )
  })

  it('uses the IP when the secret header is missing', () => {
    expect(clientKey(req({ ...IP, 'x-rapidapi-user': 'alice' }), 's3cret')).toBe('203.0.113.7')
  })

  it('applies to /mcp too, under the mcp prefix', async () => {
    const limiter = countingLimiter(5)
    const fetch = appFetch({ limiter, rapidApiProxySecret: 's3cret' })
    await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        ...IP,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-rapidapi-proxy-secret': 's3cret',
        'x-rapidapi-user': 'alice',
      },
      body: '{}',
    })
    expect(limiter.keys).toEqual(['mcp:rapidapi:alice'])
  })
})
