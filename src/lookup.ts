/**
 * The two lookups: search and get. The MCP tools (src/server.ts) and the
 * REST routes (src/rest.ts) both call these, so both return the same
 * records. Every record goes through toPublic().
 */
import { z } from 'zod'

import { TRADES } from './contract'
import { UpstreamError, type Directory } from './directory'
import { slugify, toStateCode } from './places'
import { toPublic, type PublicContractor } from './present'

export const MAX_LIMIT = 25
export const DEFAULT_LIMIT = 10

export const searchInput = z.object({
  trade: z.enum(TRADES).describe('The trade: roofing, siding or gutters.'),
  city: z.string().trim().min(1).max(80).describe('US city name, for example "Austin".'),
  state: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .describe('US state as a USPS code ("TX") or a full name ("Texas").'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many results, 1 to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`),
})
export type SearchInput = z.infer<typeof searchInput>

export const getInput = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe('The contractor id from search_contractors.'),
})

export type LookupDeps = { directory: Directory; siteUrl: string }

/** Why a lookup gave no data. The caller turns it into a tool error or an HTTP status. */
export type LookupError = { kind: 'invalid' | 'not_found' | 'upstream'; message: string }
export type Lookup<T> = { ok: true; value: T } | ({ ok: false } & LookupError)

export const UPSTREAM_MESSAGE = 'The directory is not available right now. Try again soon.'

const fail = (kind: LookupError['kind'], message: string) => ({ ok: false as const, kind, message })

const upstreamFailure = (err: unknown) => {
  if (!(err instanceof UpstreamError)) throw err
  console.error('upstream', err.message)
  return fail('upstream', UPSTREAM_MESSAGE)
}

/** Input must already match searchInput. */
export async function searchContractors(
  { directory, siteUrl }: LookupDeps,
  { trade, city, state, limit }: SearchInput,
): Promise<Lookup<PublicContractor[]>> {
  const code = toStateCode(state)
  if (!code) return fail('invalid', `Unknown US state "${state}". Use a USPS code like "TX" or a name like "Texas".`)
  const citySlug = slugify(city)
  if (!citySlug) return fail('invalid', `"${city}" is not a city name.`)
  const max = limit ?? DEFAULT_LIMIT

  let rows
  try {
    rows = await directory.search({ trade, state: code, city: citySlug, limit: max })
  } catch (err) {
    return upstreamFailure(err)
  }

  const contractors = rows
    .filter((r) => r.trades.includes(trade))
    .map((r) => toPublic(r, siteUrl))
    .filter((r) => r !== null)
    .slice(0, max)
  return { ok: true, value: contractors }
}

/** Input must already match getInput. */
export async function getContractor({ directory, siteUrl }: LookupDeps, id: number): Promise<Lookup<PublicContractor>> {
  let row
  try {
    row = await directory.get(id)
  } catch (err) {
    return upstreamFailure(err)
  }
  const contractor = row && row.id === id ? toPublic(row, siteUrl) : null
  if (!contractor) return fail('not_found', `No listed contractor with id ${id}.`)
  return { ok: true, value: contractor }
}

/** Zod issues as one line, in the same form the MCP SDK uses for tool input errors. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)).join(', ')
}
