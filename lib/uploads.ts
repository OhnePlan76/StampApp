import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const uploadDir = path.join(process.cwd(), "public", "uploads");
const uploadApiPrefix = "/api/uploads/";

const mimeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

type ImageUploadPrefix = "album" | "page" | "stamp";

function imageUrlForFilename(filename: string) {
  return `${uploadApiPrefix}${filename}`;
}

function filenameFromUploadUrl(imageUrl: string) {
  if (imageUrl.startsWith(uploadApiPrefix)) {
    return imageUrl.slice(uploadApiPrefix.length);
  }

  if (imageUrl.startsWith("/uploads/")) {
    return imageUrl.slice("/uploads/".length);
  }

  throw new Error("Nur lokale Uploads koennen gelesen werden.");
}

async function writeImageBytes(
  bytes: Buffer,
  mimeType: string,
  originalName: string,
  prefix: ImageUploadPrefix,
) {
  const extension =
    mimeExtensions[mimeType] || path.extname(originalName).toLowerCase() || ".jpg";
  const filename = `${prefix}-${Date.now()}-${randomUUID()}${extension}`;

  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), bytes);

  return imageUrlForFilename(filename);
}

export async function saveImageUpload(file: File, prefix: ImageUploadPrefix) {
  if (!file || file.size === 0) {
    throw new Error("Es wurde keine Bilddatei hochgeladen.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Bitte eine Bilddatei hochladen.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  return writeImageBytes(bytes, file.type, file.name, prefix);
}

export async function saveImageDataUpload(
  imageData: string,
  prefix: ImageUploadPrefix,
) {
  const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Ungueltige Kamera-Bilddaten.");
  }

  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, "base64");

  if (bytes.length === 0) {
    throw new Error("Das Kamera-Foto ist leer.");
  }

  return writeImageBytes(bytes, mimeType, `${prefix}.jpg`, prefix);
}

export async function saveFormImageUpload(
  file: File | null,
  imageData: string,
  prefix: ImageUploadPrefix,
) {
  if (imageData) {
    return saveImageDataUpload(imageData, prefix);
  }

  if (file) {
    return saveImageUpload(file, prefix);
  }

  throw new Error("Es wurde keine Bilddatei hochgeladen.");
}

export function publicUploadUrlToPath(imageUrl: string) {
  const filename = filenameFromUploadUrl(imageUrl);
  const absolutePath = path.join(uploadDir, filename);
  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedPath = path.resolve(absolutePath);

  if (
    resolvedPath !== resolvedUploadDir &&
    !resolvedPath.startsWith(`${resolvedUploadDir}${path.sep}`)
  ) {
    throw new Error("Ungueltiger Upload-Pfad.");
  }

  return resolvedPath;
}

export async function readPublicUpload(imageUrl: string) {
  const filePath = publicUploadUrlToPath(imageUrl);

  return {
    bytes: await readFile(filePath),
    mimeType: mimeTypeFromPath(filePath),
  };
}

export function mimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";

  return "image/jpeg";
}
