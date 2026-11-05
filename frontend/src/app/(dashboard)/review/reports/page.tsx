import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsView } from "@/components/review/reports-view";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-96" /></Page>}>
      <ReportsView />
    </Suspense>
  );
}
