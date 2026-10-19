import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd. They build the app with fake dependencies
// (stub directory, fake limiter), so no wrangler config or bindings are needed.
// The pool's bundled workerd lags wrangler's, hence an older compatibility date.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: { compatibilityDate: '2026-08-15', compatibilityFlags: ['nodejs_compat'] },
    }),
  ],
})
