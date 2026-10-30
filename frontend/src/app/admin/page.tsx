import type { Metadata } from "next";
import { UsageDashboard } from "@/components/admin/usage-dashboard";

export const metadata: Metadata = { title: "Model usage" };

export default function AdminPage() {
  return <UsageDashboard />;
}
