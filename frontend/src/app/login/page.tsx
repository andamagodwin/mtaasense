import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Reviewer sign in" };

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-14 sm:py-20">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
