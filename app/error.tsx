"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { StatePage } from "@/components/state-page";

export default function Error({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Production telemetry can be added here without exposing error details to learners.
  }, []);

  return (
    <StatePage
      code="500"
      title="This learning step hit a snag."
      description="We could not load this space right now. Your progress is safe; try refreshing and continue when you are ready."
      icon={RefreshCw}
      action="Try again"
      onAction={reset}
    />
  );
}
