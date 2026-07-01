import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const uploadApiPrefix = "/api/uploads/";
const localUploadDir = path.join(process.cwd(), "public", "uploads");

loadEnvFile(".env");
loadEnvFile(".env.local");

const options = parseArgs(process.argv.slice(2));
const prisma = new PrismaClient();

function parseArgs(args) {
  const parsed = {
    vision: "none",
    ollamaUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_VISION_MODEL || "llama3.2-vision",
    limit: null,
  };

  for (const arg of args) {
    if (arg.startsWith("--vision=")) parsed.vision = arg.slice("--vision=".length);
    if (arg.startsWith("--ollama-url=")) parsed.ollamaUrl = arg.slice("--ollama-url=".length);
    if (arg.startsWith("--model=")) parsed.model = arg.slice("--model=".length);
    if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length));
  }

  if (!["none", "ollama"].includes(parsed.vision)) {
    throw new Error("--vision muss none oder ollama sein");
  }

  if (parsed.limit !== null && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit muss eine positive Ganzzahl sein");
  }

  return parsed;
}

function loadEnvFile(filename) {
  const filePath = path.join(process.cwd(), filename);

  try {
    const text = readFileSync(filePath, "utf8");

    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      const value = rawValue.replace(/^["']|["']$/g, "");

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // The script also works with environment variables supplied by the shell.
  }
}

function timestamp() {
  const now = new Date();

  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
}

function safeName(value) {
  return (value || "ohne-name")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function extensionFromMime(mimeType) {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";

  return ".jpg";
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT?.replace(/\/+$/, "") ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (
    !endpoint ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET_NAME
  ) {
    return null;
  }

  return {
    bucket: process.env.R2_BUCKET_NAME,
    endpoint,
    client: new S3Client({
      region: "auto",
      endpoint,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    }),
  };
}

function filenameFromUploadUrl(imageUrl) {
  if (imageUrl.startsWith(uploadApiPrefix)) {
    return imageUrl.slice(uploadApiPrefix.length);
  }

  if (imageUrl.startsWith("/uploads/")) {
    return imageUrl.slice("/uploads/".length);
  }

  return null;
}

async function readImageBytes(imageUrl) {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") || "image/jpeg",
    };
  }

  const filename = filenameFromUploadUrl(imageUrl);

  if (!filename) {
    throw new Error(`Unbekannte Bild-URL: ${imageUrl}`);
  }

  const r2 = r2Config();

  if (r2 && imageUrl.startsWith(uploadApiPrefix)) {
    const object = await r2.client.send(
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: filename,
      }),
    );

    if (!object.Body) {
      throw new Error("R2-Objekt ohne Body");
    }

    const bytes = await object.Body.transformToByteArray();

    return {
      bytes: Buffer.from(bytes),
      mimeType: object.ContentType || "image/jpeg",
    };
  }

  const filePath = path.join(localUploadDir, filename);

  return {
    bytes: await readFile(filePath),
    mimeType: mimeTypeFromPath(filePath),
  };
}

function mimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";

  return "image/jpeg";
}

