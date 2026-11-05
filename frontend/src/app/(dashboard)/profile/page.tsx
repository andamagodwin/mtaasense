import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfilePage } from "@/components/profile/profile";
import { Skeleton } from "@/components/ui/feedback";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Profile" };

export default function Profile() {
  return (
    <Suspense fallback={<Page><Skeleton className="h-96" /></Page>}>
      <ProfilePage />
    </Suspense>
  );
}
