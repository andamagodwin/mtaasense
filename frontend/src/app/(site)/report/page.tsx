import type { Metadata } from "next";
import { ReportForm } from "@/components/report/report-form";

export const metadata: Metadata = { title: "Report a hazard" };

export default function ReportPage() {
  return <ReportForm />;
}
