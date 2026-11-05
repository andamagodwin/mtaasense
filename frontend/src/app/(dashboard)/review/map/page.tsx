import type { Metadata } from "next";
import { ReviewMap } from "@/components/review/review-map";

export const metadata: Metadata = { title: "Review map" };

export default function ReviewMapPage() {
  return <ReviewMap />;
}
