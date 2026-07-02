import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const port = Number(process.env.ANALYSIS_REVIEW_PORT || 5791);
const uploadApiPrefix = "/api/uploads/";
const localUploadDir = path.join(process.cwd(), "public", "uploads");
const packageExportDir = path.join(process.cwd(), "tmp_album_review", "chatgpt-pakete");
const packageZipDir = path.join(process.cwd(), "tmp_album_review", "chatgpt-zips");
const ocrTempDir = path.join(process.cwd(), "tmp_album_review", "ocr");
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_VISION_MODEL || "llava:7b";
const ollamaKeepAlive = process.env.OLLAMA_SESSION_KEEP_ALIVE || "30m";
const tesseractCommand =
  process.env.TESSERACT_CMD || "D:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const tesseractLanguages = process.env.TESSERACT_LANG || "eng";
const execFileAsync = promisify(execFile);

loadEnvFile(".env");
loadEnvFile(".env.local");

const prisma = new PrismaClient();

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
    // Environment variables supplied by the shell are enough.
  }
}

function itemColor(number) {
  const colors = [
    "#d64b2a",
    "#2563eb",
    "#17945a",
    "#a855f7",
    "#d97706",
    "#0891b2",
    "#be123c",
    "#4f46e5",
    "#65a30d",
    "#7c2d12",
  ];
  const index = Math.max(0, Number(number || 1) - 1) % colors.length;

  return colors[index];
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
  if (imageUrl.startsWith(uploadApiPrefix)) return imageUrl.slice(uploadApiPrefix.length);
  if (imageUrl.startsWith("/uploads/")) return imageUrl.slice("/uploads/".length);

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

    if (!response.ok) throw new Error(`Bilddownload HTTP ${response.status}`);

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") || "image/jpeg",
    };
  }

  const filename = filenameFromUploadUrl(imageUrl);

  if (!filename) throw new Error(`Unbekannte Bild-URL: ${imageUrl}`);

  const r2 = r2Config();

  if (r2 && (imageUrl.startsWith(uploadApiPrefix) || imageUrl.startsWith("/uploads/"))) {
    const object = await r2.client.send(
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: filename,
      }),
    );

    if (!object.Body) throw new Error("R2-Objekt ohne Body.");

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

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selected(current, value) {
  return current === value ? " selected" : "";
}

function checked(value) {
  return value ? " checked" : "";
}

function imageDataFromForm(value) {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) return null;

  return {
    bytes: Buffer.from(match[2], "base64"),
    mimeType: match[1],
  };
}

function parseCropImagesDraft(value) {
  try {
    const parsed = JSON.parse(value || "[]");

    if (!Array.isArray(parsed)) return new Map();

    return new Map(
      parsed
        .map((entry) => {
          const number = String(entry?.number || "").trim();
          const image = imageDataFromForm(String(entry?.cropImageData || ""));

          return number && image ? [number, image] : null;
        })
        .filter(Boolean),
    );
  } catch {
    return new Map();
  }
}

function optionList(values, current) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}"${selected(current, value)}>${escapeHtml(value)}</option>`)
    .join("");
}

function itemStatusOptionList(current) {
  const values = [
    ["gefunden", "gut lesbar"],
    ["unsicher", "teilweise / unsicher"],
    ["nicht_erkannt", "nicht lesbar"],
  ];

  return values
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${selected(current, value)}>${escapeHtml(label)}</option>`,
    )
    .join("");
}

function asJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function rawAnalysis(page) {
  const raw = asJsonObject(page.analysisRaw);
  const parsed = asJsonObject(raw.parsed);

  return {
    provider: raw.provider || "unbekannt",
    model: raw.model || "unbekannt",
    outputText: raw.outputText || "",
    parsed,
  };
}

function detectedItems(page) {
  const detected = asJsonObject(page.detectedRegions);

  return {
    stampCountEstimate: Number.isFinite(Number(detected.stampCountEstimate))
      ? Number(detected.stampCountEstimate)
      : 0,
    postmarkCountEstimate: Number.isFinite(Number(detected.postmarkCountEstimate))
      ? Number(detected.postmarkCountEstimate)
      : 0,
    addressVisible: Boolean(detected.addressVisible),
    specialCancelLikely: Boolean(detected.specialCancelLikely),
    coverOrCardLikely: Boolean(detected.coverOrCardLikely),
  };
}

function reviewItems(page) {
  const raw = asJsonObject(page.analysisRaw);
  const items = Array.isArray(raw.reviewItems) ? raw.reviewItems : [];

  if (items.length > 0) {
    const normalizedItems = items
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        number: Number.isFinite(Number(item.number)) ? Number(item.number) : index + 1,
        status: ["gefunden", "unsicher", "nicht_erkannt"].includes(item.status)
          ? item.status
          : "unsicher",
        label: String(item.label || ""),
        readable: String(item.readable || ""),
        uncertain: String(item.uncertain || ""),
        missing: String(item.missing || ""),
        note: String(item.note || ""),
        ocrText: String(item.ocrText || ""),
        ocrProvider: String(item.ocrProvider || ""),
        ocrLanguages: String(item.ocrLanguages || ""),
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
        needsExpert: Boolean(item.needsExpert),
        x: Number.isFinite(Number(item.x)) ? Number(item.x) : "",
        y: Number.isFinite(Number(item.y)) ? Number(item.y) : "",
        w: Number.isFinite(Number(item.w)) ? Number(item.w) : "",
        h: Number.isFinite(Number(item.h)) ? Number(item.h) : "",
      }))
      .filter(
        (item) =>
          item.label ||
          item.readable ||
          item.uncertain ||
          item.missing ||
          item.note ||
          Number(item.w) > 0 ||
          Number(item.h) > 0,
      );

    if (normalizedItems.length > 0) {
      return normalizedItems;
    }
  }

  const count = Math.min(Math.max(detectedItems(page).stampCountEstimate || 0, 1), 12);

  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    status: "unsicher",
    label: "",
    readable: "",
    uncertain: "",
    missing: "",
    note: "",
    x: "",
    y: "",
    w: "",
    h: "",
  }));
}

function compactText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) return text;

  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizedLabelFamily(label) {
  return String(label || "")
    .replace(/\b(LIRE|L\.?|EUR|EURO|CENT|C)\s*\d+([,.]\d+)?\b/gi, "")
    .replace(/\b\d+([,.]\d+)?\b/g, "")
    .replace(/[;:,.()/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function derivePageSummary(page, items) {
  const labels = items
    .map((item) => String(item.label || "").trim())
    .filter(Boolean);
  const readableParts = items
    .map((item) => String(item.readable || "").trim())
    .filter(Boolean);
  const count = items.filter((item) => item.label || item.readable || Number(item.w) > 0 || Number(item.h) > 0).length;

  if (labels.length === 0 && readableParts.length === 0) {
    return {
      title: `${page.objectType === "beleg" ? "Beleg" : "Seite"} ${page.pageNo}`,
      description: page.analysisNotes || "Noch keine importierten Markendetails.",
    };
  }

  const country = labels
    .map((label) => label.split(/\s+/)[0])
    .find((part) => part && part.length > 2) || "";
  const families = Array.from(
    new Set(
      labels
        .map(normalizedLabelFamily)
        .map((family) => country && family.toLowerCase().startsWith(country.toLowerCase()) ? family.slice(country.length).trim() : family)
        .filter(Boolean),
    ),
  ).slice(0, 3);
  const familyText = families.length > 0 ? families.join(" / ") : labels.slice(0, 2).join(" / ");
  const title = compactText([country, familyText].filter(Boolean).join(" - "), 96);
  const descriptionBase = labels.length > 0
    ? `${count} Markierungen: ${labels.slice(0, 6).join("; ")}`
    : `${count} Markierungen: ${readableParts.slice(0, 4).join("; ")}`;

  return {
    title: title || `${page.objectType === "beleg" ? "Beleg" : "Seite"} ${page.pageNo}`,
    description: compactText(descriptionBase, 260),
  };
}

function pageReviewTitle(page) {
  const raw = asJsonObject(page.analysisRaw);
  const title = compactText(raw.reviewTitle, 120);

  return title || `${page.album.name} / ${page.objectType === "beleg" ? "Beleg" : "Seite"} ${page.pageNo}`;
}

function pageReviewDescription(page) {
  const raw = asJsonObject(page.analysisRaw);
  const description = compactText(raw.reviewDescription || page.analysisNotes, 260);

  return description || "Keine Notiz";
}

async function readForm(req) {
  const chunks = [];

  for await (const chunk of req) chunks.push(chunk);

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function formText(form, key) {
  return String(form.get(key) || "").trim();
}

function formInt(form, key) {
  const value = Number(formText(form, key));

  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function formNumberOrBlank(form, key) {
  const rawValue = formText(form, key);

  if (!rawValue) return "";

  const value = rawValue.replace(",", ".");
  const number = Number(value);

  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : "";
}

function hasReviewBox(item) {
  return Number.isFinite(Number(item?.x)) &&
    Number.isFinite(Number(item?.y)) &&
    Number.isFinite(Number(item?.w)) &&
    Number.isFinite(Number(item?.h)) &&
    Number(item.w) > 0 &&
    Number(item.h) > 0;
}

function layout(content, title = "StampApp Analyse") {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f8;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #647184;
      --border: #dce2ea;
      --blue: #1f6feb;
      --blue-soft: #e9f1ff;
      --green: #137333;
      --gold: #8a5a00;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    .shell { display: grid; grid-template-columns: 288px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--border); background: #fbfcfe; padding: 14px; overflow: auto; }
    .main { padding: 14px; overflow: auto; }
    .top { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 1.35rem; }
    h2 { font-size: 1.1rem; }
    h3 { font-size: 1rem; }
    .muted { color: var(--muted); font-size: .9rem; }
    .filters { display: grid; gap: 8px; margin: 16px 0; }
    .filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .input, .textarea, select {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
      padding: 9px 10px;
    }
    .textarea { min-height: 96px; resize: vertical; line-height: 1.4; }
    .button {
      border: 0;
      border-radius: 6px;
      background: var(--blue);
      color: #fff;
      font-weight: 800;
      padding: 10px 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
    }
    .secondary-button { background: #eef2f7; color: var(--text); }
    .page-list { display: grid; gap: 8px; }
    .page-link {
      display: grid;
      gap: 5px;
      padding: 11px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .page-link.active { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft) inset; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: #eef2f7;
      color: var(--muted);
      font-size: .75rem;
      font-weight: 800;
      min-height: 23px;
      padding: 3px 8px;
    }
    .badge.fertig { background: #e7f5ec; color: var(--green); }
    .badge.sichtung { background: #fff2cc; color: var(--gold); }
    .badge.fehler, .badge.nachfotografieren { background: #fde8e7; color: var(--danger); }
    .review-grid { display: grid; grid-template-columns: minmax(560px, 1fr) clamp(320px, 24vw, 460px); gap: 14px; align-items: start; }
    .panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
    }
    .image-compare {
      display: grid;
      grid-template-columns: minmax(260px, .85fr) minmax(320px, 1.15fr);
      gap: 12px;
      align-items: start;
    }
    .image-frame h2 {
      margin-bottom: 8px;
      font-size: .95rem;
    }
    .image-stage {
      position: relative;
      overflow: hidden;
      border-radius: 6px;
      background: #111827;
    }
    .image-stage img {
      display: block;
      width: 100%;
      max-height: calc(100vh - 170px);
      object-fit: contain;
      -webkit-user-drag: none;
      user-select: none;
    }
    [data-overlay-layer] {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .overlay-box {
      position: absolute;
      border: 2px solid var(--item-color, rgba(255, 255, 255, .9));
      background: color-mix(in srgb, var(--item-color, #2563eb) 36%, transparent);
      display: grid;
      place-items: center;
      color: white;
      font-size: clamp(1.6rem, 4vw, 4.6rem);
      line-height: 1;
      text-shadow: 0 1px 4px rgba(0, 0, 0, .75);
      pointer-events: none;
    }
    .image-stage.markable {
      cursor: crosshair;
      user-select: none;
      touch-action: none;
    }
    .overlay-box.active {
      outline: 3px solid #fff;
      box-shadow: 0 0 0 3px var(--blue);
    }
    .form-grid { display: grid; gap: 12px; }
    .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: .83rem; font-weight: 700; }
    label span { color: var(--muted); }
    label.check { display: flex; align-items: center; gap: 8px; color: var(--text); }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f6f8fb;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      color: #293241;
      max-height: 260px;
      overflow: auto;
      font-size: .82rem;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .notice { border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 14px; }
    .dialog { display: grid; gap: 10px; margin-top: 16px; }
    .dialog-entry { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fbfcfe; }
    .dialog-entry.user { background: var(--blue-soft); border-color: #c7dbff; }
    .dialog-entry.pending { background: #fff8e1; border-color: #f0d98c; }
    .dialog-entry.error { background: #fde8e7; border-color: #f3b4ae; }
    .dialog-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-entry strong { display: block; margin-bottom: 4px; font-size: .82rem; color: var(--muted); }
    .dialog-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; font-size: .82rem; color: var(--muted); font-weight: 800; }
    .mark-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--text);
    }
    .mark-chip::before {
      content: "";
      width: 11px;
      height: 11px;
      border-radius: 3px;
      background: var(--item-color, var(--blue));
      box-shadow: 0 0 0 1px rgba(0,0,0,.12);
    }
    .image-dialog-panel {
      margin-top: 14px;
      border-top: 1px solid var(--border);
      padding-top: 14px;
    }
    .crop-preview {
      display: none;
      align-items: start;
      gap: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfcfe;
      padding: 10px;
    }
    .crop-preview.active {
      display: flex;
    }
    .crop-preview img {
      width: min(360px, 100%);
      max-height: 260px;
      object-fit: contain;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #111827;
    }
    .crop-preview strong {
      display: block;
      color: var(--text);
      margin-bottom: 3px;
    }
    .technical-details { margin-top: 18px; }
    .technical-details summary {
      cursor: pointer;
      font-weight: 900;
      color: var(--text);
      margin-bottom: 8px;
    }
    .dialog-status {
      display: none;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: .88rem;
      font-weight: 700;
    }
    .dialog-status.active { display: inline-flex; }
    .spinner {
      width: 16px;
      height: 16px;
      border-radius: 999px;
      border: 2px solid #c8d2df;
      border-top-color: var(--blue);
      animation: spin .8s linear infinite;
    }
    .button:disabled {
      opacity: .72;
      cursor: wait;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .item-table { display: grid; gap: 10px; margin-top: 10px; }
    .item-row {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      gap: 8px;
      align-items: end;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 34px 10px 10px;
      background: #fbfcfe;
      position: relative;
    }
    .item-row.active {
      border-color: var(--blue);
      box-shadow: 0 0 0 2px var(--blue-soft) inset;
      background: #fff;
    }
    .item-row .wide { grid-column: span 2; }
    .item-row.collapsed {
      grid-template-columns: 56px minmax(0, 1fr);
      align-items: center;
      padding-bottom: 10px;
    }
    .item-row.collapsed .field-status,
    .item-row.collapsed .field-readable,
    .item-row.collapsed .field-uncertain,
    .item-row.collapsed .field-missing,
    .item-row.collapsed .coord-row {
      display: none;
    }
    .item-row.collapsed .field-label {
      grid-column: auto;
    }
    .delete-item-button {
      position: absolute;
      top: 8px;
      right: 8px;
      border: 1px solid #f1b8b3;
      border-radius: 6px;
      background: #fff5f5;
      color: var(--danger);
      font-weight: 900;
      width: 28px;
      height: 28px;
      min-height: 0;
      line-height: 1;
      cursor: pointer;
    }
    .coord-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; min-width: 0; }
    .coord-row label { min-width: 0; }
    .tiny-button {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font-weight: 800;
      min-height: 34px;
      padding: 6px 9px;
      cursor: pointer;
    }
    @media (max-width: 960px) {
      .shell, .review-grid, .image-compare { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--border); max-height: 46vh; }
      .item-row { grid-template-columns: 1fr 1fr; }
      .item-row .wide { grid-column: span 2; }
    }
  </style>
</head>
<body>${content}${clientScript()}</body>
</html>`;
}

