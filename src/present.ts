/**
 * The public shape of a contractor, and the rules for what may leave this
 * Worker. Every tool result goes through toPublic().
 *
 * - Only listed, open businesses. Anything else returns null.
 * - Website only for a Claimed Profile. Free profiles never carry one.
 * - Rating and count come from our published reviews only (the route's
 *   `rating`). Nothing from Google is in the contract, and the allowlist
 *   below drops any extra field the route might add.
 */
import { z } from 'zod'

import { TRADES, type InternalContractor } from './contract'

export const publicContractor = z.object({
  id: z.number().int(),
  name: z.string(),
  trades: z.array(z.enum(TRADES)),
  city: z.string(),
  state: z.string(),
  phone: z.string().nullable(),
  profileUrl: z.string(),
  claimed: z.boolean(),
  website: z.string().optional().describe('Only present for claimed profiles.'),
  rating: z
    .object({
      value: z.number().describe('Average of published reviews on The Roofing List, 1 to 5.'),
      count: z.number().int(),
    })
    .optional()
    .describe('From reviews published on The Roofing List only. Absent when there are none.'),
})
export type PublicContractor = z.infer<typeof publicContractor>

const isTrade = (t: string): t is (typeof TRADES)[number] => (TRADES as readonly string[]).includes(t)

export function toPublic(c: InternalContractor, siteUrl: string): PublicContractor | null {
  if (!c.listed || c.status !== 'active') return null

  const out: PublicContractor = {
    id: c.id,
    name: c.name,
    trades: c.trades.filter(isTrade),
    city: c.city,
    state: c.state,
    phone: c.phone,
    profileUrl: `${siteUrl.replace(/\/+$/, '')}${c.path}`,
    claimed: c.tier === 'claimed',
  }

  const website = c.website?.trim()
  if (c.tier === 'claimed' && website) {
    out.website = /^https?:\/\//i.test(website) ? website : `https://${website}`
  }

  if (c.rating && c.rating.count > 0) {
    out.rating = { value: c.rating.value, count: c.rating.count }
  }

  return out
}
