/**
 * The MCP server: two read-only tools. A new server is built per request
 * (stateless). See src/index.ts for the HTTP side.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { TRADES } from './contract'
import { UpstreamError, type Directory } from './directory'
import { slugify, toStateCode } from './places'
import { publicContractor, toPublic } from './present'

export const SERVER_NAME = 'theroofinglist'
export const SERVER_VERSION = '0.1.1'
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

export const getInput = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe('The contractor id from search_contractors.'),
})

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

type Deps = { directory: Directory; siteUrl: string }

const errorResult = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] })

const upstreamFailure = (err: unknown) => {
  if (!(err instanceof UpstreamError)) throw err
  console.error('upstream', err.message)
  return errorResult('The directory is not available right now. Try again soon.')
}

export function createServer({ directory, siteUrl }: Deps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  server.registerTool(
    'search_contractors',
    {
      title: 'Search contractors',
      description:
        'Find roofing, siding or gutter contractors in a US city from The Roofing List. ' +
        'Returns only listed businesses that are open and passed our contact check. ' +
        'Ratings come from reviews published on The Roofing List only.',
      inputSchema: searchInput,
      outputSchema: z.object({ contractors: z.array(publicContractor) }),
      annotations: readOnly,
    },
    async ({ trade, city, state, limit }) => {
      const code = toStateCode(state)
      if (!code) return errorResult(`Unknown US state "${state}". Use a USPS code like "TX" or a name like "Texas".`)
      const citySlug = slugify(city)
      if (!citySlug) return errorResult(`"${city}" is not a city name.`)
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

      const structured = { contractors }
      return {
        structuredContent: structured,
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
      }
    },
  )

  server.registerTool(
    'get_contractor',
    {
      title: 'Get contractor',
      description:
        'Get one contractor from The Roofing List by id. Returns nothing for a business ' +
        'that is closed or no longer listed.',
      inputSchema: getInput,
      outputSchema: publicContractor,
      annotations: readOnly,
    },
    async ({ id }) => {
      let row
      try {
        row = await directory.get(id)
      } catch (err) {
        return upstreamFailure(err)
      }
      const contractor = row && row.id === id ? toPublic(row, siteUrl) : null
      if (!contractor) return errorResult(`No listed contractor with id ${id}.`)
      return {
        structuredContent: contractor,
        content: [{ type: 'text' as const, text: JSON.stringify(contractor) }],
      }
    },
  )

  return server
}
