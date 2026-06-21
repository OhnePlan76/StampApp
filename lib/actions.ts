"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { saveImageUpload } from "@/lib/uploads";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function optionalText(formData: FormData, key: string) {
  return textValue(formData, key) || null;
}

export async function createAlbum(formData: FormData) {
  const name = textValue(formData, "name");

  if (!name) {
    throw new Error("Der Albumname ist erforderlich.");
  }

  const album = await prisma.album.create({
    data: {
      name,
      country: textValue(formData, "country") || null,
      notes: textValue(formData, "notes") || null,
    },
  });

  redirect(`/albums/${album.id}`);
}

export async function uploadPage(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const pageNo = Number(textValue(formData, "pageNo"));
  const image = fileValue(formData, "image");
  const quality = optionalText(formData, "quality");

  if (!albumId || !Number.isInteger(pageNo) || pageNo < 1 || !image) {
    throw new Error("Album, Seitennummer und Bild sind erforderlich.");
  }

  const imageUrl = await saveImageUpload(image, "page");

  await prisma.page.create({
    data: {
      albumId,
      pageNo,
      imageUrl,
      notes: optionalText(formData, "notes"),
      quality,
      status: quality === "nachfotografieren" ? "nachfotografieren" : "offen",
    },
  });

  revalidatePath(`/albums/${albumId}`);
}

export async function uploadStampCrop(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const pageId = textValue(formData, "pageId");
  const crop = fileValue(formData, "crop");

  if (!albumId || !pageId || !crop) {
    throw new Error("Seite und Marken-Crop sind erforderlich.");
  }

  await prisma.stamp.create({
    data: {
      pageId,
      cropUrl: await saveImageUpload(crop, "stamp"),
      notes: optionalText(formData, "notes"),
      positionHint: optionalText(formData, "positionHint"),
      manualCountryHint: optionalText(formData, "manualCountryHint"),
      manualConditionHint: optionalText(formData, "manualConditionHint"),
      status: "unanalysiert",
    },
  });

  revalidatePath(`/albums/${albumId}`);
  revalidatePath("/");
}