function jpegSize(bytes) {
  let offset = 2;

  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function pngSize(bytes) {
  const signature = "89504e470d0a1a0a";

  if (bytes.subarray(0, 8).toString("hex") !== signature) return null;

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function imageSize(bytes, mimeType) {
  if (mimeType.includes("png")) return pngSize(bytes);

  return jpegSize(bytes) || pngSize(bytes);
}

function assess(record, bytes, mimeType) {
  const size = imageSize(bytes, mimeType);
  const width = size?.width ?? null;
  const height = size?.height ?? null;
  const megapixels = width && height ? (width * height) / 1_000_000 : null;
  const minSide = width && height ? Math.min(width, height) : null;
  const quality =
    minSide === null
      ? "unklar"
      : minSide < 900 || (megapixels ?? 0) < 1.2
        ? "kritisch"
        : minSide < 1300 || (megapixels ?? 0) < 2.5
          ? "grenzwertig"
          : "ok";
  const objectType = record.kind === "page" ? record.objectType : record.kind;
  const recommendedAction =
    quality === "kritisch"
      ? "neu_fotografieren"
      : record.kind === "page" && record.objectType === "beleg"
        ? "beleg_sichten"
        : quality === "grenzwertig"
          ? "zur_sichtung"
          : "archivieren";

  return {
    objectType,
    quality,
    width,
    height,
    megapixels: megapixels === null ? null : Number(megapixels.toFixed(2)),
    sizeBytes: bytes.length,
    recommendedAction,
    notes: localAssessmentNote(record, quality, recommendedAction),
  };
}

function localAssessmentNote(record, quality, recommendedAction) {
  if (quality === "kritisch") {
    return "Lokale Vorpruefung: Aufloesung zu niedrig oder Bildgroesse unklar; vor Detailbewertung neu fotografieren.";
  }

  if (record.kind === "page" && record.objectType === "beleg") {
    return "Lokale Vorpruefung: als Beleg behandeln; Frankatur, Stempel und Vollstaendigkeit zusammen sichten.";
  }

  if (recommendedAction === "zur_sichtung") {
    return "Lokale Vorpruefung: brauchbar, aber fuer automatische Detailbewertung grenzwertig.";
  }

  return "Lokale Vorpruefung: Bild technisch brauchbar archiviert.";
}

function visionPrompt(record, assessment) {
  return [
    "Du bewertest ein Foto fuer eine Briefmarkenalbum-Eingabeplattform.",
    "Der Zielworkflow vermeidet Einzelmarkenfotos; bevorzugt werden Albumfoto, Albumseite oder Beleg.",
    "Antworte ausschliesslich als kompaktes JSON ohne Markdown.",
    "Schema:",
    '{"objectType":"album|albumseite|beleg|einzelmarke|unbrauchbar","captureQuality":"ok|grenzwertig|kritisch","completeness":"vollstaendig|teilweise_abgeschnitten|stark_abgeschnitten|unklar","recommendedAction":"archivieren|seite_akzeptieren|beleg_analysieren|neu_fotografieren|manuell_pruefen","stampCountEstimate":0,"postmarkVisible":false,"addressVisible":false,"issues":[""],"summary":""}',
    `Technische Vorpruefung: ${assessment.quality}, ${assessment.width || "?"}x${assessment.height || "?"}.`,
    `Datensatz: kind=${record.kind}, appObjectType=${record.objectType || "unbekannt"}, label=${record.label}.`,
    "Bewerte insbesondere: Ist die ganze Seite oder der ganze Beleg sichtbar? Gibt es abgeschnittene Marken? Stoeren Folienreflexe? Ist ein Beleg als Ganzes zu behandeln?",
  ].join("\n");
}

function normalizeVisionResult(value) {
  const fallback = {
    objectType: "unbrauchbar",
    captureQuality: "unklar",
    completeness: "unklar",
    recommendedAction: "manuell_pruefen",
    stampCountEstimate: 0,
    postmarkVisible: false,
    addressVisible: false,
    issues: ["Vision-Ausgabe konnte nicht sicher normalisiert werden."],
    summary: "",
  };

  if (!value || typeof value !== "object") return fallback;

  return {
    objectType: String(value.objectType || fallback.objectType),
    captureQuality: String(value.captureQuality || fallback.captureQuality),
    completeness: String(value.completeness || fallback.completeness),
    recommendedAction: String(value.recommendedAction || fallback.recommendedAction),
    stampCountEstimate: Number.isFinite(Number(value.stampCountEstimate))
      ? Number(value.stampCountEstimate)
      : fallback.stampCountEstimate,
    postmarkVisible: Boolean(value.postmarkVisible),
    addressVisible: Boolean(value.addressVisible),
    issues: Array.isArray(value.issues) ? value.issues.map(String) : fallback.issues,
    summary: String(value.summary || ""),
  };
}

async function analyzeWithOllama(record, image, assessment) {
  const response = await fetch(`${options.ollamaUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt: visionPrompt(record, assessment),
      images: [image.bytes.toString("base64")],
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const payload = await response.json();
  const text = payload.response || "{}";

  try {
    return normalizeVisionResult(JSON.parse(text));
  } catch {
    return {
      ...normalizeVisionResult(null),
      rawResponse: text,
    };
  }
}

function csvValue(value) {
  if (value === null || value === undefined) return "";

  return `"${String(value).replace(/"/g, '""')}"`;
}

async function collectRecords() {
  const albums = await prisma.album.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      pages: {
        orderBy: { pageNo: "asc" },
        include: {
          stamps: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  const records = [];

  for (const album of albums) {
    if (album.imageUrl) {
      records.push({
        kind: "album",
        id: album.id,
        albumId: album.id,
        albumName: album.name,
        label: "Albumfoto",
        imageUrl: album.imageUrl,
      });
    }

    for (const page of album.pages) {
      records.push({
        kind: "page",
        id: page.id,
        albumId: album.id,
        albumName: album.name,
        pageNo: page.pageNo,
        objectType: page.objectType,
        label: page.objectType === "beleg" ? `Beleg ${page.pageNo}` : `Seite ${page.pageNo}`,
        imageUrl: page.imageUrl,
      });

      for (const stamp of page.stamps) {
        records.push({
          kind: "stamp",
          id: stamp.id,
          albumId: album.id,
          albumName: album.name,
          pageNo: page.pageNo,
          objectType: "einzelmarke",
          label: `Einzelmarke ${stamp.id}`,
          imageUrl: stamp.cropUrl,
        });
      }
    }
  }

  return records;
}

async function main() {
  const outputRoot = path.join(process.cwd(), "exports", `intake-${timestamp()}`);
  const imageRoot = path.join(outputRoot, "images");
  const allRecords = await collectRecords();
  const records = options.limit ? allRecords.slice(0, options.limit) : allRecords;
  const manifest = [];

  await mkdir(imageRoot, { recursive: true });

  for (const [index, record] of records.entries()) {
    try {
      const image = await readImageBytes(record.imageUrl);
      const assessment = assess(record, image.bytes, image.mimeType);
      const albumDir = path.join(imageRoot, safeName(record.albumName));
      const extension = extensionFromMime(image.mimeType);
      const filename = `${String(index + 1).padStart(4, "0")}-${safeName(record.kind)}-${safeName(record.label)}-${record.id}${extension}`;
      const outputPath = path.join(albumDir, filename);

      await mkdir(albumDir, { recursive: true });
      await writeFile(outputPath, image.bytes);

      let visionAssessment = null;
      let visionError = null;

      if (options.vision === "ollama") {
        try {
          visionAssessment = await analyzeWithOllama(record, image, assessment);
        } catch (error) {
          visionError = error instanceof Error ? error.message : String(error);
        }
      }

      manifest.push({
        ...record,
        exportedPath: path.relative(outputRoot, outputPath),
        mimeType: image.mimeType,
        assessment,
        visionAssessment,
        visionError,
      });
    } catch (error) {
      manifest.push({
        ...record,
        exportedPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const csvHeader = [
    "kind",
    "albumName",
    "label",
    "objectType",
    "quality",
    "recommendedAction",
    "width",
    "height",
    "megapixels",
    "sizeBytes",
    "notes",
    "visionObjectType",
    "visionQuality",
    "visionCompleteness",
    "visionAction",
    "visionStampCount",
    "visionIssues",
    "visionSummary",
    "visionError",
    "exportedPath",
    "error",
  ];
  const csvRows = manifest.map((item) =>
    [
      item.kind,
      item.albumName,
      item.label,
      item.objectType || item.assessment?.objectType,
      item.assessment?.quality,
      item.assessment?.recommendedAction,
      item.assessment?.width,
      item.assessment?.height,
      item.assessment?.megapixels,
      item.assessment?.sizeBytes,
      item.assessment?.notes,
      item.visionAssessment?.objectType,
      item.visionAssessment?.captureQuality,
      item.visionAssessment?.completeness,
      item.visionAssessment?.recommendedAction,
      item.visionAssessment?.stampCountEstimate,
      item.visionAssessment?.issues?.join("; "),
      item.visionAssessment?.summary,
      item.visionError,
      item.exportedPath,
      item.error,
    ]
      .map(csvValue)
      .join(","),
  );

  await writeFile(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    path.join(outputRoot, "assessment.csv"),
    [csvHeader.join(","), ...csvRows].join("\n"),
  );

  console.log(`Exportiert: ${manifest.filter((item) => item.exportedPath).length}/${records.length}`);
  if (options.vision === "ollama") {
    console.log(`Vision: Ollama ${options.model} via ${options.ollamaUrl}`);
  }
  console.log(outputRoot);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
