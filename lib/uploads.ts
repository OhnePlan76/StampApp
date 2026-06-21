import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const uploadDir = path.join(process.cwd(), "public", "uploads");
const uploadApiPrefix = "/api/uploads/";

const mimeExtensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

type ImageUploadPrefix = "album" | "page" | "stamp";

let r2Client: S3Client | null = null;

function requiredR2Env() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

function getR2Client() {
  const env = requiredR2Env();

  if (!env) {
    return null;
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    });
  }

  return {
    bucket: env.bucket,
    client: r2Client,
  };
}

function publicR2UrlForFilename(filename: string) {
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");

  return publicBaseUrl ? `${publicBaseUrl}/${filename}` : imageUrlForFilename(filename);
}

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
  const r2 = getR2Client();

  if (r2) {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: filename,
        Body: bytes,
        ContentType: mimeType,
      }),
    );

    return publicR2UrlForFilename(filename);
  }

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
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error("Bild konnte nicht geladen werden.");
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") || "image/jpeg",
    };
  }

  const r2 = getR2Client();

  if (r2 && imageUrl.startsWith(uploadApiPrefix)) {
    const object = await r2.client.send(
      new GetObjectCommand({
        Bucket: r2.bucket,
        Key: filenameFromUploadUrl(imageUrl),
      }),
    );
    const bytes = await object.Body?.transformToByteArray();

    if (!bytes) {
      throw new Error("Bild konnte nicht aus R2 gelesen werden.");
    }

    return {
      bytes: Buffer.from(bytes),
      mimeType: object.ContentType || "image/jpeg",
    };
  }

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
