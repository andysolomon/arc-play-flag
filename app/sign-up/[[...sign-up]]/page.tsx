import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/account/SignInScreen";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Create an account · Flag Football Play Designer",
  description: "Create an account with Google or X to keep your plays, playbooks and lineups and open them on any device.",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignInScreen up />
    </Suspense>
  );
}
