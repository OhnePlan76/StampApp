import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const uploadDir = path.join(process.cwd(), "public", "uploads");

const mimeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function saveImageUpload(file: File, prefix: "page" | "stamp") {
  if (!file || file.size === 0) {
    throw new Error("Es wurde keine Bilddatei hochgeladen.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Bitte eine Bilddatei hochladen.");
  }

  const extension =
    mimeExtensions[file.type] || path.extname(file.name).toLowerCase() || ".jpg";
  const filename = `${prefix}-${Date.now()}-${randomUUID()}${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), bytes);

  return `/uploads/${filename}`;
}

export function publicUploadUrlToPath(imageUrl: string) {
  if (!imageUrl.startsWith("/uploads/")) {
    throw new Error("Nur lokale Uploads aus /uploads koennen analysiert werden.");
  }

  const relativePath = imageUrl.replace(/^\/+/, "");
  const absolutePath = path.join(process.cwd(), "public", relativePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedPath = path.resolve(absolutePath);

  if (!resolvedPath.startsWith(resolvedUploadDir)) {
    throw new Error("Ungueltiger Upload-Pfad.");
  }

  return resolvedPath;
}

export function mimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";

  return "image/jpeg";
}