function clientScript() {
  return `<script>
(() => {
  const itemTable = document.querySelector("[data-item-table]");
  const addItemButton = document.querySelector("[data-add-item]");
  const packageForm = document.querySelector("[data-package-form]");
  const packageStatus = document.querySelector("[data-package-status]");
  const enrichButtons = Array.from(document.querySelectorAll("[data-ollama-enrich]"));
  const enrichStatus = document.querySelector("[data-ollama-enrich-status]");
  const ocrButtons = Array.from(document.querySelectorAll("[data-ocr-active]"));
  const ocrStatus = document.querySelector("[data-ocr-status]");
  const suggestButtons = Array.from(document.querySelectorAll("[data-suggest-stamps]"));
  const suggestStatus = document.querySelector("[data-suggest-status]");
  const markStage = document.querySelector("[data-mark-stage]");
  const overlayLayer = document.querySelector("[data-overlay-layer]");
  const cropPreview = document.querySelector("[data-crop-preview]");
  const cropPreviewImage = cropPreview?.querySelector("img") || null;
  let activeRow = itemTable?.querySelector("[data-item-row]") || null;

  function round(value) {
    return Math.max(0, Math.min(100, value)).toFixed(1).replace(/\\.0$/, "");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function imageContentRect() {
    if (!markStage) return null;

    const image = markStage.querySelector("img");
    if (!image) return null;

    const stageRect = markStage.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();

    if (stageRect.width <= 0 || stageRect.height <= 0 || imageRect.width <= 0 || imageRect.height <= 0) {
      return null;
    }

    let contentWidth = imageRect.width;
    let contentHeight = imageRect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      const naturalRatio = image.naturalWidth / image.naturalHeight;
      const boxRatio = imageRect.width / imageRect.height;

      if (boxRatio > naturalRatio) {
        contentWidth = imageRect.height * naturalRatio;
        offsetX = (imageRect.width - contentWidth) / 2;
      } else if (boxRatio < naturalRatio) {
        contentHeight = imageRect.width / naturalRatio;
        offsetY = (imageRect.height - contentHeight) / 2;
      }
    }

    return {
      left: imageRect.left - stageRect.left + offsetX,
      top: imageRect.top - stageRect.top + offsetY,
      width: contentWidth,
      height: contentHeight,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
    };
  }

  function pointerToImagePercent(event) {
    const rect = imageContentRect();
    if (!rect) return null;

    const stageRect = markStage.getBoundingClientRect();
    const x = clamp(event.clientX - stageRect.left - rect.left, 0, rect.width);
    const y = clamp(event.clientY - stageRect.top - rect.top, 0, rect.height);

    return {
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
    };
  }

  function rowField(row, field) {
    return row?.querySelector('[data-field="' + field + '"]') || null;
  }

  function rows() {
    return Array.from(document.querySelectorAll("[data-item-row]"));
  }

  function setActiveRow(row) {
    if (!row) return;
    rows().forEach((current) => {
      const isActive = current === row;
      current.classList.toggle("active", isActive);
      current.classList.toggle("collapsed", !isActive);
    });
    activeRow = row;
    renderMarkOverlay();
  }

  function nextIndex() {
    return rows().reduce((max, row) => Math.max(max, Number(row.dataset.index || 0)), -1) + 1;
  }

  function nextNumber() {
    return rows().reduce((max, row) => Math.max(max, Number(rowField(row, "number")?.value || 0)), 0) + 1;
  }

  function rowHasContent(row) {
    return Boolean(
      rowField(row, "label")?.value ||
      rowField(row, "readable")?.value ||
      rowField(row, "uncertain")?.value ||
      rowField(row, "missing")?.value ||
      Number(rowField(row, "w")?.value) > 0 ||
      Number(rowField(row, "h")?.value) > 0
    );
  }

  function reusableInitialRow() {
    const currentRows = rows();
    const row = currentRows[0];

    if (currentRows.length !== 1 || !row) return null;
    if (String(rowField(row, "number")?.value || "") !== "1") return null;

    return rowHasContent(row) ? null : row;
  }

  function itemRowHtml(index, number) {
    return \`
      <div class="item-row" data-item-row data-index="\${index}">
        <label class="field-number"><span>Nr.</span><input class="input" name="itemNumber_\${index}" data-field="number" type="number" min="1" value="\${number}" /></label>
        <label class="field-status"><span>Lesbarkeit</span><select name="itemStatus_\${index}" data-field="status"><option value="gefunden">gut lesbar</option><option value="unsicher" selected>teilweise / unsicher</option><option value="nicht_erkannt">nicht lesbar</option></select></label>
        <label class="wide field-label"><span>Kurzlabel</span><input class="input" name="itemLabel_\${index}" data-field="label" placeholder="z. B. BERTHA SUTTNER 1843-1914 S 1.50" /></label>
        <label class="wide field-readable"><span>Detailbeschreibung</span><input class="input" name="itemReadable_\${index}" data-field="readable" placeholder="Land; Nominale; Motiv; Inschrift; Zeitraum; Zustand" /></label>
        <label class="wide field-uncertain"><span>Unsichere Lesung</span><input class="input" name="itemUncertain_\${index}" data-field="uncertain" placeholder="nicht sicher lesbare oder vermutete Angaben" /></label>
        <label class="wide field-missing"><span>Abgleich / offen</span><input class="input" name="itemMissing_\${index}" data-field="missing" placeholder="Katalognummer, Ausgabe, Zaehnung, Wasserzeichen, DB-Abgleich" /></label>
        <input type="hidden" name="itemNote_\${index}" data-field="note" />
        <input type="hidden" name="itemOcrText_\${index}" data-field="ocrText" />
        <input type="hidden" name="itemOcrProvider_\${index}" data-field="ocrProvider" />
        <input type="hidden" name="itemOcrLanguages_\${index}" data-field="ocrLanguages" />
        <button class="delete-item-button" type="button" data-delete-item title="Nummer loeschen">x</button>
        <div class="wide coord-row">
          <label><span>x %</span><input class="input" name="itemX_\${index}" data-field="x" /></label>
          <label><span>y %</span><input class="input" name="itemY_\${index}" data-field="y" /></label>
          <label><span>b %</span><input class="input" name="itemW_\${index}" data-field="w" /></label>
          <label><span>h %</span><input class="input" name="itemH_\${index}" data-field="h" /></label>
        </div>
      </div>
    \`;
  }

  function addItem() {
    if (!itemTable) return null;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = itemRowHtml(nextIndex(), nextNumber()).trim();
    const row = wrapper.firstElementChild;
    itemTable.prepend(row);
    bindItemRow(row);
    setActiveRow(row);
    return row;
  }

  function rowOverlayData(row) {
    const x = Number(rowField(row, "x")?.value);
    const y = Number(rowField(row, "y")?.value);
    const w = Number(rowField(row, "w")?.value);
    const h = Number(rowField(row, "h")?.value);

    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

    return {
      number: rowField(row, "number")?.value || "?",
      status: rowField(row, "status")?.value || "unsicher",
      x,
      y,
      w,
      h,
      row,
    };
  }

  function colorForNumber(number) {
    const colors = [
      "#d64b2a",
      "#2563eb",
      "#17945a",
      "#a855f7",
      "#d97706",
      "#0891b2",
      "#be123c",
      "#4f46e5",
      "#65a30d",
      "#7c2d12",
    ];
    const index = Math.max(0, Number(number || 1) - 1) % colors.length;

    return colors[index];
  }

  function activeNumber() {
    return rowField(activeRow, "number")?.value || "";
  }

  function collectReviewItems() {
    return rows().map((row) => ({
      number: Number(rowField(row, "number")?.value || 0),
      status: rowField(row, "status")?.value || "unsicher",
      label: rowField(row, "label")?.value || "",
      readable: rowField(row, "readable")?.value || "",
      uncertain: rowField(row, "uncertain")?.value || "",
      missing: rowField(row, "missing")?.value || "",
      note: rowField(row, "note")?.value || "",
      ocrText: rowField(row, "ocrText")?.value || "",
      ocrProvider: rowField(row, "ocrProvider")?.value || "",
      ocrLanguages: rowField(row, "ocrLanguages")?.value || "",
      x: rowField(row, "x")?.value || "",
      y: rowField(row, "y")?.value || "",
      w: rowField(row, "w")?.value || "",
      h: rowField(row, "h")?.value || "",
      active: row === activeRow,
    })).filter((item) =>
      item.label ||
      item.readable ||
      item.uncertain ||
      item.missing ||
      item.note ||
      Number(item.w) > 0 ||
      Number(item.h) > 0
    );
  }

  function cropDataUrlForRow(row) {
    if (!markStage || !row) return "";

    const image = markStage.querySelector("img");
    const data = rowOverlayData(row);

    if (!image || !data || data.w <= 0 || data.h <= 0 || !image.naturalWidth || !image.naturalHeight) {
      return "";
    }

    const padding = 2;
    const sx = Math.max(0, ((data.x - padding) / 100) * image.naturalWidth);
    const sy = Math.max(0, ((data.y - padding) / 100) * image.naturalHeight);
    const sw = Math.min(image.naturalWidth - sx, ((data.w + padding * 2) / 100) * image.naturalWidth);
    const sh = Math.min(image.naturalHeight - sy, ((data.h + padding * 2) / 100) * image.naturalHeight);

    if (sw < 20 || sh < 20) return "";

    const canvas = document.createElement("canvas");
    const maxSide = 1280;
    const minSide = 420;
    const longestSide = Math.max(sw, sh);
    const shortestSide = Math.min(sw, sh);
    let scale = 1;

    if (longestSide > maxSide) {
      scale = maxSide / longestSide;
    } else if (shortestSide < minSide) {
      scale = Math.min(4, minSide / shortestSide);
    }
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");

    if (!ctx) return "";

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "contrast(1.12) saturate(1.05)";
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";

    return canvas.toDataURL("image/png");
  }

  function activeCropDataUrl() {
    return cropDataUrlForRow(activeRow);
  }

  function collectCropImages() {
    return rows()
      .map((row) => ({
        number: rowField(row, "number")?.value || "",
        cropImageData: cropDataUrlForRow(row),
      }))
      .filter((entry) => entry.number && entry.cropImageData);
  }

  function suggestStampBoxes() {
    const image = markStage?.querySelector("img");

    if (!image || !image.naturalWidth || !image.naturalHeight) {
      return [];
    }

    const canvas = document.createElement("canvas");
    const maxSide = 360;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) return [];

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(width * height);

    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    const edges = new Uint8Array(width * height);
    const threshold = 34;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const dx = Math.abs(gray[index + 1] - gray[index - 1]);
        const dy = Math.abs(gray[index + width] - gray[index - width]);

        if (dx + dy > threshold) edges[index] = 1;
      }
    }

    const visited = new Uint8Array(width * height);
    const boxes = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const start = y * width + x;
        if (!edges[start] || visited[start]) continue;

        const queue = [start];
        visited[start] = 1;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let count = 0;

        for (let q = 0; q < queue.length; q += 1) {
          const current = queue[q];
          const cx = current % width;
          const cy = Math.floor(current / width);
          count += 1;
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);

          const neighbors = [current - 1, current + 1, current - width, current + width];
          for (const next of neighbors) {
            if (next < 0 || next >= edges.length || visited[next] || !edges[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const area = bw * bh;
        const imageArea = width * height;
        const ratio = bw / Math.max(1, bh);

        if (
          count >= 18 &&
          area >= imageArea * 0.002 &&
          area <= imageArea * 0.22 &&
          bw >= width * 0.035 &&
          bh >= height * 0.035 &&
          ratio >= 0.35 &&
          ratio <= 2.4
        ) {
          const pad = 3;
          boxes.push({
            x: Math.max(0, ((minX - pad) / width) * 100),
            y: Math.max(0, ((minY - pad) / height) * 100),
            w: Math.min(100, ((bw + pad * 2) / width) * 100),
            h: Math.min(100, ((bh + pad * 2) / height) * 100),
            area,
          });
        }
      }
    }

    return boxes
      .sort((a, b) => b.area - a.area)
      .filter((box, index, all) =>
        all.findIndex((other) =>
          Math.abs(other.x - box.x) < 3 &&
          Math.abs(other.y - box.y) < 3 &&
          Math.abs(other.w - box.w) < 5 &&
          Math.abs(other.h - box.h) < 5
        ) === index
      )
      .slice(0, 24);
  }

  function applySuggestedStampBoxes() {
    const boxes = suggestStampBoxes();

    if (boxes.length === 0) {
      if (suggestStatus) {
        suggestStatus.textContent = "Keine klaren Rechteckvorschlaege gefunden.";
        suggestStatus.classList.add("active");
      }
      return;
    }

    for (const box of boxes) {
      const row = reusableInitialRow() || addItem();
      if (!row) continue;
      rowField(row, "status").value = "unsicher";
      rowField(row, "x").value = round(box.x);
      rowField(row, "y").value = round(box.y);
      rowField(row, "w").value = round(box.w);
      rowField(row, "h").value = round(box.h);
      rowField(row, "uncertain").value = appendUniqueText(
        rowField(row, "uncertain").value,
        "Automatischer Markierungsvorschlag; bitte Rahmen pruefen",
      );
    }

    if (suggestStatus) {
      suggestStatus.textContent = boxes.length + " Vorschlag" + (boxes.length === 1 ? "" : "e") + " eingefuegt.";
      suggestStatus.classList.add("active");
    }
    renderMarkOverlay();
  }

  function applyEnrichmentToRow(row, enrichment) {
    if (!row || !enrichment) return;
    const fields = ["label", "readable", "uncertain", "missing"];

    fields.forEach((field) => {
      const input = rowField(row, field);
      const value = enrichment[field];

      if (input && typeof value === "string" && value.trim()) {
        input.value = value.trim();
      }
    });

    renderMarkOverlay();
  }

  function appendUniqueText(current, next) {
    const existing = String(current || "").trim();
    const addition = String(next || "").trim();

    if (!addition) return existing;
    if (!existing) return addition;
    if (existing.toLowerCase().includes(addition.toLowerCase())) return existing;

    return existing + "; " + addition;
  }

  function applyOcrToRow(row, ocr) {
    if (!row || !ocr) return;

    const text = String(ocr.text || "").trim();
    const lines = Array.isArray(ocr.lines) ? ocr.lines.filter(Boolean) : [];
    const compact = lines.slice(0, 8).join("; ") || text.replace(/\\s+/g, " ").trim();
    const readable = rowField(row, "readable");
    const uncertain = rowField(row, "uncertain");
    const note = rowField(row, "note");
    const ocrText = rowField(row, "ocrText");
    const ocrProvider = rowField(row, "ocrProvider");
    const ocrLanguages = rowField(row, "ocrLanguages");

    if (readable && compact) {
      readable.value = appendUniqueText(readable.value, "OCR-Hinweis: " + compact);
    }

    if (uncertain) {
      uncertain.value = appendUniqueText(
        uncertain.value,
        "OCR ist unsicher und muss visuell geprueft werden",
      );
    }

    if (note) {
      note.value = appendUniqueText(note.value, "ocr:tesseract");
    }

    if (ocrText) ocrText.value = text;
    if (ocrProvider) ocrProvider.value = ocr.provider || "tesseract";
    if (ocrLanguages) ocrLanguages.value = ocr.languages || "";

    renderMarkOverlay();
  }

  function updateCropPreview() {
    if (!cropPreview || !cropPreviewImage) return;

    const dataUrl = activeCropDataUrl();
    if (!dataUrl) {
      cropPreview.classList.remove("active");
      cropPreviewImage.removeAttribute("src");
      return;
    }

    cropPreviewImage.src = dataUrl;
    cropPreview.classList.add("active");
  }

  function renderMarkOverlay() {
    if (!overlayLayer) return;
    overlayLayer.innerHTML = "";
    const rect = imageContentRect();

    rows().map(rowOverlayData).filter(Boolean).forEach((item) => {
      const box = document.createElement("div");
      box.className = \`overlay-box\${item.row === activeRow ? " active" : ""}\`;
      if (rect) {
        box.style.left = ((rect.left + (item.x / 100) * rect.width) / rect.stageWidth) * 100 + "%";
        box.style.top = ((rect.top + (item.y / 100) * rect.height) / rect.stageHeight) * 100 + "%";
        box.style.width = ((item.w / 100) * rect.width / rect.stageWidth) * 100 + "%";
        box.style.height = ((item.h / 100) * rect.height / rect.stageHeight) * 100 + "%";
      } else {
        box.style.left = item.x + "%";
        box.style.top = item.y + "%";
        box.style.width = item.w + "%";
        box.style.height = item.h + "%";
      }
      box.style.setProperty("--item-color", colorForNumber(item.number));
      box.textContent = item.number;
      overlayLayer.appendChild(box);
    });
    updateCropPreview();
  }

  function bindItemRow(row) {
    row.addEventListener("focusin", () => setActiveRow(row));
    row.addEventListener("click", () => setActiveRow(row));
    row.querySelector("[data-delete-item]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const number = rowField(row, "number")?.value || "?";

      if (!window.confirm("Nummer " + number + " wirklich loeschen?")) return;

      const wasActive = row === activeRow;
      row.remove();
      activeRow = null;
      const remaining = rows();
      if (wasActive && remaining.length > 0) {
        setActiveRow(remaining[0]);
      } else {
        renderMarkOverlay();
      }
    });
    row.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", renderMarkOverlay);
      input.addEventListener("change", renderMarkOverlay);
    });
  }

  rows().forEach(bindItemRow);
  if (activeRow) setActiveRow(activeRow);
  addItemButton?.addEventListener("click", addItem);
  const markImage = markStage?.querySelector("img");
  if (markImage) {
    markImage.draggable = false;
    markImage.addEventListener("dragstart", (event) => event.preventDefault());
    markImage.addEventListener("load", renderMarkOverlay);
  }
  window.addEventListener("resize", renderMarkOverlay);

  if (markStage) {
    let drag = null;

    markStage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = pointerToImagePercent(event);
      const row = event.shiftKey
        ? reusableInitialRow() || addItem()
        : activeRow || reusableInitialRow();
      if (!row || !start) return;

      markStage.setPointerCapture(event.pointerId);
      setActiveRow(row);
      drag = {
        pointerId: event.pointerId,
        row,
        startX: start.x,
        startY: start.y,
      };
    });

    markStage.addEventListener("pointermove", (event) => {
      if (!drag || !drag.row) return;
      event.preventDefault();
      const current = pointerToImagePercent(event);
      if (!current) return;
      const currentX = current.x;
      const currentY = current.y;
      const x = Math.min(drag.startX, currentX);
      const y = Math.min(drag.startY, currentY);
      const w = Math.abs(currentX - drag.startX);
      const h = Math.abs(currentY - drag.startY);

      rowField(drag.row, "x").value = round(x);
      rowField(drag.row, "y").value = round(y);
      rowField(drag.row, "w").value = round(w);
      rowField(drag.row, "h").value = round(h);
      renderMarkOverlay();
    });

    markStage.addEventListener("pointerup", (event) => {
      if (drag?.pointerId === event.pointerId) {
        event.preventDefault();
        if (markStage.hasPointerCapture(event.pointerId)) {
          markStage.releasePointerCapture(event.pointerId);
        }
        drag = null;
      }
    });

    markStage.addEventListener("pointercancel", (event) => {
      if (drag?.pointerId === event.pointerId) {
        if (markStage.hasPointerCapture(event.pointerId)) {
          markStage.releasePointerCapture(event.pointerId);
        }
        drag = null;
      }
    });
  }

  packageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const row = activeRow || addItem();
    const submitter = event.submitter;
    const exportMode = submitter?.value === "all" ? "all" : "single";
    const cropDataUrl = activeCropDataUrl();
    const cropImages = exportMode === "all" ? collectCropImages() : [];
    const buttons = Array.from(packageForm.querySelectorAll("button[type='submit']"));
    const button = buttons.includes(submitter) ? submitter : buttons[0];

    if (exportMode === "single" && (!row || !cropDataUrl)) {
      window.alert("Bitte zuerst eine Nummer auswaehlen und im Bewertungsbild einen Rahmen ziehen.");
      return;
    }

    if (exportMode === "all" && cropImages.length === 0) {
      window.alert("Bitte zuerst mindestens eine Markierung im Bewertungsbild aufziehen.");
      return;
    }

    try {
      const body = new URLSearchParams();
      const formData = new FormData(packageForm);

      for (const [key, value] of formData.entries()) {
        body.set(key, String(value));
      }

      body.set("exportMode", exportMode);
      body.set("cropImageData", cropDataUrl);
      body.set("cropImagesDraft", JSON.stringify(cropImages));
      body.set("reviewItemsDraft", JSON.stringify(collectReviewItems()));
      body.set("activeNumber", rowField(row, "number")?.value || "");

      const pageId = document.querySelector("[data-page-id]")?.value;
      buttons.forEach((current) => {
        current.disabled = true;
      });
      if (button) {
        button.textContent = exportMode === "all" ? "Exportiere alle ..." : "Exportiere ...";
      }
      if (packageStatus) {
        packageStatus.textContent = exportMode === "all" ? "Sammelpaket wird lokal erstellt ..." : "Paket wird lokal erstellt ...";
        packageStatus.classList.add("active");
      }

      const response = await fetch("/pages/" + encodeURIComponent(pageId) + "/export-package", {
        method: "POST",
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Paketexport fehlgeschlagen.");
      }

      if (packageStatus) {
        packageStatus.textContent = "Exportiert: " + (payload.zipPath || payload.packagePath || "Paket erstellt");
      }
    } catch (error) {
      if (packageStatus) {
        packageStatus.textContent = error instanceof Error ? error.message : "Paketexport fehlgeschlagen.";
      }
      window.alert(error instanceof Error ? error.message : "Paketexport fehlgeschlagen.");
    } finally {
      buttons.forEach((current) => {
        current.disabled = false;
      });
      const singleButton = packageForm.querySelector("button[value='single']");
      const allButton = packageForm.querySelector("button[value='all']");
      if (singleButton) singleButton.textContent = "Paket fuer ChatGPT exportieren";
      if (allButton) allButton.textContent = "Alle Markierungen als Sammelpaket";
    }
  });

  async function enrichActiveRow() {
    const row = activeRow || addItem();
    const cropDataUrl = activeCropDataUrl();

    if (!row || !cropDataUrl) {
      window.alert("Bitte zuerst eine Nummer auswaehlen und im Bewertungsbild einen Rahmen ziehen.");
      return;
    }

    const pageId = document.querySelector("[data-page-id]")?.value;
    const body = new URLSearchParams();
    body.set("cropImageData", cropDataUrl);
    body.set("reviewItemsDraft", JSON.stringify(collectReviewItems()));
    body.set("activeNumber", rowField(row, "number")?.value || "");

    try {
      enrichButtons.forEach((button) => {
        button.disabled = true;
        button.textContent = "Analysiert ...";
      });
      if (enrichStatus) {
        enrichStatus.textContent = "Lokale Anreicherung laeuft ...";
        enrichStatus.classList.add("active");
      }

      const response = await fetch("/pages/" + encodeURIComponent(pageId) + "/enrich-review-item", {
        method: "POST",
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Ollama-Anreicherung fehlgeschlagen.");
      }

      applyEnrichmentToRow(row, payload.enrichment);
      if (enrichStatus) {
        enrichStatus.textContent = "Textfelder wurden lokal vorausgefuellt. Bitte pruefen und speichern.";
      }
    } catch (error) {
      if (enrichStatus) {
        enrichStatus.textContent = error instanceof Error ? error.message : "Ollama-Anreicherung fehlgeschlagen.";
      }
      window.alert(error instanceof Error ? error.message : "Ollama-Anreicherung fehlgeschlagen.");
    } finally {
      enrichButtons.forEach((button) => {
        button.disabled = false;
        button.textContent = "Aktive Markierung fuellen";
      });
    }
  }

  enrichButtons.forEach((button) => button.addEventListener("click", enrichActiveRow));
  suggestButtons.forEach((button) => button.addEventListener("click", applySuggestedStampBoxes));

  async function ocrActiveRow() {
    const row = activeRow || addItem();
    const cropDataUrl = activeCropDataUrl();

    if (!row || !cropDataUrl) {
      window.alert("Bitte zuerst eine Nummer auswaehlen und im Bewertungsbild einen Rahmen ziehen.");
      return;
    }

    const pageId = document.querySelector("[data-page-id]")?.value;
    const body = new URLSearchParams();
    body.set("cropImageData", cropDataUrl);
    body.set("reviewItemsDraft", JSON.stringify(collectReviewItems()));
    body.set("activeNumber", rowField(row, "number")?.value || "");

    try {
      ocrButtons.forEach((button) => {
        button.disabled = true;
        button.textContent = "OCR laeuft ...";
      });
      if (ocrStatus) {
        ocrStatus.textContent = "Tesseract liest die aktive Markierung ...";
        ocrStatus.classList.add("active");
      }

      const response = await fetch("/pages/" + encodeURIComponent(pageId) + "/ocr-review-item", {
        method: "POST",
        body,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "OCR fehlgeschlagen.");
      }

      applyOcrToRow(row, payload.ocr);
      if (ocrStatus) {
        const count = Array.isArray(payload.ocr?.lines) ? payload.ocr.lines.length : 0;
        ocrStatus.textContent = count > 0 ? "OCR-Hinweis eingetragen. Bitte pruefen." : "OCR fertig, aber ohne sicheren Text.";
      }
    } catch (error) {
      if (ocrStatus) {
        ocrStatus.textContent = error instanceof Error ? error.message : "OCR fehlgeschlagen.";
      }
      window.alert(error instanceof Error ? error.message : "OCR fehlgeschlagen.");
    } finally {
      ocrButtons.forEach((button) => {
        button.disabled = false;
        button.textContent = "OCR lesen";
      });
    }
  }

  ocrButtons.forEach((button) => button.addEventListener("click", ocrActiveRow));

})();
</script>`;
}

