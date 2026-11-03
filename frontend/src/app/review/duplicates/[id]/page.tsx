import type { Metadata } from "next";
import { Suspense } from "react";
import { DuplicateComparison } from "@/components/review/duplicate-comparison";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Compare reports" };

export default function DuplicatePage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-[600px]" /></Page>}>
      <DuplicateComparison />
    </Suspense>
  );
}
