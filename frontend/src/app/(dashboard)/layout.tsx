import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/shell";

/** Reviewer and admin pages: the dashboard shell instead of the public header and footer. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
