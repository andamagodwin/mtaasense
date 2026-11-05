import type { Metadata } from "next";
import { ReportTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Unlocated reports" };

export default function UnlocatedPage() {
  return (
    <Page>
      <PageHeader
        title="Unlocated reports"
        description="Reports sent without a location. They can't go on the map until a reviewer works out where they are."
      />
      <ReportTable hasLocation={false} empty="Every report has a location." />
    </Page>
  );
}
