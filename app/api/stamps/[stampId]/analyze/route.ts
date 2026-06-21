import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { analyzeStampImage } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { mimeTypeFromPath, publicUploadUrlToPath } from "@/lib/uploads";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ stampId: string }> | { stampId: string };
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { stampId } = await context.params;
    const stamp = await prisma.stamp.findUnique({
      where: { id: stampId },
    });

    if (!stamp) {
      return NextResponse.json({ error: "Marke nicht gefunden." }, { status: 404 });
    }

    const filePath = publicUploadUrlToPath(stamp.cropUrl);
    const analysis = await analyzeStampImage(filePath, mimeTypeFromPath(filePath));

    const updatedStamp = await prisma.stamp.update({
      where: { id: stamp.id },
      data: {
        country: analysis.data.country,
        era: analysis.data.era,
        denomination: analysis.data.denomination,
        motive: analysis.data.motive,
        usedState: analysis.data.usedState,
        condition: analysis.data.condition,
        catalogHint: analysis.data.catalogHint,
        confidence: analysis.data.confidence,
        valueClass: analysis.data.valueClass,
        valueMin: analysis.data.valueMin,
        valueMax: analysis.data.valueMax,
        needsExpert: analysis.data.needsExpert,
        analysisRaw: analysis.raw as Prisma.InputJsonValue,
        status: analysis.data.needsExpert ? "pruefbedarf" : "analysiert",
      },
    });

    return NextResponse.json({
      stamp: updatedStamp,
      analysis: analysis.data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analyse fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
