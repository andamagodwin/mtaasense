import type { Metadata } from "next";
import { ReportTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Review queue" };

export default function QueuePage() {
  return (
    <Page>
      <PageHeader
        title="Review queue"
        description="Reports waiting for a decision, and any whose AI processing failed. Check each assessment against the original evidence."
      />
      <ReportTable statuses={["under_review", "processing_failed"]} empty="No reports are waiting for review." />
    </Page>
  );
}
