# The Roofing List: MCP server

A public, read-only MCP server for [The Roofing List](https://theroofinglist.com/mcp/). AI assistants use it to find checked US roofers, siding and gutter contractors by city.

- Endpoint: `https://mcp.theroofinglist.com/mcp` (Streamable HTTP). No login, no API key.
- About page: https://theroofinglist.com/mcp/

## Use it

Claude Code:

```bash
claude mcp add --transport http the-roofing-list https://mcp.theroofinglist.com/mcp
```

Claude Desktop: add this to `claude_desktop_config.json`. It uses `mcp-remote`, because the config file starts local servers only. Or add the URL as a custom connector in Settings > Connectors.

```json
{
  "mcpServers": {
    "the-roofing-list": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.theroofinglist.com/mcp"]
    }
  }
}
```

Any other MCP client: connect to `https://mcp.theroofinglist.com/mcp` with Streamable HTTP.

Connect from any agent: [`.mcp.json`](.mcp.json) at the root of this repo holds the server entry. Claude Code reads it when you open this repo. For any other client, copy the entry into that client's MCP config.

### The data rules

- Only listed, open firms leave this server. Closed or unlisted rows are dropped, even when the data source sends them.
- No paid boost. This server has no ranking code. It keeps the order the directory sends and cuts it to `limit`.
- Ratings come from reviews published on The Roofing List only. No Google rating or review data: the contract has no such field, and an allowlist drops any extra field.
- A free profile never carries a website.

The rules live in `src/present.ts`. The tests in `test/tools.test.ts` prove them against a deliberately leaky stub.

## How it works

- Worker name: `theroofinglist-mcp`
- Endpoint: `POST /mcp` (Streamable HTTP). No login. `GET /` sends a 301 to https://theroofinglist.com/mcp/.
- Stateless: `createMcpHandler` from `agents/mcp/server` builds a new `McpServer` for each request. No Durable Objects. Cloudflare marks `McpAgent` as the older path for new stateless servers.
- Protocol: the MCP SDK v2 serves the 2026-07-28 spec. It also answers 2025-era clients through its stateless fallback.

## REST API

The same Worker also serves a small REST API, for RapidAPI and for people who do not use MCP. It is read-only, free and needs no key. It calls the same lookups as the MCP tools (`src/lookup.ts`), so both return the same records.

| Route | Returns |
| --- | --- |
| `GET /v1/contractors?trade=&city=&state=&limit=` | `{ "contractors": Contractor[] }`. Same inputs and limits as `search_contractors`. |
| `GET /v1/contractors/{id}` | `Contractor`, or `404` for a closed, unlisted or unknown id |
| `GET /openapi.json` | The OpenAPI 3.1 document (`openapi.json` in this folder) |

```bash
curl 'https://mcp.theroofinglist.com/v1/contractors?trade=roofing&city=Austin&state=TX&limit=5'
curl 'https://mcp.theroofinglist.com/v1/contractors/101'
```

- Errors are `{ "error": "..." }`: `400` bad input (same messages as the tools), `404`, `405` for any method but GET, `429` over the rate limit (with `Retry-After: 60`), `503` when the web Worker fails.
- Every response has `access-control-allow-origin: *`. `OPTIONS` answers the CORS preflight.
- Cache: `public, max-age=300` on `200`, `400`, `404` and `405`. `no-store` on `429` and `503`, so no cache keeps a short-lived error. `/openapi.json` caches for 1 hour.
- `openapi.json` is the one source for the document. `src/openapi.ts` imports it. When you raise `SERVER_VERSION`, raise `info.version` too; a test checks that they match.

### RapidAPI and the rate limit

All RapidAPI calls come from RapidAPI's servers. A per-IP limit would count all RapidAPI users as one caller. So:

- Set the proxy secret from the RapidAPI provider dashboard as a Worker secret: `pnpm exec wrangler secret put RAPIDAPI_PROXY_SECRET`. It is optional. Locally, leave it empty in `.dev.vars`.
- When a request carries that secret in `x-rapidapi-proxy-secret`, the key is `rapidapi:<x-rapidapi-user>`. Without the user header, the key falls back to the IP.
- A missing or wrong secret means the key is the IP. A caller cannot pick a key by sending a fake `x-rapidapi-user`. The compare is constant-time.
- REST and MCP keep separate budgets on the same binding: keys start with `rest:` or `mcp:`. Each gets 60 calls a minute. `/openapi.json` and `OPTIONS` do not count.

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `search_contractors` | `trade` (`roofing`, `siding`, `gutters`), `city`, `state` (code or name), `limit` (1–25, default 10) | `{ contractors: Contractor[] }` |
| `get_contractor` | `id` (integer from search) | `Contractor`, or an error for a closed, unlisted or unknown id |

`Contractor`: `id`, `name`, `trades`, `city`, `state`, `phone`, `profileUrl`, `claimed`, `website` (claimed only), `rating` (`{ value, count }`, published reviews on our site only; absent when there are none).

See "The data rules" above for what may leave this Worker.

## Run it locally

You need Node 22+ (Wrangler 4) and pnpm. You do not need a Cloudflare login.

```bash
pnpm install
pnpm dev          # MCP Worker on :8787 plus the stub web Worker
pnpm smoke        # in a second shell: official MCP client lists and calls both tools
pnpm smoke --burst  # also checks the rate limit (uses up this minute's budget)
pnpm test
pnpm typecheck
```

`pnpm dev` copies `.dev.vars.example` to `.dev.vars` the first time. Both hold a fake local token.

### Against the real web app

The real data route lives in the private web app (`theroofinglist-web`). `src/contract.ts` describes it, and `stub/` copies its shape with fake rows. If you have the web app, run it on port 8790 and point this Worker at it over the `WEB` service binding:

```bash
pnpm exec wrangler dev -c wrangler.jsonc --local --port 8792
MCP_URL=http://localhost:8792/mcp pnpm smoke
```

Both Workers must hold the same `INTERNAL_API_TOKEN` in `.dev.vars`.

`pnpm smoke` takes its ids from a search for roofers in Austin, Texas, so it runs on the stub and on real data. `SMOKE_CITY` and `SMOKE_STATE` change the search. `SMOKE_CLOSED_ID` names an id that must not come back: `SMOKE_CLOSED_ID=103 pnpm smoke` checks the stub's closed row.

Inspector: `npx @modelcontextprotocol/inspector` and connect to `http://localhost:8787/mcp` with Streamable HTTP.

## How it reads data

The MCP Worker calls `theroofinglist-web` over a service binding (`WEB`). The web Worker reads through Payload, the same as the public pages. In local dev, `stub/` runs under the name `theroofinglist-web` and serves fake rows. The stub is loose on purpose: it sends closed rows, a free website and Google fields, so the tests prove this Worker filters them.

### The internal route

The private web app serves this route. `src/contract.ts` defines it. The path sits outside `/api`, so Payload's `/api/[...slug]` catch-all does not take it.

```
GET /internal/mcp/contractors?trade=<slug>&state=<USPS>&city=<city-slug>&limit=<1..25>
  200 { "contractors": Contractor[] }

GET /internal/mcp/contractors/<id>
  200 { "contractor": Contractor }
  404 { "error": "not_found" }      // also for closed or unlisted

Header on every request: x-internal-token: <INTERNAL_API_TOKEN>
  401 { "error": "unauthorized" }   // missing or wrong token

Contractor = {
  id: number,                      // Businesses.id
  name: string,
  trades: string[],                // Trades slugs, TRADE_PATHS order
  city: string,                    // city name, e.g. "Austin"
  state: string,                   // USPS code, e.g. "TX"
  phone: string | null,            // E.164
  tier: "free" | "claimed",
  website: string | null,          // as stored; the MCP Worker drops it for free
  status: "active" | "closed",
  listed: boolean,
  path: string,                    // profilePath(), e.g. "/roofers/texas/austin/lone-star-roofing"
  rating: { value: number, count: number } | null   // getRatings(): published reviews only
}
```

## Rate limit

`RATE_LIMITER` is a Workers rate limiting binding: 60 requests per IP per 60 seconds, keyed on `cf-connecting-ip`. Over the limit, `/mcp` returns `429` with `Retry-After: 60` and a JSON-RPC error. For RapidAPI traffic the key is the RapidAPI user; see "RapidAPI and the rate limit" above. The binding counts per Cloudflare location and is eventually consistent, so it stops abuse, not exact overuse.

## Production

Live at https://mcp.theroofinglist.com/mcp (custom domain) since 4 Oct 2026. Deploy with `pnpm exec wrangler deploy`.

- `INTERNAL_API_TOKEN` is a secret on both Workers, with the same value. To rotate it, put a new value on both.
- `ALLOWED_HOSTNAMES` in `wrangler.jsonc` lists the custom domain, the workers.dev name and the local names.
- Deploy `theroofinglist-web` first when the contract changes. Never deploy `stub/`.
- Smoke test: `MCP_URL=https://mcp.theroofinglist.com/mcp pnpm smoke`.
- The web app serves the route at `/internal/mcp/contractors/` (with a slash). A call without the slash gets a 308, which the service binding follows. One extra hop; it works.

## Official MCP registry

Listed as `io.github.redpath1/the-roofing-list` since 5 Oct 2026. `server.json` in this folder is the entry. Check it:

```bash
curl -s 'https://registry.modelcontextprotocol.io/v0.1/servers?search=redpath1'
```

The name uses the GitHub namespace. The domain namespace (`com.theroofinglist/...`) needs a TXT record on the apex or a `/.well-known/mcp-registry-auth` file on theroofinglist.com. The Wrangler login cannot edit DNS, and the file means a web deploy, so we chose GitHub. `server.json` names this repository in its `repository` field from version 0.1.1. The registry shows that field only after 0.1.1 is published (see below). Publish it after the repository is public.

### Publish a new version

The registry keeps every version for good. You cannot change or reuse a version string.

1. Install the CLI: `brew install mcp-publisher` (1.8.1 or later).
2. In `server.json`, raise `version` (semver, e.g. `0.1.1`). Keep it the same as `SERVER_VERSION` in `src/server.ts`.
3. Check it: `mcp-publisher validate server.json`.
4. Log in as `redpath1`, who owns the namespace. Run `mcp-publisher login github` and enter the device code. Or reuse the `gh` login, without showing the token: `gh auth token | xargs -I{} mcp-publisher login github --token={}`.
5. Publish: `mcp-publisher publish server.json`.
6. Run the `curl` above. The new version shows `"isLatest": true`.

The directory page on theroofinglist.com already marks this server as in the official registry. A new version does not change that.

## Public repository

https://github.com/redpath1/the-roofing-list-mcp is the published copy of the `mcp/` folder in the private monorepo of The Roofing List. Develop in the monorepo. The public repo has its own short history, so do not use `git subtree push`: that would push the monorepo's commit history, with its author emails, to the public repo. After a change to `mcp/` merges to `main`, copy the files instead:

```bash
git clone https://github.com/redpath1/the-roofing-list-mcp /tmp/trl-mcp
rsync -a --delete --exclude .git --exclude node_modules --exclude .wrangler --exclude .dev.vars mcp/ /tmp/trl-mcp/
cd /tmp/trl-mcp && git add -A && git commit -m "<what changed>" && git push
```

Commit as `Keith Evans <272994924+redpath1@users.noreply.github.com>`. No personal email goes into the public history.

## Contributing

Issues are open. We review pull requests when there is time. We make no roadmap promises.

## License

MIT. See `LICENSE`.
