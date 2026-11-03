import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportWorkspace } from "@/components/review/report-workspace";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Report evidence" };

export default function ReviewReportPage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-[600px]" /></Page>}>
      <ReportWorkspace />
    </Suspense>
  );
}
