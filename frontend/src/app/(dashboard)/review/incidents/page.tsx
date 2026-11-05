import type { Metadata } from "next";
import { IncidentTable } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Page>
      <PageHeader title="Incidents" />
      <IncidentTable />
    </Page>
  );
}
