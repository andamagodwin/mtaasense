import type { Metadata } from "next";
import { IncidentTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Page>
      <PageHeader title="Incidents" description="Confirmed problems, each grouping one or more reports, most recently updated first." />
      <IncidentTable />
    </Page>
  );
}
