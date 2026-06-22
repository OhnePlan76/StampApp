"use client";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";

const MAX_IMAGE_PIXELS = 16_000_000;
const JPEG_QUALITY = 0.92;

type CameraCaptureFieldProps = {
  name: string;
  label: string;
  required?: boolean;
};

type TorchCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
};

type TorchConstraints = MediaTrackConstraints & {
  advanced?: Array<MediaTrackConstraintSet & { torch?: boolean }>;
};

type ImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function revokePreview(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function dataFieldNameFor(fileFieldName: string) {
  if (fileFieldName === "crop") return "cropData";
  return `${fileFieldName}Data`;
}

function targetImageSize(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function megapixels(width: number, height: number) {
  const value = (width * height) / 1_000_000;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MP`;
}

async function imageSourceFromFile(file: File): Promise<ImageSource> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);

    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Bild konnte nicht vorbereitet werden."));
    };

    image.src = objectUrl;
  });
}

function imageDataFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
) {
  const size = targetImageSize(width, height);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Bild konnte nicht vorbereitet werden.");
  }

  canvas.width = size.width;
  canvas.height = size.height;
  context.drawImage(source, 0, 0, size.width, size.height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width: size.width,
    height: size.height,
  };
}

function LightningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon-svg">
      <path d="M13 2 4 14h6l-1 8 10-13h-6l1-7Z" />
    </svg>
  );
}

export function CameraCaptureField({
  name,
  label,
  required = false,
}: CameraCaptureFieldProps) {
  const dataFieldName = dataFieldNameFor(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedData, setCapturedData] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {
        setError("Kamerabild konnte nicht gestartet werden.");
      });
    }
  }, [stream]);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      revokePreview(previewUrlRef.current);
    };
  }, []);

  function setPreparedImage(dataUrl: string, width: number, height: number, nameHint: string) {
    revokePreview(previewUrl);
    setPreviewUrl(dataUrl);
    setCapturedData(dataUrl);
    setFileName(`${nameHint} - ${megapixels(width, height)}`);
  }

  async function openCamera() {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      inputRef.current?.click();
      return;
    }

    setBusy(true);

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 5312 },
          height: { ideal: 3000 },
        },
      });
      const track = nextStream.getVideoTracks()[0];
      const capabilities =
        typeof track?.getCapabilities === "function"
          ? (track.getCapabilities() as TorchCapabilities)
          : {};

      stream?.getTracks().forEach((currentTrack) => currentTrack.stop());
      setTorchAvailable(Boolean(capabilities.torch));
      setTorchOn(false);
      setStream(nextStream);
    } catch {
      setError("Kamera nicht freigegeben. Alternativ Datei/Kamera auswaehlen.");
      inputRef.current?.click();
    } finally {
      setBusy(false);
    }
  }

  function closeCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setTorchAvailable(false);
    setTorchOn(false);
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];

    if (!track || !torchAvailable) return;

    const nextTorchState = !torchOn;

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorchState }],
      } as TorchConstraints);
      setTorchOn(nextTorchState);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
    }
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setError("Kamera ist noch nicht bereit.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const image = imageDataFromSource(video, video.videoWidth, video.videoHeight);
      setPreparedImage(image.dataUrl, image.width, image.height, "Foto bereit");
      closeCamera();
    } catch {
      setError("Foto konnte nicht vorbereitet werden.");
    } finally {
      setBusy(false);
    }
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      const imageSource = await imageSourceFromFile(file);

      try {
        const image = imageDataFromSource(
          imageSource.source,
          imageSource.width,
          imageSource.height,
        );
        setPreparedImage(image.dataUrl, image.width, image.height, file.name);
        event.currentTarget.value = "";
      } finally {
        imageSource.close?.();
      }
    } catch {
      setCapturedData("");
      setFileName(file.name);
      setError("Bild konnte nicht vorbereitet werden. Bitte Kamera oeffnen nutzen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field camera-field">
      <span>{label}</span>
      <input
        ref={inputRef}
        className="camera-file-input"
        type="file"
        name={name}
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />
      <input type="hidden" name={dataFieldName} value={capturedData} />

      {stream ? (
        <div className="camera-live">
          <div className="camera-frame is-active">
            <video
              ref={videoRef}
              className="camera-video"
              autoPlay
              muted
              playsInline
            />
            <button
              className={`icon-button torch-button ${torchOn ? "active" : ""}`}
              type="button"
              title={torchOn ? "Blitz aus" : "Blitz an"}
              aria-label={torchOn ? "Blitz aus" : "Blitz an"}
              aria-pressed={torchOn}
              disabled={!torchAvailable || busy}
              onClick={toggleTorch}
            >
              <LightningIcon />
            </button>
          </div>
          <div className="camera-actions">
            <button className="button" type="button" disabled={busy} onClick={capturePhoto}>
              Foto uebernehmen
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={closeCamera}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="camera-picker">
          <button className="button" type="button" disabled={busy} onClick={openCamera}>
            Kamera oeffnen
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={chooseFile}>
            Datei waehlen
          </button>
        </div>
      )}

      {previewUrl ? (
        <div className="camera-preview">
          <img src={previewUrl} alt={`${label} Vorschau`} />
          <div className="muted">
            {fileName || "Foto bereit"} - danach speichern
          </div>
        </div>
      ) : (
        <div className="muted">
          {required ? "Foto erforderlich." : "Noch kein Foto gewaehlt."}
        </div>
      )}
      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}