async function renderHome(url) {
  const status = url.searchParams.get("status") || "sichtung";
  const selectedId = url.searchParams.get("pageId") || "";
  const where = status === "all" ? {} : { analysisStatus: status };
  const pages = await prisma.page.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { pageNo: "asc" }],
    take: 80,
    include: {
      album: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  const selectedPage =
    pages.find((page) => page.id === selectedId) ||
    pages[0] ||
    null;

  return layout(`
    <div class="shell">
      <aside class="sidebar">
        <div class="top">
          <div>
            <h1>Analyse Review</h1>
            <div class="muted">Lokale Windows-Oberflaeche, DB-Rueckgabe nur Textdaten.</div>
          </div>
        </div>
        <form class="filters" method="get" action="/">
          <div class="filter-row">
            <select class="input" name="status">
              ${optionList(["sichtung", "fertig", "fehler", "wartet", "all"], status)}
            </select>
            <button class="button secondary-button" type="submit">Filtern</button>
          </div>
        </form>
        <div class="page-list">
          ${
            pages.length === 0
              ? '<div class="notice">Keine Eintraege fuer diesen Filter.</div>'
              : pages
                  .map(
                    (page) => `
                      <a class="page-link ${selectedPage?.id === page.id ? "active" : ""}" href="/?status=${encodeURIComponent(status)}&pageId=${encodeURIComponent(page.id)}">
                        <strong>${escapeHtml(pageReviewTitle(page))}</strong>
                        <span class="muted">${escapeHtml(pageReviewDescription(page))}</span>
                        <span class="badges">
                          <span class="badge ${escapeHtml(page.analysisStatus)}">${escapeHtml(page.analysisStatus)}</span>
                          <span class="badge ${escapeHtml(page.status)}">${escapeHtml(page.status)}</span>
                          ${page.quality ? `<span class="badge">${escapeHtml(page.quality)}</span>` : ""}
                        </span>
                      </a>
                    `,
                  )
                  .join("")
          }
        </div>
      </aside>
      <main class="main">
        ${selectedPage ? renderPageDetail(selectedPage, status) : '<div class="notice">Waehle links einen Eintrag.</div>'}
      </main>
    </div>
  `);
}

