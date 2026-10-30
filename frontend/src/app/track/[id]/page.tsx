import type { Metadata } from "next";
import { Suspense } from "react";
import { TrackReport } from "@/components/track-report";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Your report", robots: { index: false } };

export default function TrackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 py-10 sm:px-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      }
    >
      <TrackReport />
    </Suspense>
  );
}
