"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AnalyzeButtonProps = {
  stampId: string;
  analyzed: boolean;
};

export function AnalyzeButton({ stampId, analyzed }: AnalyzeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/stamps/${stampId}/analyze`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Analyse fehlgeschlagen.");
      }

      router.refresh();
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Analyse fehlgeschlagen.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-action">
      <button className="button compact" onClick={analyze} disabled={loading}>
        {loading ? "Analysiere..." : analyzed ? "Neu analysieren" : "Analysieren"}
      </button>
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
