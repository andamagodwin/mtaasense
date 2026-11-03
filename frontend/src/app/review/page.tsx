import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewDashboard } from "@/components/review/dashboard";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Review workspace" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-96" /></Page>}>
      <ReviewDashboard />
    </Suspense>
  );
}
