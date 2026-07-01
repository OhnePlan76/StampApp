import { PrismaClient } from "@prisma/client";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

loadEnvFile(".env");
loadEnvFile(".env.local");

const prisma = new PrismaClient();
const options = parseArgs(process.argv.slice(2));
const packagesRoot = path.resolve(process.cwd(), options.source);
const uploadRoot = path.join(process.cwd(), "public", "uploads");

function parseArgs(args) {
  const parsed = {
    source: "tmp_album_review/chatgpt-pakete",
    dryRun: false,
    removeWrongAlbum: true,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    if (arg === "--keep-wrong-album") parsed.removeWrongAlbum = false;
    if (arg.startsWith("--source=")) parsed.source = arg.slice("--source=".length);
  }

  return parsed;
}

function printHelp() {
  console.log(`
Importiert lokale ChatGPT-Recherchepakete in bestehende Seiten.

Beispiele:
  node scripts/import-chatgpt-research.mjs --dry-run
  node scripts/import-chatgpt-research.mjs

Optionen:
  --source=PFAD          Paketwurzel, Standard tmp_album_review/chatgpt-pakete
  --dry-run              Nur zaehlen und Mapping ausgeben, keine DB-Schreibzugriffe
  --keep-wrong-album     Das alte Fehlimport-Album ChatGPT-Altbewertungen nicht loeschen
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

      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Shell-provided environment variables are enough.
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeFilePart(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function stampLabel(metadata) {
  const active = metadata.activeItem || {};
  const existing = cleanText(active.label) || cleanText(active.readable);
  const number = active.number ?? metadata.activeNumber ?? "?";

  return existing || `Recherchekandidat Nr. ${number}`;
}

function pageSummary(metadata) {
  const pageNo = metadata.pageNo ?? "?";
  const count = Array.isArray(metadata.reviewItems) ? metadata.reviewItems.length : 0;

  return `ChatGPT-Recherche: Seite ${pageNo}, ${count} Kandidat${count === 1 ? "" : "en"} fuer Sichtung.`;
}

function stampNotes(metadata, promptText) {
  const active = metadata.activeItem || {};
  const parts = [
    cleanText(active.note),
    cleanText(active.uncertain) ? `Unsicher: ${active.uncertain}` : "",
    cleanText(active.missing) ? `Fehlt/offen: ${active.missing}` : "",
    cleanText(metadata.note) ? `Paketnotiz: ${metadata.note}` : "",
    `Markierung: x=${active.x ?? "?"}, y=${active.y ?? "?"}, b=${active.w ?? "?"}, h=${active.h ?? "?"}`,
    promptText ? `Prompt fuer Detailanalyse:\n${promptText}` : "",
  ].filter(Boolean);

  return parts.join("\n\n") || null;
}

async function collectMetadataFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMetadataFiles(fullPath)));
    } else if (entry.name.endsWith("_metadata.json") && entry.name !== "index_metadata.json") {
      files.push(fullPath);
    }
  }

  return files;
}

async function readPrompt(packageDir, metadata) {
  const filename = metadata.files?.prompt;
  if (!filename) return "";

  const filePath = path.join(packageDir, filename);
  if (!existsSync(filePath)) return "";

  return readFile(filePath, "utf8");
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");

  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function copyPackageImage(packageDir, metadata, key, prefix) {
  const filename = metadata.files?.[key];
  if (!filename) return null;

  const source = path.join(packageDir, filename);
  if (!existsSync(source)) return null;

  const extension = path.extname(filename) || ".png";
  const basename = path.basename(filename, extension);
  const packageId = cleanText(metadata.packageId || metadata.sourcePackageId);
  const outputName = `${prefix}-${safeFilePart(packageId)}-${safeFilePart(basename)}${extension}`;
  const outputPath = path.join(uploadRoot, outputName);

  if (!options.dryRun) {
    await mkdir(uploadRoot, { recursive: true });
    await copyFile(source, outputPath);
  }

  return `/uploads/${outputName}`;
}

function sourceKey(metadata) {
  const activeNumber = cleanText(String(metadata.activeNumber || metadata.activeItem?.number || ""));

  return `${metadata.pageId}#${activeNumber}`;
}

function packageTime(metadata) {
  const createdAt = Date.parse(cleanText(metadata.createdAt));
  if (Number.isFinite(createdAt)) return createdAt;

  const packageId = cleanText(metadata.packageId || metadata.sourcePackageId);
  const match = packageId.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (!match) return 0;

  return Date.parse(`${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3")}Z`);
}

async function collectLatestMetadata(files) {
  const latest = new Map();

  for (const file of files) {
    const metadata = await readJson(file);
    if (!metadata.pageId) continue;

    const key = sourceKey(metadata);
    const existing = latest.get(key);

    if (!existing || packageTime(metadata) >= packageTime(existing.metadata)) {
      latest.set(key, { file, metadata });
    }
  }

  return [...latest.values()].sort((a, b) => {
    const pageCompare = Number(a.metadata.pageNo || 0) - Number(b.metadata.pageNo || 0);
    if (pageCompare !== 0) return pageCompare;

    return Number(a.metadata.activeNumber || a.metadata.activeItem?.number || 0) -
      Number(b.metadata.activeNumber || b.metadata.activeItem?.number || 0);
  });
}

async function removeWrongAlbum() {
  if (!options.removeWrongAlbum) return null;

  const album = await prisma.album.findFirst({
    where: { name: "ChatGPT-Altbewertungen" },
    select: { id: true, name: true },
  });

  if (!album) return null;

  if (!options.dryRun) {
    await prisma.album.delete({ where: { id: album.id } });
  }

  return album;
}

async function upsertResearchStamp(page, packageDir, metadata) {
  const prompt = await readPrompt(packageDir, metadata);
  const cropUrl =
    (await copyPackageImage(packageDir, metadata, "crop", "research-crop")) ||
    page.imageUrl;
  const key = sourceKey(metadata);
  const active = metadata.activeItem || {};
  const existing = page.stamps.find((stamp) => {
    const raw = stamp.analysisRaw;

    return (
      raw &&
      typeof raw === "object" &&
      raw.source === "tmp_album_review/chatgpt-pakete" &&
      raw.sourceKey === key
    );
  });
  const data = {
    cropUrl,
    notes: stampNotes(metadata, prompt),
    positionHint: `Seite ${metadata.pageNo}, Nr. ${active.number ?? metadata.activeNumber ?? "?"}`,
    manualCountryHint: null,
    manualConditionHint: cleanText(active.status) || "unsicher",
    status: "pruefbedarf",
    catalogHint: stampLabel(metadata),
    needsExpert: true,
    analysisRaw: {
      source: "tmp_album_review/chatgpt-pakete",
      sourceKey: key,
      packageId: metadata.packageId || metadata.sourcePackageId,
      createdAt: metadata.createdAt,
      pageId: metadata.pageId,
      pageNo: metadata.pageNo,
      targetType: metadata.targetType,
      activeItem: metadata.activeItem,
      files: metadata.files,
    },
  };

  if (options.dryRun) {
    return { created: !existing, updated: Boolean(existing), cropUrl };
  }

  if (existing) {
    await prisma.stamp.update({ where: { id: existing.id }, data });
    return { created: false, updated: true, cropUrl };
  }

  await prisma.stamp.create({
    data: {
      pageId: page.id,
      ...data,
    },
  });

  return { created: true, updated: false, cropUrl };
}

async function mergePageAnalysis(page, metadata) {
  const raw =
    page.analysisRaw && typeof page.analysisRaw === "object" && !Array.isArray(page.analysisRaw)
      ? page.analysisRaw
      : {};
  const packageId = metadata.packageId || metadata.sourcePackageId;
  const existingPackages = Array.isArray(raw.chatgptResearchPackages)
    ? raw.chatgptResearchPackages
    : [];
  const nextPackages = [
    ...existingPackages.filter((item) => item.packageId !== packageId),
    {
      packageId,
      createdAt: metadata.createdAt,
      targetType: metadata.targetType,
      reviewItems: metadata.reviewItems || [],
    },
  ];
  const existingNotes = cleanText(page.analysisNotes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("ChatGPT-Recherchepaket:"))
    .filter((line) => !line.startsWith("ChatGPT-Recherche:"))
    .join("\n");
  const notes = [existingNotes, pageSummary(metadata)]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n");

  if (options.dryRun) return;

  await prisma.page.update({
    where: { id: page.id },
    data: {
      status: page.status === "fertig" ? "teilweise_erfasst" : page.status,
      analysisStatus: "sichtung",
      analysisNotes: notes || page.analysisNotes,
      analysisRaw: {
        ...raw,
        chatgptResearchPackages: nextPackages,
      },
    },
  });
}

async function main() {
  if (options.help) {
    printHelp();
    return;
  }

  const wrongAlbum = await removeWrongAlbum();
  const files = await collectMetadataFiles(packagesRoot);
  const selected = await collectLatestMetadata(files);
  const stats = {
    dryRun: options.dryRun,
    removedWrongAlbum: wrongAlbum?.name || null,
    metadataFiles: files.length,
    selectedLatest: selected.length,
    matchedPages: 0,
    missingPages: 0,
    stampsCreated: 0,
    stampsUpdated: 0,
    preview: [],
  };

  for (const { file, metadata } of selected) {
    const page = await prisma.page.findUnique({
      where: { id: metadata.pageId },
      include: {
        stamps: true,
        album: { select: { name: true } },
      },
    });

    if (!page) {
      stats.missingPages += 1;
      continue;
    }

    stats.matchedPages += 1;

    const packageDir = path.dirname(file);
    const result = await upsertResearchStamp(page, packageDir, metadata);
    await mergePageAnalysis(page, metadata);

    if (result.created) stats.stampsCreated += 1;
    if (result.updated) stats.stampsUpdated += 1;

    if (stats.preview.length < 8) {
      stats.preview.push({
        album: page.album.name,
        pageNo: page.pageNo,
        label: stampLabel(metadata),
        cropUrl: result.cropUrl,
      });
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
