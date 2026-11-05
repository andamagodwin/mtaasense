import type { Metadata } from "next";
import { ReportTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "All reports" };

export default function ReportsPage() {
  return (
    <Page>
      <PageHeader title="All reports" description="Every report residents have sent, newest first. Search by reference or description." />
      <ReportTable searchable empty="No reports have been submitted yet." />
    </Page>
  );
}
