import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const uploadApiPrefix = "/api/uploads/";
const localUploadDir = path.join(process.cwd(), "public", "uploads");
const warmupImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

loadEnvFile(".env");
loadEnvFile(".env.local");

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const prisma = new PrismaClient();

function parseArgs(args) {
  const parsed = {
    provider: "ollama",
    ollamaUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_VISION_MODEL || "llava:7b",
    keepAlive: process.env.OLLAMA_SESSION_KEEP_ALIVE || "30m",
    warmup: true,
    limit: 10,
    status: "wartet",
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") parsed.help = true;
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg.startsWith("--provider=")) parsed.provider = arg.slice("--provider=".length);
    if (arg.startsWith("--ollama-url=")) parsed.ollamaUrl = arg.slice("--ollama-url=".length);
    if (arg.startsWith("--model=")) parsed.model = arg.slice("--model=".length);
    if (arg.startsWith("--keep-alive=")) {
      parsed.keepAlive = arg.slice("--keep-alive=".length);
    }
    if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length));
    if (arg.startsWith("--status=")) parsed.status = arg.slice("--status=".length);
    if (arg === "--no-warmup") parsed.warmup = false;
  }

  if (parsed.provider !== "ollama") {
    throw new Error("--provider unterstuetzt aktuell nur ollama.");
  }

  if (!Number.isInteger(parsed.limit) || parsed.limit < 1) {
    throw new Error("--limit muss eine positive Ganzzahl sein.");
  }

  return parsed;
}

function printHelp() {
  console.log(`
Windows Analyse-Worker fuer StampApp-Seiten

Beispiele:
  npm.cmd run analyze:pages -- --dry-run --limit=3
  npm.cmd run analyze:pages -- --limit=20
  npm.cmd run analyze:pages -- --status=fehler --limit=5

Optionen:
  --provider=ollama       Lokale Vision-Analyse ueber Ollama
  --ollama-url=URL        Standard: http://127.0.0.1:11434
  --model=NAME            Standard: llava:7b
  --keep-alive=DAUER      Ollama-Modell warm halten, Standard: 30m
  --no-warmup             Warmup-Request vor der ersten Seite ueberspringen
  --status=STATUS         Page.analysisStatus Queue, Standard: wartet
  --limit=N               Maximale Anzahl Seiten, Standard: 10
  --dry-run               Analysieren, aber nicht in die DB schreiben
`);
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
    // Shell environment variables are enough.
  }
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

function mimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";

  return "image/jpeg";
}

