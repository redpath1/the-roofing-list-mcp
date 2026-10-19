/**
 * Reads from theroofinglist-web over the WEB service binding.
 * See src/contract.ts for the route and its response shape.
 */
import {
  INTERNAL_BASE,
  INTERNAL_TOKEN_HEADER,
  getResponse,
  searchResponse,
  type InternalContractor,
  type Trade,
} from './contract'

export type SearchQuery = { trade: Trade; state: string; city: string; limit: number }

export interface Directory {
  search(q: SearchQuery): Promise<InternalContractor[]>
  get(id: number): Promise<InternalContractor | undefined>
}

/** Thrown when the web Worker fails or breaks the contract. The tool shows a generic error. */
export class UpstreamError extends Error {}

export function serviceBindingDirectory(web: Fetcher, token: string): Directory {
  const call = async (path: string) => {
    const res = await web.fetch(`${INTERNAL_BASE}${path}`, {
      headers: { [INTERNAL_TOKEN_HEADER]: token, accept: 'application/json' },
    })
    return res
  }

  return {
    async search({ trade, state, city, limit }) {
      const qs = new URLSearchParams({ trade, state, city, limit: String(limit) })
      const res = await call(`/contractors?${qs}`)
      if (!res.ok) throw new UpstreamError(`search: HTTP ${res.status}`)
      const parsed = searchResponse.safeParse(await res.json())
      if (!parsed.success) throw new UpstreamError('search: bad response shape')
      return parsed.data.contractors
    },

    async get(id) {
      const res = await call(`/contractors/${id}`)
      if (res.status === 404) return undefined
      if (!res.ok) throw new UpstreamError(`get: HTTP ${res.status}`)
      const parsed = getResponse.safeParse(await res.json())
      if (!parsed.success) throw new UpstreamError('get: bad response shape')
      return parsed.data.contractor
    },
  }
}
