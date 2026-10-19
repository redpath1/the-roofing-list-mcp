import { describe, expect, it } from 'vitest'

import { toPublic } from '../src/present'
import { slugify, toStateCode } from '../src/places'
import { SITE, connect, fixedDirectory, row } from './helpers'

type Result = { isError?: boolean; structuredContent?: any; content: { type: string; text?: string }[] }
const call = async (name: string, args: Record<string, unknown>, opts?: Parameters<typeof connect>[0]) => {
  const client = await connect(opts)
  try {
    return (await client.callTool({ name, arguments: args })) as Result
  } finally {
    await client.close()
  }
}

describe('tool list', () => {
  it('lists exactly the two read-only tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    await client.close()
    expect(tools.map((t) => t.name).sort()).toEqual(['get_contractor', 'search_contractors'])
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true)
    const search = tools.find((t) => t.name === 'search_contractors')!
    expect(search.inputSchema.required?.sort()).toEqual(['city', 'state', 'trade'])
  })
})

describe('input validation', () => {
  it.each([
    [{ trade: 'plumbing', city: 'Austin', state: 'TX' }, 'trade'],
    [{ trade: 'roofing', city: '', state: 'TX' }, 'city'],
    [{ trade: 'roofing', city: 'Austin' }, 'state'],
    [{ trade: 'roofing', city: 'Austin', state: 'TX', limit: 0 }, 'limit'],
    [{ trade: 'roofing', city: 'Austin', state: 'TX', limit: 26 }, 'limit'],
    [{ trade: 'roofing', city: 'Austin', state: 'TX', limit: 2.5 }, 'limit'],
    [{ trade: 'roofing', city: 'x'.repeat(81), state: 'TX' }, 'city'],
  ])('search_contractors rejects %j', async (args, field) => {
    const res = await call('search_contractors', args)
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain(field)
  })

  it('search_contractors rejects an unknown state', async () => {
    const res = await call('search_contractors', { trade: 'roofing', city: 'Austin', state: 'Narnia' })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('Unknown US state')
  })

  it('search_contractors rejects a city with no letters or digits', async () => {
    const res = await call('search_contractors', { trade: 'roofing', city: '!!!', state: 'TX' })
    expect(res.isError).toBe(true)
  })

  it.each([{ id: 'abc' }, { id: 0 }, { id: -3 }, { id: 1.5 }, {}])('get_contractor rejects %j', async (args) => {
    const res = await call('get_contractor', args)
    expect(res.isError).toBe(true)
  })

  it('accepts state names and codes in any case', () => {
    expect(toStateCode('tx')).toBe('TX')
    expect(toStateCode(' Texas ')).toBe('TX')
    expect(toStateCode('new  york')).toBe('NY')
    expect(toStateCode('District of Columbia')).toBe('DC')
    expect(toStateCode('XX')).toBeUndefined()
  })

  it('slugs cities the way the app importer does', () => {
    expect(slugify('San Antonio')).toBe('san-antonio')
    expect(slugify('Coeur d’Alène')).toBe('coeur-d-alene')
    expect(slugify('St. Louis')).toBe('st-louis')
  })
})

describe('search against the stub route', () => {
  it('returns listed, open businesses in the trade and city only', async () => {
    const res = await call('search_contractors', { trade: 'roofing', city: 'austin', state: 'texas' })
    expect(res.isError).toBeFalsy()
    const ids = res.structuredContent.contractors.map((c: { id: number }) => c.id).sort()
    expect(ids).toEqual([101, 102]) // not 103 (closed), 104 (unlisted), 105 (siding), 201 (Houston)
  })

  it('honours limit', async () => {
    const res = await call('search_contractors', { trade: 'roofing', city: 'Austin', state: 'TX', limit: 1 })
    expect(res.structuredContent.contractors).toHaveLength(1)
  })

  it('returns an empty list for a city with no matches', async () => {
    const res = await call('search_contractors', { trade: 'gutters', city: 'Houston', state: 'TX' })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent.contractors).toEqual([])
  })
})

describe('field filtering', () => {
  it('gives a website only to a claimed profile', async () => {
    const res = await call('search_contractors', { trade: 'roofing', city: 'Austin', state: 'TX' })
    const byId = Object.fromEntries(res.structuredContent.contractors.map((c: any) => [c.id, c]))
    expect(byId[101].website).toBe('https://lonestarroofing.example.test')
    expect(byId[102]).not.toHaveProperty('website') // free, even though the route sent one
    expect(res.content[0]?.text).not.toContain('hillcountry.example.test')
  })

  it('never passes through Google fields', async () => {
    const res = await call('get_contractor', { id: 101 })
    const text = JSON.stringify(res)
    expect(text).not.toMatch(/google/i)
    expect(text).not.toContain('340')
    expect(res.structuredContent.rating).toEqual({ value: 4.7, count: 12 })
  })

  it('omits rating when there are no published reviews', async () => {
    const res = await call('get_contractor', { id: 102 })
    expect(res.structuredContent).not.toHaveProperty('rating')
  })

  it('builds the profile URL on theroofinglist.com', async () => {
    const res = await call('get_contractor', { id: 101 })
    expect(res.structuredContent.profileUrl).toBe(`${SITE}/roofers/texas/austin/lone-star-roofing`)
  })

  it.each([
    [103, 'closed'],
    [104, 'unlisted'],
    [999, 'missing'],
  ])('get_contractor(%i) returns nothing for a %s business', async (id) => {
    const res = await call('get_contractor', { id })
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toBeUndefined()
    expect(res.content[0]?.text).toBe(`No listed contractor with id ${id}.`)
  })

  it('drops closed and unlisted rows even when the route sends them', async () => {
    const directory = fixedDirectory([
      row({ id: 1 }),
      row({ id: 2, status: 'closed', listed: true }),
      row({ id: 3, listed: false }),
      row({ id: 4, tier: 'free', website: 'https://free.example.test' }),
      row({ id: 5, trades: ['siding'] }),
    ])
    const res = await call('search_contractors', { trade: 'roofing', city: 'Austin', state: 'TX' }, { directory })
    const out = res.structuredContent.contractors
    expect(out.map((c: any) => c.id)).toEqual([1, 4])
    expect(out[1]).not.toHaveProperty('website')
  })

  it('get_contractor refuses a closed row even when the route sends it', async () => {
    const directory = fixedDirectory([row({ id: 7, status: 'closed', listed: true }), row({ id: 8 })])
    expect((await call('get_contractor', { id: 7 }, { directory })).isError).toBe(true)
    expect((await call('get_contractor', { id: 8 }, { directory })).structuredContent.id).toBe(8)
  })

  it('toPublic keeps only allowlisted fields', () => {
    const leaky = { ...row({ tier: 'claimed', website: 'acme.example.test' }), googleRating: 5, email: 'x@y.z' }
    expect(Object.keys(toPublic(leaky, SITE)!).sort()).toEqual(
      ['city', 'claimed', 'id', 'name', 'phone', 'profileUrl', 'state', 'trades', 'website'].sort(),
    )
  })

  it('shows a generic error when the web Worker fails', async () => {
    const directory = {
      search: async () => {
        const { UpstreamError } = await import('../src/directory')
        throw new UpstreamError('search: HTTP 500')
      },
      get: async () => undefined,
    }
    const res = await call('search_contractors', { trade: 'roofing', city: 'Austin', state: 'TX' }, { directory })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('not available')
  })
})