function renderPageDetail(page, filterStatus) {
  const raw = rawAnalysis(page);
  const detected = detectedItems(page);
  const parsed = raw.parsed;
  const items = reviewItems(page);

  return `
    <div class="top">
      <div>
        <h1>${escapeHtml(pageReviewTitle(page))}</h1>
        <div class="muted">${escapeHtml(page.album.name)} / ${escapeHtml(page.objectType === "beleg" ? "Beleg" : "Seite")} ${escapeHtml(page.pageNo)}</div>
      </div>
      <a class="button secondary-button" href="/?status=${encodeURIComponent(filterStatus)}">Liste aktualisieren</a>
    </div>
    <div class="review-grid">
      <section class="panel image-panel">
        <div class="image-compare">
          <div class="image-frame">
            <h2>Bewertungsbild</h2>
            <div class="image-stage markable" data-mark-stage>
              <img src="/image/${encodeURIComponent(page.id)}" alt="Markiertes Bewertungsbild" />
              <div data-overlay-layer>${renderOverlayItems(items)}</div>
            </div>
          </div>
          <div class="image-frame">
            <h2>Export-Ausschnitt</h2>
            <div class="crop-preview" data-crop-preview>
              <img alt="Ausschnitt fuer das Exportpaket" />
              <div>
                <strong>Aktive Markierung</strong>
                <span class="muted">Diese Vorschau wird als Bilddatei ins Paket geschrieben und kann vorher per OCR gelesen werden.</span>
              </div>
            </div>
          </div>
        </div>
        <div class="image-dialog-panel">
          <h2>Nummerierte Datenpruefung</h2>
          <div class="muted">Zeile auswaehlen, dann im Bewertungsbild ein Rechteck aufziehen. Jede Nummer bekommt eine eigene Farbe; Lesbarkeit wird in der Zeile dokumentiert.</div>
          <div class="actions" style="margin-top:10px">
            <button class="tiny-button" type="button" data-add-item>+ Nummer hinzufuegen</button>
            <button class="tiny-button" type="button" data-suggest-stamps>Marken vorschlagen</button>
            <button class="tiny-button" type="button" data-ocr-active>OCR lesen</button>
            <span class="dialog-status" data-suggest-status></span>
            <span class="dialog-status" data-ocr-status></span>
          </div>
        </div>
        <div class="image-dialog-panel">
          <h2>ChatGPT-Paket exportieren</h2>
          <div class="muted">Markierung waehlen, Typ setzen und optional eine Notiz ergaenzen. Die App erstellt lokal ein Paket fuer dein ChatGPT-Projekt.</div>
          <form class="form-grid" style="margin-top:12px" method="post" action="/pages/${encodeURIComponent(page.id)}/export-package" data-package-form>
            <input type="hidden" name="filterStatus" value="${escapeHtml(filterStatus)}" />
            <label>
              <span>Typ des Ausschnitts</span>
              <select class="input" name="targetType" data-target-type>
                <option value="einzelmarke">Einzelmarke</option>
                <option value="brief">Brief / Beleg</option>
                <option value="albumseite">Albumseite</option>
                <option value="sonstiges">Sonstiges</option>
              </select>
            </label>
            <label>
              <span>Notiz / Auftrag fuer ChatGPT</span>
              <textarea class="textarea" name="packageNote" placeholder="z. B. bitte Schrift zuerst transkribieren, dann Land/Ausgabe/Wert vorsichtig einschaetzen"></textarea>
            </label>
            <div class="actions">
              <button class="button" type="submit" name="exportMode" value="single">Paket fuer ChatGPT exportieren</button>
              <button class="button secondary-button" type="submit" name="exportMode" value="all">Alle Markierungen als Sammelpaket</button>
              <span class="dialog-status active" data-package-status>Bereit fuer Export.</span>
            </div>
          </form>
        </div>
        <div class="image-dialog-panel">
          <h2>ChatGPT-Ergebnis einspielen</h2>
          <div class="muted">JSON-Antwort aus dem Sammelpaket einfuegen. Die Zuordnung erfolgt ueber activeNumber oder number; bestehende Koordinaten bleiben erhalten.</div>
          <form class="form-grid" style="margin-top:12px" method="post" action="/pages/${encodeURIComponent(page.id)}/import-chatgpt-results">
            <input type="hidden" name="filterStatus" value="${escapeHtml(filterStatus)}" />
            <label>
              <span>JSON-Ergebnis</span>
              <textarea class="textarea" name="chatGptResultJson" placeholder='[{"activeNumber":"1","label":"...","readable":"..."}]'></textarea>
            </label>
            <div class="actions">
              <button class="button secondary-button" type="submit">Ergebnis in DB einspielen</button>
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <form class="form-grid" method="post" action="/pages/${encodeURIComponent(page.id)}">
          <input type="hidden" name="filterStatus" value="${escapeHtml(filterStatus)}" />
          <input type="hidden" data-page-id value="${escapeHtml(page.id)}" />
          <div class="two">
            <label>
              <span>Objekttyp</span>
              <select name="objectType">${optionList(["albumseite", "beleg"], page.objectType)}</select>
            </label>
            <label>
              <span>Bildqualitaet</span>
              <select name="quality">${optionList(["gut", "unbekannt", "nachfotografieren"], page.quality || "unbekannt")}</select>
            </label>
          </div>
          <div class="two">
            <label>
              <span>Bearbeitungsstatus</span>
              <select name="status">${optionList(["offen", "teilweise_erfasst", "fertig", "nachfotografieren"], page.status)}</select>
            </label>
            <label>
              <span>Analyse-Status</span>
              <select name="analysisStatus">${optionList(["wartet", "sichtung", "fertig", "fehler"], page.analysisStatus)}</select>
            </label>
          </div>
          <label>
            <span>Review-Notiz fuer die Webapp</span>
            <textarea class="textarea" name="analysisNotes">${escapeHtml(page.analysisNotes || "")}</textarea>
          </label>
          <div class="two">
            <label>
              <span>Stempel geschaetzt</span>
              <input class="input" name="postmarkCountEstimate" type="number" min="0" value="${escapeHtml(detected.postmarkCountEstimate)}" />
            </label>
            <label>
              <span>Seite</span>
              <input class="input" value="${escapeHtml(page.pageNo)}" disabled />
            </label>
          </div>
          <div class="two">
            <label class="check"><input type="checkbox" name="addressVisible"${checked(detected.addressVisible)} /> Adresse sichtbar</label>
            <label class="check"><input type="checkbox" name="specialCancelLikely"${checked(detected.specialCancelLikely)} /> Sonderstempel moeglich</label>
            <label class="check"><input type="checkbox" name="coverOrCardLikely"${checked(detected.coverOrCardLikely)} /> Beleg/Karte wahrscheinlich</label>
          </div>
          <div class="item-table" data-item-table>
            ${[...items]
              .sort((a, b) => Number(b.number || 0) - Number(a.number || 0))
              .map((item, index) => renderReviewItemRow(item, index))
              .join("")}
          </div>
          <div class="actions">
            <button class="button" type="submit">Status speichern</button>
            <a class="button secondary-button" href="${escapeHtml(page.imageUrl)}" target="_blank" rel="noreferrer">Original-Link</a>
          </div>
        </form>
        <details class="technical-details">
          <summary>Technische Analysegrundlage</summary>
          <pre>${escapeHtml(JSON.stringify({
            parsed,
            detectedRegions: page.detectedRegions,
            rawOutput: raw.outputText,
          }, null, 2))}</pre>
        </details>
      </section>
    </div>
  `;
}

