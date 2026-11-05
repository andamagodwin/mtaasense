import type { Metadata } from "next";
import { Suspense } from "react";
import { IncidentWorkspace } from "@/components/review/incident-workspace";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Incident" };

export default function IncidentPage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-[600px]" /></Page>}>
      <IncidentWorkspace />
    </Suspense>
  );
}
