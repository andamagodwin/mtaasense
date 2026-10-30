import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewDashboard } from "@/components/review/dashboard";
import { Skeleton } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Review workspace" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6"><Skeleton className="h-96" /></div>}>
      <ReviewDashboard />
    </Suspense>
  );
}
