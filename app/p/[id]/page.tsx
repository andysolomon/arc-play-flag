import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedPlay } from "@/components/SharedPlay";
import { decodeShare } from "@/lib/play/share";

interface Props {
  params: Promise<{ id: string }>;
}

// Share ids are generated client-side. Render each request instead of asking Next to
// persist an arbitrarily long base64 id as a filesystem cache path.
export const dynamic = "force-dynamic";
export const dynamicParams = true;
export function generateStaticParams(): { id: string }[] {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const rec = decodeShare(id);
  return { title: rec ? `${rec.name} · Flag Football Play Designer` : "Flag Football Play Designer" };
}

export default async function SharedPlayPage({ params }: Props) {
  const { id } = await params;
  const rec = decodeShare(id);
  if (!rec) notFound();
  return <SharedPlay id={id} name={rec.name} players={rec.players} vis={rec.vis} />;
}
