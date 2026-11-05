import type { Metadata } from "next";
import { ReportTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <Page>
      <PageHeader title="Queue" />
      <ReportTable statuses={["under_review", "processing_failed"]} empty="No reports are waiting for review." />
    </Page>
  );
}