function renderOverlayItems(items) {
  return items
    .filter(
      (item) =>
        Number.isFinite(Number(item.x)) &&
        Number.isFinite(Number(item.y)) &&
        Number.isFinite(Number(item.w)) &&
        Number.isFinite(Number(item.h)) &&
        Number(item.w) > 0 &&
        Number(item.h) > 0,
    )
    .map(
      (item) => `
        <div
          class="overlay-box"
          style="left:${escapeHtml(item.x)}%;top:${escapeHtml(item.y)}%;width:${escapeHtml(item.w)}%;height:${escapeHtml(item.h)}%;--item-color:${escapeHtml(itemColor(item.number))};"
        >${escapeHtml(item.number)}</div>
      `,
    )
    .join("");
}

function renderReviewItemRow(item, index) {
  return `
    <div class="item-row" data-item-row data-index="${escapeHtml(index)}">
      <label class="field-number">
        <span>Nr.</span>
        <input class="input" name="itemNumber_${index}" data-field="number" type="number" min="1" value="${escapeHtml(item.number)}" />
      </label>
      <label class="field-status">
        <span>Lesbarkeit</span>
        <select name="itemStatus_${index}" data-field="status">
          ${itemStatusOptionList(item.status)}
        </select>
      </label>
      <label class="wide field-label">
        <span>Kurzlabel</span>
        <input class="input" name="itemLabel_${index}" data-field="label" value="${escapeHtml(item.label)}" placeholder="z. B. BERTHA SUTTNER 1843-1914 S 1.50" />
      </label>
      <label class="wide field-readable">
        <span>Detailbeschreibung</span>
        <input class="input" name="itemReadable_${index}" data-field="readable" value="${escapeHtml(item.readable)}" placeholder="Land; Nominale; Motiv; Inschrift; Zeitraum; Zustand" />
      </label>
      <label class="wide field-uncertain">
        <span>Unsichere Lesung</span>
        <input class="input" name="itemUncertain_${index}" data-field="uncertain" value="${escapeHtml(item.uncertain)}" placeholder="nicht sicher lesbare oder vermutete Angaben" />
      </label>
      <label class="wide field-missing">
        <span>Abgleich / offen</span>
        <input class="input" name="itemMissing_${index}" data-field="missing" value="${escapeHtml(item.missing)}" placeholder="Katalognummer, Ausgabe, Zaehnung, Wasserzeichen, DB-Abgleich" />
      </label>
      <button class="delete-item-button" type="button" data-delete-item title="Nummer loeschen">x</button>
      <input type="hidden" name="itemNote_${index}" data-field="note" value="${escapeHtml(item.note || "")}" />
      <input type="hidden" name="itemOcrText_${index}" data-field="ocrText" value="${escapeHtml(item.ocrText || "")}" />
      <input type="hidden" name="itemOcrProvider_${index}" data-field="ocrProvider" value="${escapeHtml(item.ocrProvider || "")}" />
      <input type="hidden" name="itemOcrLanguages_${index}" data-field="ocrLanguages" value="${escapeHtml(item.ocrLanguages || "")}" />
      <input type="hidden" name="itemConfidence_${index}" value="${escapeHtml(item.confidence ?? "")}" />
      <input type="hidden" name="itemNeedsExpert_${index}" value="${escapeHtml(item.needsExpert ? "true" : "false")}" />
      <div class="wide coord-row">
        <label>
          <span>x %</span>
          <input class="input" name="itemX_${index}" data-field="x" value="${escapeHtml(item.x)}" />
        </label>
        <label>
          <span>y %</span>
          <input class="input" name="itemY_${index}" data-field="y" value="${escapeHtml(item.y)}" />
        </label>
        <label>
          <span>b %</span>
          <input class="input" name="itemW_${index}" data-field="w" value="${escapeHtml(item.w)}" />
        </label>
        <label>
          <span>h %</span>
          <input class="input" name="itemH_${index}" data-field="h" value="${escapeHtml(item.h)}" />
        </label>
      </div>
    </div>
  `;
}

async function handleSave(req, res, pageId) {
  const form = await readForm(req);
  const filterStatus = formText(form, "filterStatus") || "sichtung";
  const existing = await prisma.page.findUnique({
    where: { id: pageId },
  });

  if (!existing) {
    send(res, 404, layout('<div class="notice">Seite nicht gefunden.</div>'));
    return;
  }

  const currentRaw = asJsonObject(existing.analysisRaw);
  const currentParsed = asJsonObject(currentRaw.parsed);
  const currentDetected = detectedItems(existing);
  const detectedRegions = {
    stampCountEstimate: currentDetected.stampCountEstimate,
    postmarkCountEstimate: formInt(form, "postmarkCountEstimate"),
    addressVisible: form.has("addressVisible"),
    specialCancelLikely: form.has("specialCancelLikely"),
    coverOrCardLikely: form.has("coverOrCardLikely"),
  };
  const items = parseReviewItems(form);
  const review = {
    reviewedAt: new Date().toISOString(),
    source: "local-analysis-review",
    singleStampExceptionSuggested: Boolean(currentParsed.singleStampExceptionSuggested),
  };

  await prisma.page.update({
    where: { id: pageId },
    data: {
      objectType: formText(form, "objectType") === "beleg" ? "beleg" : "albumseite",
      quality: formText(form, "quality") || null,
      status: formText(form, "status") || "offen",
      analysisStatus: formText(form, "analysisStatus") || "sichtung",
      analysisNotes: formText(form, "analysisNotes") || null,
      detectedRegions,
      analysisRaw: {
        ...currentRaw,
        parsed: {
          ...currentParsed,
          detectedItems: detectedRegions,
          singleStampExceptionSuggested: review.singleStampExceptionSuggested,
        },
        review,
        reviewItems: items,
      },
    },
  });

  await updateAlbumStatus(existing.albumId);
  redirect(res, `/?status=${encodeURIComponent(filterStatus)}&pageId=${encodeURIComponent(pageId)}`);
}