async function readImageBytes(imageUrl) {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Bilddownload fehlgeschlagen: HTTP ${response.status}`);
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

  if (r2 && (imageUrl.startsWith(uploadApiPrefix) || imageUrl.startsWith("/uploads/"))) {
    const object = await r2.client.send(
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: filename,
      }),
    );

    if (!object.Body) {
      throw new Error("R2-Objekt ohne Body.");
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

function promptForPage(page) {
  const expectedObject =
    page.objectType === "beleg"
      ? "Das Bild wurde als vollstaendiger Beleg, Brief, Karte oder Dokument erfasst."
      : "Das Bild wurde als Albumseite mit mehreren Briefmarken erfasst.";

  return [
    "Du bist die getrennte Analysephase einer Briefmarken-Erfassungs-App.",
    "Die Webapp erfasst nur Fotos. Deine Aufgabe ist Triage und Rueckschreiben von Analysefeldern.",
    "Keine endgueltige Katalogbewertung, keine Echtheitszertifizierung.",
    expectedObject,
    "Antworte ausschliesslich als JSON ohne Markdown.",
    "Schema:",
    JSON.stringify({
      objectType: "albumseite|beleg|einzelmarke|unbrauchbar",
      captureQuality: "ok|grenzwertig|kritisch",
      completeness:
        "vollstaendig|vollstaendig_genug|teilweise_abgeschnitten|wesentlich_abgeschnitten|unklar",
      qualityFlags: [
        "unscharf",
        "schief_perspektive",
        "spiegelung_schatten",
        "zu_klein_aufgenommen",
        "rand_abgeschnitten",
        "bereich_fehlt",
        "teilweise_verdeckt",
        "schutzfolie_reflex",
        "ok",
      ],
      detectedItems: {
        stampCountEstimate: 0,
        postmarkCountEstimate: 0,
        addressVisible: false,
        specialCancelLikely: false,
        coverOrCardLikely: false,
      },
      recommendedAction:
        "akzeptieren|zur_sichtung|neu_fotografieren|einzelmarke_empfehlen|beleg_analysieren",
      singleStampExceptionSuggested: false,
      summary: "kurze deutsche Begruendung",
    }),
    "Regeln:",
    "- neu_fotografieren nur bei unbrauchbarer Schaerfe, wesentlichem Beschnitt oder fehlendem Bereich.",
    "- einzelmarke_empfehlen nur als Ausnahme, wenn eine konkrete Marke separat erfasst werden sollte.",
    "- beleg_analysieren fuer vollstaendige Briefe/Karten/Belege, deren Frankatur und Stempel zusammen bewertet werden muessen.",
    "- akzeptieren fuer brauchbare Seiten ohne dringenden manuellen Hinweis.",
    "- zur_sichtung fuer brauchbare, aber auffaellige oder unsichere Seiten.",
    `DB-Kontext: Seite ${page.pageNo}, objectType=${page.objectType}, Notiz=${page.notes || "keine"}.`,
  ].join("\n");
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function fallbackSummary(analysis) {
  const actionLabels = {
    akzeptieren: "Bild ist fuer die Analyse brauchbar.",
    zur_sichtung: "Bild ist brauchbar, sollte aber am PC gesichtet werden.",
    neu_fotografieren: "Bild sollte neu fotografiert werden.",
    einzelmarke_empfehlen: "Eine Einzelmarke sollte als Ausnahme separat erfasst werden.",
    beleg_analysieren: "Beleg sollte als Gesamtobjekt analysiert werden.",
  };
  const flags =
    analysis.qualityFlags.length > 0 && !analysis.qualityFlags.includes("ok")
      ? ` Hinweise: ${analysis.qualityFlags.join(", ")}.`
      : "";

  return `${actionLabels[analysis.recommendedAction] || actionLabels.zur_sichtung}${flags}`;
}

function normalizeAnalysis(value) {
  const source = value && typeof value === "object" ? value : {};
  const detectedItems =
    source.detectedItems && typeof source.detectedItems === "object"
      ? source.detectedItems
      : {};

  const normalized = {
    objectType: normalizeEnum(
      String(source.objectType || ""),
      ["albumseite", "beleg", "einzelmarke", "unbrauchbar"],
      "albumseite",
    ),
    captureQuality: normalizeEnum(
      String(source.captureQuality || ""),
      ["ok", "grenzwertig", "kritisch"],
      "grenzwertig",
    ),
    completeness: normalizeEnum(
      String(source.completeness || ""),
      [
        "vollstaendig",
        "vollstaendig_genug",
        "teilweise_abgeschnitten",
        "wesentlich_abgeschnitten",
        "unklar",
      ],
      "unklar",
    ),
    qualityFlags: Array.isArray(source.qualityFlags)
      ? source.qualityFlags.map(String).slice(0, 8)
      : ["ok"],
    detectedItems: {
      stampCountEstimate: Number.isFinite(Number(detectedItems.stampCountEstimate))
        ? Number(detectedItems.stampCountEstimate)
        : 0,
      postmarkCountEstimate: Number.isFinite(Number(detectedItems.postmarkCountEstimate))
        ? Number(detectedItems.postmarkCountEstimate)
        : 0,
      addressVisible: Boolean(detectedItems.addressVisible),
      specialCancelLikely: Boolean(detectedItems.specialCancelLikely),
      coverOrCardLikely: Boolean(detectedItems.coverOrCardLikely),
    },
    recommendedAction: normalizeEnum(
      String(source.recommendedAction || ""),
      [
        "akzeptieren",
        "zur_sichtung",
        "neu_fotografieren",
        "einzelmarke_empfehlen",
        "beleg_analysieren",
      ],
      "zur_sichtung",
    ),
    singleStampExceptionSuggested: Boolean(source.singleStampExceptionSuggested),
    summary: String(source.summary || ""),
  };

  if (!normalized.summary) {
    normalized.summary = fallbackSummary(normalized);
  }

  return normalized;
}

async function analyzeWithOllama(page, image) {
  const response = await fetch(`${options.ollamaUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt: promptForPage(page),
      images: [image.bytes.toString("base64")],
      stream: false,
      format: "json",
      keep_alive: options.keepAlive,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? `: ${body.slice(0, 500)}` : "";

    throw new Error(`Ollama HTTP ${response.status}${detail}`);
  }

  const payload = await response.json();
  const outputText = payload.response || "{}";
  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    parsed = {};
  }

  const normalized = normalizeAnalysis(parsed);

  return {
    data: normalized,
    raw: {
      provider: "ollama",
      model: options.model,
      keepAlive: options.keepAlive,
      outputText,
      parsed: normalized,
    },
  };
}

