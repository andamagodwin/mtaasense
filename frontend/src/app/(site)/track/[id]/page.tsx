import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackReport } from "@/components/track-report";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Your report", robots: { index: false } };

export default function TrackPage() {
  return (
    <Suspense
      fallback={
        <Page className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[420px] w-full" />
        </Page>
      }
    >
      <TrackReport />
    </Suspense>
  );
}
