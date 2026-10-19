/**
 * The contract between this Worker and the internal read route on
 * theroofinglist-web. The web Worker owns the data and reads it through
 * Payload. This Worker only calls the route over the WEB service binding.
 *
 *   GET /internal/mcp/contractors?trade=roofing&state=TX&city=austin&limit=10
 *     200 { "contractors": InternalContractor[] }
 *   GET /internal/mcp/contractors/:id
 *     200 { "contractor": InternalContractor }
 *     404 { "error": "not_found" }
 *
 * Every request carries the header `x-internal-token`. The web Worker must
 * reject a request without the right token with 401.
 *
 * The route should return listed, open businesses only. This Worker checks
 * `listed` and `status` again and drops the website for free profiles, so a
 * bug on one side cannot leak a closed business or a free website link.
 */
import { z } from 'zod'

export const TRADES = ['roofing', 'siding', 'gutters'] as const
export type Trade = (typeof TRADES)[number]

export const INTERNAL_BASE = 'https://theroofinglist-web.internal/internal/mcp'
export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

export const internalContractor = z.object({
  /** Businesses.id */
  id: z.number().int().positive(),
  name: z.string(),
  /** Trades collection slugs, in TRADE_PATHS order. */
  trades: z.array(z.string()),
  /** The main location's city name, for example "Austin". */
  city: z.string(),
  /** The main location's USPS state code, for example "TX". */
  state: z.string(),
  /** E.164, or null. */
  phone: z.string().nullable(),
  tier: z.enum(['free', 'claimed']),
  /** Businesses.website as stored, or null. */
  website: z.string().nullable(),
  status: z.enum(['active', 'closed']),
  listed: z.boolean(),
  /** The canonical profile path from profilePath(), for example "/roofers/texas/austin/acme-roofing". */
  path: z.string().startsWith('/'),
  /** From published reviews only (getRatings). Null when there are none. */
  rating: z.object({ value: z.number(), count: z.number().int().nonnegative() }).nullable(),
})
export type InternalContractor = z.infer<typeof internalContractor>

export const searchResponse = z.object({ contractors: z.array(internalContractor) })
export const getResponse = z.object({ contractor: internalContractor })
