import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { Page } from "@/components/ui/page";

export const metadata: Metadata = { title: "Reviewer sign in" };

export default function LoginPage() {
  return (
    <Page width="narrow" className="flex justify-center">
      <Suspense>
        <LoginForm />
      </Suspense>
    </Page>
  );
}
