import { Suspense, type ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader, SiteHeaderFallback } from "@/components/site-header";

/** The public site: header, page, footer. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<SiteHeaderFallback />}>
        <SiteHeader />
      </Suspense>
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