function parseReviewItems(form) {
  const items = [];

  for (let index = 0; index < 60; index += 1) {
    const numberValue = formText(form, `itemNumber_${index}`);
    const number = Number.isFinite(Number(numberValue)) ? Number(numberValue) : items.length + 1;
    const label = formText(form, `itemLabel_${index}`);
    const readable = formText(form, `itemReadable_${index}`);
    const uncertain = formText(form, `itemUncertain_${index}`);
    const missing = formText(form, `itemMissing_${index}`);
    const note = formText(form, `itemNote_${index}`);
    const ocrText = formText(form, `itemOcrText_${index}`);
    const ocrProvider = formText(form, `itemOcrProvider_${index}`);
    const ocrLanguages = formText(form, `itemOcrLanguages_${index}`);
    const confidenceValue = formText(form, `itemConfidence_${index}`);
    const confidence = Number(confidenceValue);
    const needsExpert = formText(form, `itemNeedsExpert_${index}`) === "true";
    const x = formNumberOrBlank(form, `itemX_${index}`);
    const y = formNumberOrBlank(form, `itemY_${index}`);
    const w = formNumberOrBlank(form, `itemW_${index}`);
    const h = formNumberOrBlank(form, `itemH_${index}`);
    const hasBox = Number(w) > 0 && Number(h) > 0;
    const hasContent =
      label ||
      readable ||
      uncertain ||
      missing ||
      note ||
      ocrText ||
      hasBox;

    if (!hasContent || number <= 0) continue;

    const status = formText(form, `itemStatus_${index}`);

    items.push({
      number,
      status: ["gefunden", "unsicher", "nicht_erkannt"].includes(status)
        ? status
        : "unsicher",
      label,
      readable,
      uncertain,
        missing,
        note,
        ocrText,
        ocrProvider,
        ocrLanguages,
        confidence: Number.isFinite(confidence) ? confidence : null,
        needsExpert,
        x,
        y,
        w,
      h,
    });
  }

  return items;
}

function parseDraftReviewItems(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        number: Number.isFinite(Number(item.number)) && Number(item.number) > 0
          ? Number(item.number)
          : index + 1,
        status: ["gefunden", "unsicher", "nicht_erkannt"].includes(item.status)
          ? item.status
          : "unsicher",
        label: String(item.label || ""),
        readable: String(item.readable || ""),
        uncertain: String(item.uncertain || ""),
        missing: String(item.missing || ""),
        note: String(item.note || ""),
        ocrText: String(item.ocrText || ""),
        ocrProvider: String(item.ocrProvider || ""),
        ocrLanguages: String(item.ocrLanguages || ""),
        x: item.x === "" ? "" : Number(item.x),
        y: item.y === "" ? "" : Number(item.y),
        w: item.w === "" ? "" : Number(item.w),
        h: item.h === "" ? "" : Number(item.h),
        active: Boolean(item.active),
      }))
      .filter(
        (item) =>
          item.label ||
          item.readable ||
          item.uncertain ||
          item.missing ||
          item.note ||
          item.ocrText ||
          Number(item.w) > 0 ||
          Number(item.h) > 0,
      );
  } catch {
    return [];
  }
}

function safePathPart(value, fallback = "paket") {
  const text = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return text || fallback;
}

function extensionForMimeType(mimeType) {
  if (/png/i.test(mimeType)) return ".png";
  if (/webp/i.test(mimeType)) return ".webp";
  if (/gif/i.test(mimeType)) return ".gif";

  return ".jpg";
}

async function zipDirectory(sourceDir, destinationZip) {
  await mkdir(path.dirname(destinationZip), { recursive: true });
  const sourceLiteral = sourceDir.replace(/'/g, "''");
  const destinationLiteral = destinationZip.replace(/'/g, "''");

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      `$Source = '${sourceLiteral}'`,
      `$Destination = '${destinationLiteral}'`,
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }",
      "[System.IO.Compression.ZipFile]::CreateFromDirectory($Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)",
    ].join("; "),
  ]);
}

function importableResultSchemaText(arrayMode = false) {
  const item = {
    activeNumber: 1,
    label: "kurzes sichtbares Label",
    readable: "sicher sichtbare Schrift, Nominale, Land/Gebiet, Motiv, Stempel",
    uncertain: "unsichere Lesungen mit Fragezeichen",
    missing: "offene Pruefpunkte, z. B. Zaehnung, Wasserzeichen, Rueckseite",
    country: "Land/Gebiet oder null",
    era: "Zeitraum/Epoche oder null",
    denomination: "Nennwert/Waehrung oder null",
    motive: "Motiv/Bildinhalt oder null",
    usedState: "postfrisch|ungebraucht|gebraucht|Brief/Beleg|unklar",
    condition: "sichtbarer Zustand, Maengel, Stempel, Falz, Gumminfo",
    catalogHint: "vorsichtiger Katalog-/Ausgabehinweis ohne endgueltige Nummer",
    valueClass: 0,
    valueMin: null,
    valueMax: null,
    needsExpert: false,
    confidence: 0.0,
    requiredFollowUp: [
      "none|front_detail|back_side|watermark_backlight|perforation_detail|postmark_detail|cover_context|better_photo",
    ],
    followUpReason: "warum Zusatzbild oder Pruefung noetig ist",
    note: "kurze Begruendung der Wertklasse und naechster Schritt",
  };

  return JSON.stringify(arrayMode ? [item] : item, null, 2);
}

function packagePromptText({
  page,
  targetType,
  note,
  activeNumber,
  activeItem,
  cropFile = "crop.png",
  pageFile = "seite.*",
  metadataFile = "metadata.json",
}) {
  return [
    "# Analyseauftrag fuer ChatGPT",
    "",
    "Bitte analysiere den beigefuegten Briefmarken-Ausschnitt vorsichtig philatelistisch.",
    "",
    "Wichtig:",
    "- Zuerst sichtbare Schrift, Zahlen, Nominale, Land/Gebiet und Jahreszahlen transkribieren.",
    "- Unsichere Lesungen mit Fragezeichen markieren.",
    "- Keine definitive Katalognummer behaupten, wenn sie nicht sicher aus Bild und Abgleich hervorgeht.",
    "- Keine Wertpruefung oder Markttriage ausgeben; das folgt spaeter im DB-Gesamtabgleich.",
    "- Wenn der Ausschnitt zu unscharf/klein ist, klar sagen, welche Nachaufnahme noetig ist.",
    "- OCR-Hinweise sind nur Vorschlaege und koennen falsch sein; bitte immer visuell gegen das Bild pruefen.",
    "",
    "Gewuenschtes Antwortformat:",
    "1. Kurze menschenlesbare Einschaetzung.",
    "2. Danach exakt ein importierbares JSON-Objekt in einem ```json Codeblock.",
    "Keine Felder weglassen. Unbekannte Werte als null oder leeren String schreiben.",
    "",
    "Importierbares JSON-Schema:",
    importableResultSchemaText(false),
    "",
    "Kontext:",
    `Album: ${page.album.name}`,
    `Seite: ${page.pageNo}`,
    `Objekttyp der Seite: ${page.objectType}`,
    `Typ des Ausschnitts: ${targetType}`,
    `Aktive Nummer: ${activeNumber || "unbekannt"}`,
    note ? `Notiz/Auftrag: ${note}` : "Notiz/Auftrag: keine",
    activeItem
      ? `Aktuelle Markierung: x=${activeItem.x}, y=${activeItem.y}, b=${activeItem.w}, h=${activeItem.h}`
      : "Aktuelle Markierung: nicht angegeben",
    activeItem?.label ? `Bisheriges Kurzlabel: ${activeItem.label}` : "",
    activeItem?.readable ? `Bisherige Details: ${activeItem.readable}` : "",
    activeItem?.uncertain ? `Bisher unsicher: ${activeItem.uncertain}` : "",
    activeItem?.missing ? `Bisher offen: ${activeItem.missing}` : "",
    activeItem?.ocrText ? `OCR-Vorschlag (${activeItem.ocrProvider || "tesseract"} ${activeItem.ocrLanguages || ""}): ${activeItem.ocrText}` : "",
    "",
    "Dateien im Paket:",
    `- ${cropFile}: der markierte Ausschnitt fuer die Detailanalyse`,
    `- ${pageFile}: die vollstaendige Seite als Kontext`,
    `- ${metadataFile}: strukturierte Daten aus der Review-App`,
  ].filter(Boolean).join("\n");
}

function packageCollectionPromptText({ page, targetType, note, items, pageFile }) {
  return [
    "# Sammelauftrag fuer ChatGPT",
    "",
    "Bitte analysiere die beigefuegten Briefmarken-Ausschnitte einzeln und verwende die vollstaendige Seite nur als Kontext.",
    "",
    "Wichtig:",
    "- Jede Nummer separat beantworten.",
    "- Zuerst sichtbare Schrift, Zahlen, Nominale, Land/Gebiet und Jahreszahlen transkribieren.",
    "- Unsichere Lesungen mit Fragezeichen markieren.",
    "- Keine definitive Katalognummer behaupten, wenn sie nicht sicher aus Bild und Abgleich hervorgeht.",
    "- Keine Wertpruefung oder Markttriage ausgeben; das folgt spaeter im DB-Gesamtabgleich.",
    "- OCR-Hinweise sind nur Vorschlaege und koennen falsch sein; bitte immer visuell gegen die Bilder pruefen.",
    "",
    "Gewuenschtes Antwortformat pro Nummer:",
    "1. Kurze menschenlesbare Einschaetzung pro Nummer.",
    "2. Danach exakt ein importierbares JSON-Array in einem ```json Codeblock.",
    "Keine Felder weglassen. Unbekannte Werte als null oder leeren String schreiben.",
    "",
    "Importierbares JSON-Schema:",
    importableResultSchemaText(true),
    "",
    "Kontext:",
    `Album: ${page.album.name}`,
    `Seite: ${page.pageNo}`,
    `Objekttyp der Seite: ${page.objectType}`,
    `Typ der Ausschnitte: ${targetType}`,
    note ? `Notiz/Auftrag: ${note}` : "Notiz/Auftrag: keine",
    "",
    "Enthaltene Markierungen:",
    ...items.map((item) => {
      const ocrHint = item.ocrText ? `, OCR-Vorschlag: ${item.ocrText}` : "";

      return `- Nr. ${item.number}: ${item.cropFile}, ${item.metadataFile}, ${item.promptFile}${ocrHint}`;
    }),
    `- ${pageFile}: die vollstaendige Seite als Kontext`,
    "- index_metadata.json: Uebersicht ueber das Sammelpaket",
  ].join("\n");
}

