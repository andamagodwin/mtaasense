import type { ReactNode } from "react";
import { ReviewAssistant } from "@/components/assistant/review-assistant";

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ReviewAssistant />
    </>
  );
}
