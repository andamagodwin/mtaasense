import type { Metadata } from "next";
import { Suspense } from "react";
import { DuplicateComparison } from "@/components/review/duplicate-comparison";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Compare reports" };

export default function DuplicatePage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-[600px]" /></div>}>
      <DuplicateComparison />
    </Suspense>
  );
}