function reviewItemEnrichmentPrompt({ page, activeNumber, activeItem }) {
  return [
    "Du bist ein vorsichtiger philatelistischer Analyse-Assistent.",
    "Analysiere ausschliesslich den beigefuegten Bildausschnitt einer einzelnen Briefmarke.",
    "Nutze sichtbare Schrift, Zahlen, Nominale, Land/Gebiet, Motiv und Jahreszahlen.",
    "Nominale/Wertangaben wie LIRE 15, L.10, 60 C usw. sind besonders wichtig und muessen in label und readable erscheinen, wenn sichtbar.",
    "Rate nicht. Unsichere Lesungen mit ? markieren.",
    "Keine definitive Katalognummer, Echtheit oder seltene Variante behaupten.",
    "Keine Wertpruefung oder Markttriage ausgeben; das folgt spaeter im DB-Gesamtabgleich.",
    "Gib ausschliesslich ein JSON-Objekt zurueck.",
    "Alle Textfelder muessen einfache Strings sein, keine Listen und keine verschachtelten Objekte.",
    "Wenn du nichts Sicheres erkennst, schreibe einen kurzen leeren/unsicheren String statt Platzhalter.",
    "",
    "Kontext:",
    `Album: ${page.album.name}`,
    `Seite: ${page.pageNo}`,
    `Aktive Nummer: ${activeNumber || "unbekannt"}`,
    activeItem?.label ? `Bisheriges Kurzlabel: ${activeItem.label}` : "",
    activeItem?.readable ? `Bisherige Details: ${activeItem.readable}` : "",
    "",
    "JSON-Format:",
    JSON.stringify({
      label: "",
      readable: "",
      uncertain: "",
      missing: "",
      confidence: 0.0,
      needsExpert: false,
    }, null, 2),
  ].filter(Boolean).join("\n");
}

function textFromOllamaValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map(textFromOllamaValue)
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nestedValue]) => {
        const text = textFromOllamaValue(nestedValue);

        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }

  return "";
}

function cleanEnrichmentText(value) {
  const text = textFromOllamaValue(value)
    .replace(/\s+/g, " ")
    .trim();
  const placeholders = new Set([
    "kurzes deutsches label",
    "sichtbare schrift und belastbare details",
    "unsichere lesungen oder leer",
    "was fuer sichere bestimmung noch fehlt",
    "grobe einordnung/triage, vorsichtig",
    "[object object]",
  ]);

  return placeholders.has(text.toLowerCase()) ? "" : text;
}

function normalizeReviewItemEnrichment(source) {
  const object = asJsonObject(source);
  const confidence = Number(object.confidence);

  return {
    label: cleanEnrichmentText(object.label),
    readable: cleanEnrichmentText(object.readable),
    uncertain: cleanEnrichmentText(object.uncertain),
    missing: cleanEnrichmentText(object.missing),
    note: cleanEnrichmentText(object.note),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    needsExpert: Boolean(object.needsExpert),
  };
}

function extractJsonFromText(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) throw new Error("Kein JSON eingefuegt.");

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];

  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  candidates.push(trimmed);

  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) candidates.push(trimmed.slice(firstArray, lastArray + 1));

  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(trimmed.slice(firstObject, lastObject + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON shape.
    }
  }

  throw new Error("Das eingefuegte Ergebnis ist kein gueltiges JSON.");
}

function importedResultItemsFromText(text) {
  const parsed = extractJsonFromText(text);
  const sourceItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.results)
        ? parsed.results
        : [parsed];

  return sourceItems
    .map((entry) => {
      const object = asJsonObject(entry);
      const number = Number(object.activeNumber ?? object.number ?? object.nr ?? object.Nr);
      const confidence = Number(object.confidence);

      if (!Number.isFinite(number) || number <= 0) return null;

      return {
        number,
        label: cleanEnrichmentText(object.label ?? object.kurzlabel ?? object.title),
        readable: cleanEnrichmentText(object.readable ?? object.detailbeschreibung ?? object.details ?? object.text),
        uncertain: cleanEnrichmentText(object.uncertain ?? object.unsichereLesung ?? object.unsicher),
        missing: cleanEnrichmentText(object.missing ?? object.abgleichOffen ?? object.offen),
        note: cleanEnrichmentText(object.note ?? object.notiz ?? object.einordnung),
        country: cleanEnrichmentText(object.country ?? object.land),
        era: cleanEnrichmentText(object.era ?? object.epoche ?? object.zeitraum),
        denomination: cleanEnrichmentText(object.denomination ?? object.nennwert),
        motive: cleanEnrichmentText(object.motive ?? object.motiv),
        usedState: cleanEnrichmentText(object.usedState ?? object.verwendung),
        condition: cleanEnrichmentText(object.condition ?? object.zustand),
        catalogHint: cleanEnrichmentText(object.catalogHint ?? object.kataloghinweis),
        valueClass: Number.isFinite(Number(object.valueClass)) ? Math.max(0, Math.min(5, Number(object.valueClass))) : null,
        valueMin: Number.isFinite(Number(object.valueMin)) ? Number(object.valueMin) : null,
        valueMax: Number.isFinite(Number(object.valueMax)) ? Number(object.valueMax) : null,
        requiredFollowUp: Array.isArray(object.requiredFollowUp)
          ? object.requiredFollowUp.map(cleanEnrichmentText).filter(Boolean)
          : cleanEnrichmentText(object.requiredFollowUp)
            ? [cleanEnrichmentText(object.requiredFollowUp)]
            : [],
        followUpReason: cleanEnrichmentText(object.followUpReason ?? object.zusatzfotoGrund),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
        needsExpert: Boolean(object.needsExpert),
        packageId: cleanEnrichmentText(object.packageId),
      };
    })
    .filter(Boolean);
}

