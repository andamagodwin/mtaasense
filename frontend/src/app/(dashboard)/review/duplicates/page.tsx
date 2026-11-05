import type { Metadata } from "next";
import { DuplicateList } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Duplicates" };

export default function DuplicatesPage() {
  return (
    <Page>
      <PageHeader
        title="Duplicates"
        description="Pairs of reports that may describe the same problem, strongest match first. Only your decision links them."
      />
      <DuplicateList />
    </Page>
  );
}
