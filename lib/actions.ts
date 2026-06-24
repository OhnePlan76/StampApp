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

function optionalInt(formData: FormData, key: string) {
  const value = textValue(formData, key);

  if (!value) return null;

  const numberValue = Number(value);

  if (!Number.isInteger(numberValue)) {
    throw new Error(`${key} muss eine ganze Zahl sein.`);
  }

  return numberValue;
}

function optionalNumber(formData: FormData, key: string) {
  const value = textValue(formData, key).replace(",", ".");

  if (!value) return null;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`${key} muss eine Zahl sein.`);
  }

  return numberValue;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Aktion fehlgeschlagen.";
}

function redirectWithActionError(
  albumId: string,
  message: string,
  anchor: string,
  view = "edit",
) {
  redirect(
    `/albums/${albumId}?view=${view}&actionError=${encodeURIComponent(message)}#${anchor}`,
  );
}

function redirectHomeWithActionError(message: string, anchor: string, view = "create") {
  redirect(`/?view=${view}&actionError=${encodeURIComponent(message)}#${anchor}`);
}

export async function createAlbum(formData: FormData) {
  const name = textValue(formData, "name");
  const coverImage = fileValue(formData, "image");
  const coverImageData = textValue(formData, "imageData");
  const notes = textValue(formData, "notes");
  const hasCoverImage = Boolean(coverImageData || (coverImage && coverImage.size > 0));

  if (!name) {
    throw new Error("Der Albumname ist erforderlich.");
  }

  if (!hasCoverImage && !notes) {
    redirectHomeWithActionError(
      "Albumfoto kann uebersprungen werden, wenn eine Notiz den Kontext beschreibt.",
      "album-anlegen",
    );
  }

  const imageUrl = hasCoverImage
    ? await saveFormImageUpload(coverImage, coverImageData, "album")
    : null;

  const album = await prisma.album.create({
    data: {
      name,
      country: textValue(formData, "country") || null,
      notes: notes || null,
      imageUrl,
    },
  });

  redirect(`/albums/${album.id}?view=capture`);
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

export async function updateAlbum(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const name = textValue(formData, "name");

  if (!albumId || !name) {
    throw new Error("Album und Albumtitel sind erforderlich.");
  }

  try {
    await prisma.album.update({
      where: { id: albumId },
      data: {
        name,
        country: optionalText(formData, "country"),
        notes: optionalText(formData, "notes"),
        status: textValue(formData, "status") || "erfassung",
      },
    });

    revalidatePath("/");
    revalidatePath(`/albums/${albumId}`);
  } catch (error) {
    console.error("updateAlbum failed", error);
    redirectWithActionError(albumId, errorMessage(error), "albumdaten");
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
        analysisStatus: "wartet",
      },
    });

    revalidatePath(`/albums/${albumId}`);
  } catch (error) {
    console.error("uploadPage failed", error);
    redirectWithActionError(albumId, errorMessage(error), "neue-seite", "capture");
  }
}

export async function updatePage(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const pageId = textValue(formData, "pageId");
  const pageNo = Number(textValue(formData, "pageNo"));
  const quality = optionalText(formData, "quality");

  if (!albumId || !pageId) {
    throw new Error("Album und Seite sind erforderlich.");
  }

  try {
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      throw new Error("Seitennummer ist erforderlich.");
    }

    await prisma.page.update({
      where: { id: pageId },
      data: {
        pageNo,
        quality,
        status: textValue(formData, "status") || "offen",
        notes: optionalText(formData, "notes"),
      },
    });

    revalidatePath("/");
    revalidatePath(`/albums/${albumId}`);
  } catch (error) {
    console.error("updatePage failed", error);
    redirectWithActionError(albumId, errorMessage(error), "seiten-bearbeiten");
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
    redirectWithActionError(albumId, errorMessage(error), "seitenliste", "pages");
  }
}

export async function updateStamp(formData: FormData) {
  const albumId = textValue(formData, "albumId");
  const stampId = textValue(formData, "stampId");

  if (!albumId || !stampId) {
    throw new Error("Album und Marke sind erforderlich.");
  }

  try {
    await prisma.stamp.update({
      where: { id: stampId },
      data: {
        status: textValue(formData, "status") || "unanalysiert",
        notes: optionalText(formData, "notes"),
        positionHint: optionalText(formData, "positionHint"),
        manualCountryHint: optionalText(formData, "manualCountryHint"),
        manualConditionHint: optionalText(formData, "manualConditionHint"),
        country: optionalText(formData, "country"),
        era: optionalText(formData, "era"),
        denomination: optionalText(formData, "denomination"),
        motive: optionalText(formData, "motive"),
        usedState: optionalText(formData, "usedState"),
        condition: optionalText(formData, "condition"),
        catalogHint: optionalText(formData, "catalogHint"),
        valueClass: optionalInt(formData, "valueClass"),
        valueMin: optionalNumber(formData, "valueMin"),
        valueMax: optionalNumber(formData, "valueMax"),
        needsExpert: formData.get("needsExpert") === "on",
      },
    });

    revalidatePath("/");
    revalidatePath(`/albums/${albumId}`);
  } catch (error) {
    console.error("updateStamp failed", error);
    redirectWithActionError(albumId, errorMessage(error), "marken-bearbeiten");
  }
}
