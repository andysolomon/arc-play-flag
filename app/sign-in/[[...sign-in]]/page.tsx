import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/account/SignInScreen";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sign in · Flag Football Play Designer",
  description: "Sign in with Google or X to keep your plays, playbooks and lineups in an account and open them on any device.",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignInScreen />
    </Suspense>
  );
}
