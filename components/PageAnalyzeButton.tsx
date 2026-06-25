"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PageAnalyzeButtonProps = {
  pageId: string;
  analyzed: boolean;
  objectType: string;
};

export function PageAnalyzeButton({
  pageId,
  analyzed,
  objectType,
}: PageAnalyzeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = objectType === "beleg" ? "Beleg analysieren" : "Seite analysieren";

  async function analyze() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/pages/${pageId}/analyze`, {
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
        {loading ? "Analysiere..." : analyzed ? "Neu analysieren" : label}
      </button>
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
