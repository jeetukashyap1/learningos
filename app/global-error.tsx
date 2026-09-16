"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { StatePage } from "@/components/state-page";

export default function GlobalError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Production telemetry can be added here without exposing error details to learners.
  }, []);

  return (
    <html lang="en">
      <body>
        <StatePage
          code="500"
          title="LearningOS needs a reset."
          description="The learning space could not start. Your progress is safe; try again when you are ready."
          icon={RefreshCw}
          action="Try again"
          onAction={reset}
        />
      </body>
    </html>
  );
}
