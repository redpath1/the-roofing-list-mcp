/**
 * The OpenAPI 3.1 document for the REST routes. The one source is
 * ../openapi.json; the Worker serves it at /openapi.json. Wrangler bundles
 * the JSON at build time.
 */
import doc from '../openapi.json'

export const openapi = doc