function mergeImportedReviewItems(existingItems, importedItems) {
  const byNumber = new Map(existingItems.map((item) => [String(item.number), { ...item }]));

  for (const imported of importedItems) {
    const key = String(imported.number);
    const current = byNumber.get(key) || {
      number: imported.number,
      status: "unsicher",
      label: "",
      readable: "",
      uncertain: "",
      missing: "",
      note: "",
      ocrText: "",
      ocrProvider: "",
      ocrLanguages: "",
      x: "",
      y: "",
      w: "",
      h: "",
    };

    const merged = {
      ...current,
      label: imported.label || current.label || "",
      readable: imported.readable || current.readable || "",
      uncertain: imported.uncertain || current.uncertain || "",
      missing: imported.missing || current.missing || "",
      note: imported.note || current.note || "",
      country: imported.country || current.country || "",
      era: imported.era || current.era || "",
      denomination: imported.denomination || current.denomination || "",
      motive: imported.motive || current.motive || "",
      usedState: imported.usedState || current.usedState || "",
      condition: imported.condition || current.condition || "",
      catalogHint: imported.catalogHint || current.catalogHint || "",
      valueClass: imported.valueClass ?? current.valueClass ?? null,
      valueMin: imported.valueMin ?? current.valueMin ?? null,
      valueMax: imported.valueMax ?? current.valueMax ?? null,
      requiredFollowUp:
        imported.requiredFollowUp.length > 0
          ? imported.requiredFollowUp
          : Array.isArray(current.requiredFollowUp)
            ? current.requiredFollowUp
            : [],
      followUpReason: imported.followUpReason || current.followUpReason || "",
      status: imported.label || imported.readable ? "gefunden" : current.status,
    };

    if (imported.confidence !== null) merged.confidence = imported.confidence;
    if (imported.needsExpert) merged.needsExpert = true;

    byNumber.set(key, merged);
  }

  return Array.from(byNumber.values()).sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

async function enrichReviewItemWithOllama({ page, cropImage, activeNumber, activeItem }) {
  const response = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: reviewItemEnrichmentPrompt({ page, activeNumber, activeItem }),
      images: [cropImage.bytes.toString("base64")],
      stream: false,
      format: "json",
      keep_alive: ollamaKeepAlive,
      options: {
        temperature: 0,
      },
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

  return {
    enrichment: normalizeReviewItemEnrichment(parsed),
    raw: {
      provider: "ollama",
      model: ollamaModel,
      keepAlive: ollamaKeepAlive,
      outputText,
    },
  };
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function runTesseractOcr(cropImage) {
  await mkdir(ocrTempDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inputPath = path.join(ocrTempDir, `ocr-${stamp}.png`);

  await writeFile(inputPath, cropImage.bytes);

  try {
    const { stdout, stderr } = await execFileAsync(
      tesseractCommand,
      [
        inputPath,
        "stdout",
        "-l",
        tesseractLanguages,
        "--psm",
        "6",
        "--oem",
        "1",
      ],
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    const text = normalizeOcrText(stdout);

    return {
      provider: "tesseract",
      command: tesseractCommand,
      languages: tesseractLanguages,
      text,
      lines: text ? text.split("\n") : [],
      stderr: String(stderr || "").trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Tesseract OCR fehlgeschlagen: ${message}`);
  }
}

async function handleOcrReviewItem(req, res, pageId) {
  const form = await readForm(req);
  const cropImage = imageDataFromForm(formText(form, "cropImageData"));
  const activeNumber = formText(form, "activeNumber");

  if (!cropImage) {
    sendJson(res, 400, { error: "Bitte zuerst eine Markierung im Bewertungsbild aufziehen." });
    return;
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true },
  });

  if (!page) {
    sendJson(res, 404, { error: "Seite nicht gefunden." });
    return;
  }

  try {
    const ocr = await runTesseractOcr(cropImage);

    sendJson(res, 200, {
      ok: true,
      activeNumber,
      ocr,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error instanceof Error ? error.message : "OCR fehlgeschlagen.",
    });
  }
}

async function handleEnrichReviewItem(req, res, pageId) {
  const form = await readForm(req);
  const cropImage = imageDataFromForm(formText(form, "cropImageData"));
  const draftItems = parseDraftReviewItems(formText(form, "reviewItemsDraft"));
  const activeNumber = formText(form, "activeNumber");
  const activeItem =
    draftItems.find((item) => String(item.number) === String(activeNumber)) ||
    draftItems.find((item) => Boolean(item.active)) ||
    null;

  if (!cropImage) {
    sendJson(res, 400, { error: "Bitte zuerst eine Markierung im Bewertungsbild aufziehen." });
    return;
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      album: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!page) {
    sendJson(res, 404, { error: "Seite nicht gefunden." });
    return;
  }

  try {
    const result = await enrichReviewItemWithOllama({
      page,
      cropImage,
      activeNumber,
      activeItem,
    });

    sendJson(res, 200, {
      ok: true,
      activeNumber,
      enrichment: result.enrichment,
      raw: result.raw,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error instanceof Error ? error.message : "Ollama-Anreicherung fehlgeschlagen.",
    });
  }
}

async function handleImportChatGptResults(req, res, pageId) {
  const form = await readForm(req);
  const filterStatus = formText(form, "filterStatus") || "sichtung";
  const resultText = formText(form, "chatGptResultJson");
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      album: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!page) {
    send(res, 404, layout('<div class="notice">Seite nicht gefunden.</div>'));
    return;
  }

  let importedItems;

  try {
    importedItems = importedResultItemsFromText(resultText);
  } catch (error) {
    send(
      res,
      400,
      layout(`<div class="notice">Import fehlgeschlagen: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`),
    );
    return;
  }

  if (importedItems.length === 0) {
    send(res, 400, layout('<div class="notice">Import fehlgeschlagen: Keine Nummern in activeNumber/number gefunden.</div>'));
    return;
  }

  const currentRaw = asJsonObject(page.analysisRaw);
  const imports = Array.isArray(currentRaw.chatGptResultImports) ? currentRaw.chatGptResultImports : [];
  const mergedItems = mergeImportedReviewItems(reviewItems(page), importedItems);
  const pageSummary = derivePageSummary(page, mergedItems);
  const packageIds = Array.from(new Set(importedItems.map((item) => item.packageId).filter(Boolean)));

  await prisma.page.update({
    where: { id: pageId },
    data: {
      analysisNotes: pageSummary.description,
      analysisRaw: {
        ...currentRaw,
        reviewItems: mergedItems,
        reviewTitle: pageSummary.title,
        reviewDescription: pageSummary.description,
        chatGptResultImports: [
          ...imports,
          {
            importedAt: new Date().toISOString(),
            source: "chatgpt-json-paste",
            itemCount: importedItems.length,
            packageIds,
          },
        ],
      },
    },
  });

  redirect(res, `/?status=${encodeURIComponent(filterStatus)}&pageId=${encodeURIComponent(pageId)}`);
}

async function handleExportPackage(req, res, pageId) {
  const form = await readForm(req);
  const exportMode = formText(form, "exportMode") === "all" ? "all" : "single";
  const cropImage = exportMode === "single" ? imageDataFromForm(formText(form, "cropImageData")) : null;
  const cropImages = exportMode === "all" ? parseCropImagesDraft(formText(form, "cropImagesDraft")) : new Map();
  const draftItems = parseDraftReviewItems(formText(form, "reviewItemsDraft"));
  const activeNumber = formText(form, "activeNumber");
  const targetType = formText(form, "targetType") || "einzelmarke";
  const note = formText(form, "packageNote");
  const activeItem =
    draftItems.find((item) => String(item.number) === String(activeNumber)) ||
    draftItems.find((item) => Boolean(item.active)) ||
    null;

  if (exportMode === "single" && !cropImage) {
    sendJson(res, 400, { error: "Bitte zuerst eine Markierung im Bewertungsbild aufziehen." });
    return;
  }

  if (exportMode === "all" && cropImages.size === 0) {
    sendJson(res, 400, { error: "Bitte zuerst mindestens eine Markierung im Bewertungsbild aufziehen." });
    return;
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      album: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!page) {
    sendJson(res, 404, { error: "Seite nicht gefunden." });
    return;
  }

  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const packageName = [
    stamp,
    safePathPart(page.album.name, "album"),
    `seite-${safePathPart(page.pageNo, "seite")}`,
    exportMode === "all" ? "alle-markierungen" : `nr-${safePathPart(activeNumber || "x", "x")}`,
  ].join("_");
  const packagePath = path.join(packageExportDir, packageName);
  const pageImage = await readImageBytes(page.imageUrl);
  const pageExtension = extensionForMimeType(pageImage.mimeType);
  const pageFile = exportMode === "all"
    ? `seite-${safePathPart(page.pageNo, "seite")}${pageExtension}`
    : `seite${pageExtension}`;

  if (exportMode === "all") {
    const packageItems = draftItems
      .filter((item) => hasReviewBox(item))
      .map((item) => {
        const number = String(item.number);
        const image = cropImages.get(number);
        const fileStem = `seite-${safePathPart(page.pageNo, "seite")}_nr-${safePathPart(number, "x")}`;

        return image
          ? {
              item,
              image,
              number,
              cropFile: `${fileStem}_crop.png`,
              metadataFile: `${fileStem}_metadata.json`,
              promptFile: `${fileStem}_prompt.md`,
            }
          : null;
      })
      .filter(Boolean);

    if (packageItems.length === 0) {
      sendJson(res, 400, { error: "Keine markierten Nummern mit exportierbarem Ausschnitt gefunden." });
      return;
    }

    const indexMetadata = {
      packageId: packageName,
      exportMode,
      createdAt: createdAt.toISOString(),
      pageId: page.id,
      albumName: page.album.name,
      pageNo: page.pageNo,
      objectType: page.objectType,
      targetType,
      note,
      reviewItems: draftItems,
      sourceImageUrl: page.imageUrl,
      files: {
        page: pageFile,
        prompt: "index_prompt.md",
        metadata: "index_metadata.json",
      },
      items: packageItems.map(({ item, number, cropFile, metadataFile, promptFile }) => ({
        number,
        label: item.label,
        crop: cropFile,
        metadata: metadataFile,
        prompt: promptFile,
      })),
    };

    await mkdir(packagePath, { recursive: true });
    await writeFile(path.join(packagePath, pageFile), pageImage.bytes);
    await writeFile(path.join(packagePath, "index_metadata.json"), JSON.stringify(indexMetadata, null, 2), "utf8");
    await writeFile(
      path.join(packagePath, "index_prompt.md"),
      packageCollectionPromptText({
        page,
        targetType,
        note,
        pageFile,
        items: packageItems.map(({ item, number, cropFile, metadataFile, promptFile }) => ({
          number,
          label: item.label,
          ocrText: item.ocrText,
          cropFile,
          metadataFile,
          promptFile,
        })),
      }),
      "utf8",
    );

    for (const { item, image, number, cropFile, metadataFile, promptFile } of packageItems) {
      const itemReviewItems = draftItems.map((draftItem) => ({
        ...draftItem,
        active: String(draftItem.number) === number,
      }));
      const itemMetadata = {
        packageId: packageName,
        exportMode,
        createdAt: createdAt.toISOString(),
        pageId: page.id,
        albumName: page.album.name,
        pageNo: page.pageNo,
        objectType: page.objectType,
        targetType,
        note,
        activeNumber: number,
        activeItem: {
          ...item,
          active: true,
        },
        reviewItems: itemReviewItems,
        sourceImageUrl: page.imageUrl,
        files: {
          crop: cropFile,
          page: pageFile,
          prompt: promptFile,
          metadata: metadataFile,
        },
      };

      await writeFile(path.join(packagePath, cropFile), image.bytes);
      await writeFile(path.join(packagePath, metadataFile), JSON.stringify(itemMetadata, null, 2), "utf8");
      await writeFile(
        path.join(packagePath, promptFile),
        packagePromptText({
          page,
          targetType,
          note,
          activeNumber: number,
          activeItem: itemMetadata.activeItem,
          cropFile,
          pageFile,
          metadataFile,
        }),
        "utf8",
      );
    }

    const zipPath = path.join(packageZipDir, `${packageName}.zip`);
    await zipDirectory(packagePath, zipPath);

    const currentRaw = asJsonObject(page.analysisRaw);
    const packages = Array.isArray(currentRaw.reviewPackages) ? currentRaw.reviewPackages : [];

    await prisma.page.update({
      where: { id: pageId },
      data: {
        analysisRaw: {
          ...currentRaw,
          reviewItems: draftItems.length > 0 ? draftItems : currentRaw.reviewItems,
          reviewPackages: [
            ...packages,
            {
              packageId: packageName,
              packagePath,
              zipPath,
              createdAt: createdAt.toISOString(),
              exportMode,
              itemCount: packageItems.length,
              targetType,
            },
          ],
        },
      },
    });

    sendJson(res, 200, {
      ok: true,
      packageId: packageName,
      packagePath,
      zipPath,
      itemCount: packageItems.length,
      files: indexMetadata.files,
    });
    return;
  }

  const cropFile = "crop.png";
  const metadata = {
    packageId: packageName,
    exportMode,
    createdAt: createdAt.toISOString(),
    pageId: page.id,
    albumName: page.album.name,
    pageNo: page.pageNo,
    objectType: page.objectType,
    targetType,
    note,
    activeNumber,
    activeItem,
    reviewItems: draftItems,
    sourceImageUrl: page.imageUrl,
    files: {
      crop: cropFile,
      page: pageFile,
      prompt: "prompt.md",
      metadata: "metadata.json",
    },
  };

  await mkdir(packagePath, { recursive: true });
  await writeFile(path.join(packagePath, cropFile), cropImage.bytes);
  await writeFile(path.join(packagePath, pageFile), pageImage.bytes);
  await writeFile(path.join(packagePath, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  await writeFile(
    path.join(packagePath, "prompt.md"),
    packagePromptText({ page, targetType, note, activeNumber, activeItem, cropFile, pageFile, metadataFile: "metadata.json" }),
    "utf8",
  );
  const zipPath = path.join(packageZipDir, `${packageName}.zip`);
  await zipDirectory(packagePath, zipPath);

  const currentRaw = asJsonObject(page.analysisRaw);
  const packages = Array.isArray(currentRaw.reviewPackages) ? currentRaw.reviewPackages : [];

  await prisma.page.update({
    where: { id: pageId },
    data: {
      analysisRaw: {
        ...currentRaw,
        reviewItems: draftItems.length > 0 ? draftItems : currentRaw.reviewItems,
        reviewPackages: [
          ...packages,
          {
            packageId: packageName,
            packagePath,
            zipPath,
            createdAt: createdAt.toISOString(),
            activeNumber,
            targetType,
          },
        ],
      },
    },
  });

  sendJson(res, 200, {
    ok: true,
    packageId: packageName,
    packagePath,
    zipPath,
    files: metadata.files,
  });
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

async function handleImage(res, pageId) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { imageUrl: true },
  });

  if (!page) {
    send(res, 404, "Bild nicht gefunden.", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const image = await readImageBytes(page.imageUrl);

    res.writeHead(200, {
      "content-type": image.mimeType,
      "cache-control": "private, max-age=300",
    });
    res.end(image.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    send(res, 404, `Bild konnte nicht geladen werden: ${escapeHtml(message)}`, {
      "content-type": "text/plain; charset=utf-8",
    });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, await renderHome(url));
      return;
    }

    const imageMatch = url.pathname.match(/^\/image\/([^/]+)$/);

    if (req.method === "GET" && imageMatch) {
      await handleImage(res, decodeURIComponent(imageMatch[1]));
      return;
    }

    const pageMatch = url.pathname.match(/^\/pages\/([^/]+)$/);

    if (req.method === "POST" && pageMatch) {
      await handleSave(req, res, decodeURIComponent(pageMatch[1]));
      return;
    }

    const exportMatch = url.pathname.match(/^\/pages\/([^/]+)\/export-package$/);

    if (req.method === "POST" && exportMatch) {
      try {
        await handleExportPackage(req, res, decodeURIComponent(exportMatch[1]));
      } catch (error) {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : "Paketexport fehlgeschlagen.",
        });
      }
      return;
    }

    const enrichMatch = url.pathname.match(/^\/pages\/([^/]+)\/enrich-review-item$/);

    if (req.method === "POST" && enrichMatch) {
      await handleEnrichReviewItem(req, res, decodeURIComponent(enrichMatch[1]));
      return;
    }

    const ocrMatch = url.pathname.match(/^\/pages\/([^/]+)\/ocr-review-item$/);

    if (req.method === "POST" && ocrMatch) {
      await handleOcrReviewItem(req, res, decodeURIComponent(ocrMatch[1]));
      return;
    }

    const importMatch = url.pathname.match(/^\/pages\/([^/]+)\/import-chatgpt-results$/);

    if (req.method === "POST" && importMatch) {
      await handleImportChatGptResults(req, res, decodeURIComponent(importMatch[1]));
      return;
    }

    send(res, 404, layout('<div class="notice">Nicht gefunden.</div>'));
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);

    send(res, 500, layout(`<pre>${escapeHtml(message)}</pre>`));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Analyse-Review laeuft auf http://127.0.0.1:${port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});
