import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  // The MTAASENSE account. Not a credential: deploys still need CLOUDFLARE_API_TOKEN or `cf auth login`.
  accountId: "d35ff67e20bfbffa7c5c8eb65e86e921",
  worker: defineWorker({
    name: "mtaasense",
    // Wraps vinext's handler: www → apex redirect and byte ranges for the hero reel.
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-10-30",
    compatibilityFlags: ["nodejs_compat"],
    // Registered with Cloudflare Registrar in the same account; attached on deploy. worker.ts redirects
    // www to the apex.
    domains: ["mtaasense.com", "www.mtaasense.com"],
    // Deploys turn workers.dev off once custom domains exist unless it is set explicitly; keep the old URL
    // working for links already shared.
    workersDev: true,
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // Where worker.ts forwards WebSockets (the API's public origin, the same one next.config rewrites to).
      API_ORIGIN: bindings.text((process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "")),
    },
  }),
});
