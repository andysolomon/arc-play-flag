import type { Metadata } from "next";
import { DemoScreen } from "@/components/demo/DemoScreen";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Demo · Flag Football Play Designer",
  description: "A short, visual tour of drawing, running, saving and sharing 5v5 flag-football plays.",
};

export default function Page() {
  return <DemoScreen />;
}
