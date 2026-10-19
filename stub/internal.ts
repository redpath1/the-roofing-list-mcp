/**
 * Stub of the internal read route that theroofinglist-web must add.
 * stub/worker.ts serves it under `pnpm dev`; tests import it directly.
 * See src/contract.ts for the contract.
 *
 * The stub is loose on purpose: it returns closed and unlisted rows, a free
 * profile with a website, and an extra Google field. The real route must
 * filter those out. Here they prove the MCP Worker filters them too.
 */
import { INTERNAL_TOKEN_HEADER, type InternalContractor } from '../src/contract'

type Row = InternalContractor & { googleRating?: number; googleReviewCount?: number }

export const FIXTURES: Row[] = [
  {
    id: 101,
    name: 'Lone Star Roofing',
    trades: ['roofing', 'gutters'],
    city: 'Austin',
    state: 'TX',
    phone: '+15125550101',
    tier: 'claimed',
    website: 'lonestarroofing.example.test',
    status: 'active',
    listed: true,
    path: '/roofers/texas/austin/lone-star-roofing',
    rating: { value: 4.7, count: 12 },
    googleRating: 4.9,
    googleReviewCount: 340,
  },
  {
    id: 102,
    name: 'Hill Country Roof & Gutter',
    trades: ['roofing'],
    city: 'Austin',
    state: 'TX',
    phone: '+15125550102',
    tier: 'free',
    website: 'https://hillcountry.example.test',
    status: 'active',
    listed: true,
    path: '/roofers/texas/austin/hill-country-roof-gutter',
    rating: null,
    googleRating: 4.2,
  },
  {
    id: 103,
    name: 'Closed Down Roofing',
    trades: ['roofing'],
    city: 'Austin',
    state: 'TX',
    phone: '+15125550103',
    tier: 'free',
    website: null,
    status: 'closed',
    listed: false,
    path: '/roofers/texas/austin/closed-down-roofing',
    rating: { value: 3.0, count: 2 },
  },
  {
    id: 104,
    name: 'Failed Check Roofing',
    trades: ['roofing'],
    city: 'Austin',
    state: 'TX',
    phone: null,
    tier: 'free',
    website: null,
    status: 'active',
    listed: false,
    path: '/roofers/texas/austin/failed-check-roofing',
    rating: null,
  },
  {
    id: 105,
    name: 'Capital Siding Co',
    trades: ['siding'],
    city: 'Austin',
    state: 'TX',
    phone: '+15125550105',
    tier: 'free',
    website: null,
    status: 'active',
    listed: true,
    path: '/siding-contractors/texas/austin/capital-siding-co',
    rating: null,
  },
  {
    id: 201,
    name: 'Bayou City Roofing',
    trades: ['roofing'],
    city: 'Houston',
    state: 'TX',
    phone: '+17135550201',
    tier: 'free',
    website: null,
    status: 'active',
    listed: true,
    path: '/roofers/texas/houston/bayou-city-roofing',
    rating: { value: 5, count: 1 },
  },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function handleInternal(request: Request, token: string): Response {
  if (request.headers.get(INTERNAL_TOKEN_HEADER) !== token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const base = '/internal/mcp/contractors'

  if (url.pathname === base) {
    const trade = url.searchParams.get('trade') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const city = url.searchParams.get('city') ?? ''
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 10) || 10, 25)
    const contractors = FIXTURES.filter(
      (r) => r.trades.includes(trade) && r.state === state && slug(r.city) === city,
    ).slice(0, limit + 5) // over-fetch, like a careless route might
    return Response.json({ contractors })
  }

  const m = url.pathname.match(/^\/internal\/mcp\/contractors\/(\d+)$/)
  if (m) {
    const row = FIXTURES.find((r) => r.id === Number(m[1]))
    return row ? Response.json({ contractor: row }) : Response.json({ error: 'not_found' }, { status: 404 })
  }

  return Response.json({ error: 'not_found' }, { status: 404 })
}
