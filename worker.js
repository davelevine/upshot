// The Worker behind upshot.levine.io. Everything is a static asset from site/ except /api/read (see run_worker_first in
// wrangler.jsonc), which returns the article the build stored.
import { onRequestGet } from './functions/api/read.js';

export default { fetch: (request, env) => onRequestGet({ request, env }) };
