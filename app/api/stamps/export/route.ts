import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  const stamps = await prisma.stamp.findMany({
    include: {
      page: {
        include: {
          album: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "stampId",
    "album",
    "pageNo",
    "pageStatus",
    "pageQuality",
    "pageNotes",
    "cropUrl",
    "stampStatus",
    "stampNotes",
    "positionHint",
    "manualCountryHint",
    "manualConditionHint",
    "country",
    "era",
    "denomination",
    "motive",
    "usedState",
    "condition",
    "catalogHint",
    "confidence",
    "valueClass",
    "valueMin",
    "valueMax",
    "needsExpert",
    "createdAt",
  ];

  const rows = stamps.map((stamp) => [
    stamp.id,
    stamp.page.album.name,
    stamp.page.pageNo,
    stamp.page.status,
    stamp.page.quality,
    stamp.page.notes,
    stamp.cropUrl,
    stamp.status,
    stamp.notes,
    stamp.positionHint,
    stamp.manualCountryHint,
    stamp.manualConditionHint,
    stamp.country,
    stamp.era,
    stamp.denomination,
    stamp.motive,
    stamp.usedState,
    stamp.condition,
    stamp.catalogHint,
    stamp.confidence,
    stamp.valueClass,
    stamp.valueMin,
    stamp.valueMax,
    stamp.needsExpert ? "ja" : "nein",
    stamp.createdAt,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stamps.csv"',
    },
  });
}
