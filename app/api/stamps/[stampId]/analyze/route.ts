import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Die Webapp fuehrt keine KI-Analyse mehr aus. Bitte Recherchepakete in der lokalen Sichtung erstellen und ChatGPT-Ergebnisse importieren.",
    },
    { status: 410 },
  );
}
