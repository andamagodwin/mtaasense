import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewOverview } from "@/components/review/overview";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Review dashboard" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-96" /></Page>}>
      <ReviewOverview />
    </Suspense>
  );
}
