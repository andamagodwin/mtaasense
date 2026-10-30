import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  // The MTAASENSE account. Not a credential: deploys still need CLOUDFLARE_API_TOKEN or `cf auth login`.
  accountId: "d35ff67e20bfbffa7c5c8eb65e86e921",
  worker: defineWorker({
    name: "mtaasense",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-30",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
