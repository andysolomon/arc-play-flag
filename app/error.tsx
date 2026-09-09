"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

/** The route-level boundary: a page broke, but the layout, fonts and styles are still here. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorRecovery error={error} retry={retry} />;
}
