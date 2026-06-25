import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { analyzePageImageBytes } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { readPublicUpload } from "@/lib/uploads";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ pageId: string }> | { pageId: string };
};

function statusForAction(action: string) {
  if (action === "neu_fotografieren") return "nachfotografieren";
  if (action === "zur_sichtung" || action === "einzelmarke_empfehlen") {
    return "teilweise_erfasst";
  }

  return "fertig";
}

function analysisStatusForAction(action: string) {
  if (action === "neu_fotografieren" || action === "zur_sichtung") {
    return "sichtung";
  }

  if (action === "einzelmarke_empfehlen") {
    return "sichtung";
  }

  return "fertig";
}

function qualityForAnalysis(quality: string) {
  if (quality === "kritisch") return "nachfotografieren";
  if (quality === "grenzwertig") return "unbekannt";

  return "gut";
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { pageId } = await context.params;
    const page = await prisma.page.findUnique({
      where: { id: pageId },
    });

    if (!page) {
      return NextResponse.json(
        { error: "Seite oder Beleg nicht gefunden." },
        { status: 404 },
      );
    }

    await prisma.page.update({
      where: { id: page.id },
      data: {
        analysisStatus: "laeuft",
      },
    });

    const image = await readPublicUpload(page.imageUrl);
    const analysis = await analyzePageImageBytes(
      image.bytes,
      image.mimeType,
      page.objectType,
    );

    const updatedPage = await prisma.page.update({
      where: { id: page.id },
      data: {
        objectType:
          analysis.data.objectType === "beleg" ? "beleg" : page.objectType,
        quality: qualityForAnalysis(analysis.data.captureQuality),
        status: statusForAction(analysis.data.recommendedAction),
        analysisStatus: analysisStatusForAction(analysis.data.recommendedAction),
        analysisNotes: analysis.data.summary,
        detectedRegions: analysis.data.detectedItems as Prisma.InputJsonValue,
        analysisRaw: analysis.raw as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      page: updatedPage,
      analysis: analysis.data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analyse fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
