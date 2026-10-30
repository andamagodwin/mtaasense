import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportWorkspace } from "@/components/review/report-workspace";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Report evidence" };

export default function ReviewReportPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-[600px]" /></div>}>
      <ReportWorkspace />
    </Suspense>
  );
}
