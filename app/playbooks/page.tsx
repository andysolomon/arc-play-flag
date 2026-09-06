import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaybooksScreen } from "@/components/playbooks/PlaybooksScreen";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Playbooks · Flag Football Play Designer",
  description: "Build playbooks from your saved plays and print them as wristbands, binder pages and cards.",
};

/** One static shell for the list and for a single playbook (?book=<id>), so both open offline. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PlaybooksScreen />
    </Suspense>
  );
}
