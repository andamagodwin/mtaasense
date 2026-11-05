"use client";

import { Wifi } from "iconsax-reactjs";
import { Page, PageHeader } from "@/components/ui/page";

/** Served by the service worker when a navigation fails with no connection. */
export default function OfflinePage() {
  return (
    <Page width="narrow">
      <PageHeader title="You're offline" description="MtaaSense needs a connection to load. Your reports are safe — nothing you submitted is lost." />
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <Wifi className="size-5 shrink-0 text-ink-3" />
        <p className="flex-1 text-[14px] text-ink-2">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13.5px] font-medium text-white hover:bg-ink/90"
        >
          Retry
        </button>
      </div>
    </Page>
  );
}