async function warmupOllama() {
  if (!options.warmup) return;

  const startedAt = Date.now();

  console.log(
    `Warmup: lade ${options.model} via ${options.ollamaUrl}, keep_alive=${options.keepAlive}`,
  );

  const response = await fetch(`${options.ollamaUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt: 'Antworte ausschliesslich als JSON: {"ok":true}',
      images: [warmupImageBase64],
      stream: false,
      format: "json",
      keep_alive: options.keepAlive,
      options: {
        num_predict: 20,
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? `: ${body.slice(0, 500)}` : "";

    throw new Error(`Ollama Warmup HTTP ${response.status}${detail}`);
  }

  await response.json();

  console.log(`Warmup fertig nach ${Math.round((Date.now() - startedAt) / 1000)}s.`);
}

function statusForAction(action) {
  if (action === "neu_fotografieren") return "nachfotografieren";
  if (action === "zur_sichtung" || action === "einzelmarke_empfehlen") {
    return "teilweise_erfasst";
  }

  return "fertig";
}

function analysisStatusForAction(action) {
  if (
    action === "neu_fotografieren" ||
    action === "zur_sichtung" ||
    action === "einzelmarke_empfehlen" ||
    action === "beleg_analysieren"
  ) {
    return "sichtung";
  }

  return "fertig";
}

function qualityForAnalysis(quality) {
  if (quality === "kritisch") return "nachfotografieren";
  if (quality === "grenzwertig") return "unbekannt";

  return "gut";
}

async function updateAlbumStatus(albumId) {
  const pages = await prisma.page.findMany({
    where: { albumId },
    select: {
      analysisStatus: true,
      status: true,
    },
  });

  if (pages.length === 0) return;

  const hasWaiting = pages.some((page) =>
    ["wartet", "laeuft", "fehler"].includes(page.analysisStatus),
  );
  const hasReview = pages.some(
    (page) =>
      page.analysisStatus === "sichtung" ||
      page.status === "teilweise_erfasst" ||
      page.status === "nachfotografieren",
  );
  const status = hasWaiting ? "auswertung" : hasReview ? "sichtung" : "fertig";

  await prisma.album.update({
    where: { id: albumId },
    data: { status },
  });
}

async function analyzePage(page) {
  console.log(`Analysiere ${page.album.name} / Seite ${page.pageNo} (${page.id})`);

  if (!options.dryRun) {
    await prisma.page.update({
      where: { id: page.id },
      data: { analysisStatus: "laeuft" },
    });
  }

  const image = await readImageBytes(page.imageUrl);
  const analysis = await analyzeWithOllama(page, image);
  const data = {
    objectType: analysis.data.objectType === "beleg" ? "beleg" : page.objectType,
    quality: qualityForAnalysis(analysis.data.captureQuality),
    status: statusForAction(analysis.data.recommendedAction),
    analysisStatus: analysisStatusForAction(analysis.data.recommendedAction),
    analysisNotes: analysis.data.summary,
    detectedRegions: analysis.data.detectedItems,
    analysisRaw: analysis.raw,
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ pageId: page.id, data, analysis: analysis.data }, null, 2));
    return { ok: true, dryRun: true };
  }

  await prisma.page.update({
    where: { id: page.id },
    data,
  });
  await updateAlbumStatus(page.albumId);

  console.log(`Fertig: ${data.analysisStatus} / ${data.status} / ${data.quality}`);

  return { ok: true };
}

async function markFailed(page, error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Fehler bei Seite ${page.id}: ${message}`);

  if (options.dryRun) return;

  await prisma.page.update({
    where: { id: page.id },
    data: {
      analysisStatus: "fehler",
      analysisNotes: message,
      analysisRaw: {
        provider: options.provider,
        model: options.model,
        error: message,
        failedAt: new Date().toISOString(),
      },
    },
  });
  await updateAlbumStatus(page.albumId);
}

async function main() {
  const pages = await prisma.page.findMany({
    where: {
      analysisStatus: options.status,
    },
    orderBy: [{ createdAt: "asc" }, { pageNo: "asc" }],
    take: options.limit,
    include: {
      album: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (pages.length === 0) {
    console.log(`Keine Seiten mit analysisStatus=${options.status}.`);
    return;
  }

  console.log(
    `${pages.length} Seite(n) gefunden. Provider=${options.provider}, Modell=${options.model}, keepAlive=${options.keepAlive}, dryRun=${options.dryRun}`,
  );

  let failed = 0;

  await warmupOllama();

  for (const page of pages) {
    try {
      await analyzePage(page);
    } catch (error) {
      failed += 1;
      await markFailed(page, error);
    }
  }

  console.log(`Analyse abgeschlossen. Erfolgreich=${pages.length - failed}, Fehler=${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
