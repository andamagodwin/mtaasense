import type { Metadata } from "next";
import { Suspense } from "react";
import { IncidentWorkspace } from "@/components/review/incident-workspace";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Incident" };

export default function IncidentPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-[600px]" /></div>}>
      <IncidentWorkspace />
    </Suspense>
  );
}
