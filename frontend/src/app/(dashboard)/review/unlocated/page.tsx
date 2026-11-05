import { redirect } from "next/navigation";

// Unlocated reports are a filter on the reports list.
export default function UnlocatedPage() {
  redirect("/review/reports?filter=unlocated");
}
