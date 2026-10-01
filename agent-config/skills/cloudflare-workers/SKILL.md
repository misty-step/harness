---
name: cloudflare-workers
description: Avoid deployment, binding and secret-command traps while editing Cloudflare Workers with project-local Wrangler.
---

# Cloudflare Workers

Adapted and shortened from [cloudflare/skills](https://github.com/cloudflare/skills)
(`d924cd8`); [LICENSE](LICENSE) retains the Apache 2.0 notice.

Use the project's installed Wrangler, scripts and config source, not a global
upgrade or generated config. Fetch only the needed [command](https://developers.cloudflare.com/workers/wrangler/commands/)
or [config](https://developers.cloudflare.com/workers/wrangler/configuration/) docs;
installed help/schema wins when versions differ.

Name account, Worker, environment and local/remote resource before mutation.
Bindings may not inherit; omitted resource IDs can provision new resources.
Wrangler can overwrite dashboard changes. Vite selects `CLOUDFLARE_ENV` at build
time, not deployment time. Local dev with remote bindings can write real data.

`secret put/delete` deploy immediately; `versions secret` stages changes.
Code rollback does not restore connected resource data. Dry-run proves packaging,
not runtime behavior. Regenerate types after binding/config changes; exercise
the changed operation. Preserve existing compatibility dates unless changing one
is part of the task.
