/** Entry for the local stub Worker. Only the default export: workerd treats named exports as entrypoints. */
import { handleInternal } from './internal'

export default {
  fetch(request, env) {
    return handleInternal(request, env.INTERNAL_API_TOKEN)
  },
} satisfies ExportedHandler<{ INTERNAL_API_TOKEN: string }>
