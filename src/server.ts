/**
 * The MCP server: two read-only tools. A new server is built per request
 * (stateless). See src/index.ts for the HTTP side. The lookups live in
 * src/lookup.ts; the REST routes call the same ones.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { Directory } from './directory'
import { getContractor, getInput, searchContractors, searchInput } from './lookup'
import { publicContractor } from './present'

export { DEFAULT_LIMIT, MAX_LIMIT, getInput, searchInput } from './lookup'

export const SERVER_NAME = 'theroofinglist'
export const SERVER_VERSION = '0.1.1'

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

type Deps = { directory: Directory; siteUrl: string }

const errorResult = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] })

export function createServer(deps: Deps): McpServer {
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
    async (input) => {
      const result = await searchContractors(deps, input)
      if (!result.ok) return errorResult(result.message)
      const structured = { contractors: result.value }
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
      const result = await getContractor(deps, id)
      if (!result.ok) return errorResult(result.message)
      return {
        structuredContent: result.value,
        content: [{ type: 'text' as const, text: JSON.stringify(result.value) }],
      }
    },
  )

  return server
}
