"use client";

import { useEffect } from "react";

/** Registers the service worker, which makes the site installable and serves an offline page. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The worker never caches navigations or API traffic, so it is safe in development too.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
