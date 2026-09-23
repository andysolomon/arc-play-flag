import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedBook } from "@/components/playbooks/SharedBook";
import { TOKEN_PATTERN } from "@/lib/sharing/links";

export const metadata: Metadata = { title: "Shared snapshot · Arc Play Flag", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function SharedBookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  return <SharedBook key={token} token={token} />;
}
