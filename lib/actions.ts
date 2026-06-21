"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { saveFormImageUpload } from "@/lib/uploads";

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Aktion fehlgeschlagen.";
}

function redirectWithActionError(albumId: string, message: string, anchor: string) {
  redirect(
    `/albums/${albumId}?actionError=${encodeURIComponent(message)}#${anchor}`,
  );
}

export async function createAlbum(formData: FormData) {
  const name = textValue(formData, "name");
  const coverImage = fileValue(formData, "image");
  const coverImageData = textValue(formData, "imageData");

  if (!name) {
    throw new Error("Der Albumname ist erforderlich.");
  }

  const imageUrl =
    coverImageData || (coverImage && coverImage.size > 0)
      ? await saveFormImageUpload(coverImage, coverImageData, "album")
      : null;

  const album = await prisma.album.create({
    data: {
      name,
      country: textValue(formData, "country") || null,
      notes: textValue(formData, "notes") || null,
      imageUrl,
    },
  });

  redirect(`/albums/${album.id}`);
}

export async function updateAlbumCover(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const coverImage = fileValue(formData, "image");
  const coverImageData = textValue(formData, "imageData");

  if (!albumId) {
    throw new Error("Album ist erforderlich.");
  }

  try {
    const imageUrl = await saveFormImageUpload(coverImage, coverImageData, "album");

    await prisma.album.update({
      where: { id: albumId },
      data: {
        imageUrl,
      },
    });

    revalidatePath("/");
    revalidatePath(`/albums/${albumId}`);
  } catch (error) {
    console.error("updateAlbumCover failed", error);
    redirectWithActionError(albumId, errorMessage(error), "albumfoto");
  }
}

export async function uploadPage(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const pageNo = Number(textValue(formData, "pageNo"));
  const image = fileValue(formData, "image");
  const imageData = textValue(formData, "imageData");
  const quality = optionalText(formData, "quality");

  if (!albumId) {
    throw new Error("Album ist erforderlich.");
  }

  try {
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      throw new Error("Seitennummer ist erforderlich.");
    }

    const imageUrl = await saveFormImageUpload(image, imageData, "page");

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
  } catch (error) {
    console.error("uploadPage failed", error);
    redirectWithActionError(albumId, errorMessage(error), "neue-seite");
  }
}

export async function uploadStampCrop(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const pageId = textValue(formData, "pageId");
  const crop = fileValue(formData, "crop");
  const cropData = textValue(formData, "cropData");

  if (!albumId || !pageId) {
    throw new Error("Album, Seitennummer und Bild sind erforderlich.");
  }

  try {
    await prisma.stamp.create({
      data: {
        pageId,
        cropUrl: await saveFormImageUpload(crop, cropData, "stamp"),
        notes: optionalText(formData, "notes"),
        positionHint: optionalText(formData, "positionHint"),
        manualCountryHint: optionalText(formData, "manualCountryHint"),
        manualConditionHint: optionalText(formData, "manualConditionHint"),
        status: "unanalysiert",
      },
    });

    revalidatePath(`/albums/${albumId}`);
    revalidatePath("/");
  } catch (error) {
    console.error("uploadStampCrop failed", error);
    redirectWithActionError(albumId, errorMessage(error), "seitenliste");
  }
}
