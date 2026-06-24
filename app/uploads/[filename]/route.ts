import { NextResponse } from "next/server";
import { readPublicUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ filename: string }> | { filename: string };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { filename } = await context.params;
    const upload = await readPublicUpload(`/uploads/${filename}`);

    return new NextResponse(new Uint8Array(upload.bytes), {
      headers: {
        "Content-Type": upload.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Bild nicht gefunden." }, { status: 404 });
  }
}
