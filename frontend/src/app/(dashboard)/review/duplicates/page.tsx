import type { Metadata } from "next";
import { DuplicateList } from "@/components/review/dashboard";
import { Page, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Duplicates" };

export default function DuplicatesPage() {
  return (
    <Page>
      <PageHeader title="Duplicates" />
      <DuplicateList />
    </Page>
  );
}
