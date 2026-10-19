// End-to-end check against a running MCP Worker, bound to the stub web
// Worker (`pnpm dev`) or the real one (see README, "Against the real web app").
// Uses the official MCP TypeScript client over Streamable HTTP.
//
// The ids it checks come from a search result, so it works on the stub and on
// real data alike.
//
//   pnpm dev            # in one terminal
//   pnpm smoke          # in another; MCP_URL overrides the default
//   pnpm smoke --burst  # also checks the per-IP rate limit (uses up the minute)
//
// Optional: SMOKE_CITY and SMOKE_STATE (default Austin, Texas), and
// SMOKE_CLOSED_ID, an id that must not come back (the stub's closed row is 103).
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const url = new URL(process.env.MCP_URL ?? 'http://localhost:8787/mcp')
const city = process.env.SMOKE_CITY ?? 'Austin'
const state = process.env.SMOKE_STATE ?? 'Texas'
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

const client = new Client({ name: 'roofinglist-smoke', version: '0.0.0' })
await client.connect(new StreamableHTTPClientTransport(url))

const { tools } = await client.listTools()
const names = tools.map((t) => t.name).sort()
console.log('tools:', names.join(', '))
if (names.join() !== 'get_contractor,search_contractors') fail('expected exactly the two tools')

const search = await client.callTool({
  name: 'search_contractors',
  arguments: { trade: 'roofing', city, state, limit: 5 },
})
if (search.isError) fail(`search failed: ${search.content?.[0]?.text}`)
const found = search.structuredContent?.contractors ?? []
console.log(`search_contractors(roofing, ${city}, ${state}): ${found.length} results`)
for (const c of found) console.log(`  ${c.id} ${c.name} (${c.claimed ? 'claimed' : 'free'})`)
if (found.length === 0) fail('search returned no contractors')
if (found.length > 5) fail(`limit 5 returned ${found.length}`)
if (new Set(found.map((c) => c.id)).size !== found.length) fail('search returned an id twice')
for (const c of found) {
  if (!c.trades.includes('roofing')) fail(`${c.id} is not a roofer`)
  if (!c.claimed && 'website' in c) fail(`free profile ${c.id} leaked a website`)
  if (!c.profileUrl.includes('/roofers/')) fail(`${c.id} has profile URL ${c.profileUrl}`)
}
if (/google/i.test(JSON.stringify(found))) fail('a Google field leaked')

// Each search result must also come back from get_contractor, unchanged.
for (const c of found) {
  const get = await client.callTool({ name: 'get_contractor', arguments: { id: c.id } })
  if (get.isError) fail(`get_contractor(${c.id}) failed: ${get.content?.[0]?.text}`)
  const one = get.structuredContent
  if (one?.id !== c.id || one.name !== c.name) fail(`get_contractor(${c.id}) returned ${one?.id} ${one?.name}`)
  if (!one.claimed && 'website' in one) fail(`free profile ${c.id} leaked a website`)
  if (one.claimed && !/^https?:\/\//.test(one.website ?? '')) fail(`claimed profile ${c.id} has no website link`)
}
console.log(`get_contractor: ${found.length} ids match the search`)

// An id that cannot exist must be an error, not a contractor.
const missing = await client.callTool({ name: 'get_contractor', arguments: { id: 2_000_000_000 } })
if (!missing.isError) fail('a missing id was returned')
console.log('get_contractor(missing) ->', missing.content[0].text)

if (process.env.SMOKE_CLOSED_ID) {
  const id = Number(process.env.SMOKE_CLOSED_ID)
  const closed = await client.callTool({ name: 'get_contractor', arguments: { id } })
  if (!closed.isError) fail(`closed business ${id} was returned`)
  if (found.some((c) => c.id === id)) fail(`closed business ${id} came back from search`)
  console.log(`get_contractor(${id}) closed ->`, closed.content[0].text)
}

const bad = await client.callTool({ name: 'search_contractors', arguments: { trade: 'plumbing', city, state } })
if (!bad.isError) fail('bad trade was accepted')
console.log('search_contractors(trade=plumbing) ->', bad.content[0].text.slice(0, 120))

await client.close()

if (process.argv.includes('--burst')) {
  let limited = 0
  for (let i = 0; i < 80; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    })
    if (res.status === 429) limited++
  }
  console.log(`burst: ${limited} of 80 requests got 429`)
  if (limited === 0) fail('rate limit never triggered')
}

console.log('OK')
