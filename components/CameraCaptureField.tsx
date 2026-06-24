"use client";

import {
  type ChangeEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const MAX_IMAGE_PIXELS = 16_000_000;
const JPEG_QUALITY = 0.92;

type CameraCaptureFieldProps = {
  captureLabel?: string;
  name: string;
  label: string;
  mode?: "photo" | "scan";
  required?: boolean;
  resetSignal?: number;
  startLabel?: string;
  stopLabel?: string;
};

type TorchCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
};

type TorchConstraints = MediaTrackConstraints & {
  advanced?: Array<MediaTrackConstraintSet & { torch?: boolean }>;
};

type PreparedImage = {
  file: File;
  width: number;
  height: number;
};

type ImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

function megapixels(width: number, height: number) {
  const value = (width * height) / 1_000_000;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} MP`;
}

function jpegName(originalName: string) {
  const baseName = originalName.replace(/\.[^.]+$/, "") || "aufnahme";
  return `${baseName}-16mp.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Bild konnte nicht verarbeitet werden."));
        }
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
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
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht geladen werden."));
    };
    image.src = url;
  });
}

async function prepareImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  filename: string,
): Promise<PreparedImage> {
  const scale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Bild konnte nicht verarbeitet werden.");
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas);
  const file = new File([blob], jpegName(filename), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  return {
    file,
    width: targetWidth,
    height: targetHeight,
  };
}

function LightningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon-svg">
      <path d="M13 2 4 14h6l-1 8 10-13h-6l1-7Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon-svg">
      <path d="M12 3a1 1 0 0 1 .7.3l4 4a1 1 0 1 1-1.4 1.4L13 6.42V15a1 1 0 1 1-2 0V6.42L8.7 8.7a1 1 0 1 1-1.4-1.4l4-4A1 1 0 0 1 12 3Z" />
      <path d="M5 14a1 1 0 0 1 1 1v3h12v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function CameraCaptureField({
  captureLabel,
  name,
  label,
  mode = "photo",
  required = false,
  resetSignal = 0,
  startLabel,
  stopLabel,
}: CameraCaptureFieldProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isScanMode = mode === "scan";

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    if (!cameraActive || !video || !streamRef.current) return;

    video.srcObject = streamRef.current;
    void video.play().catch((currentError: unknown) => {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Kamerabild konnte nicht gestartet werden.",
      );
    });
  }, [cameraActive]);

  useEffect(() => {
    if (resetSignal === 0) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    setPreviewUrl(null);
    setFileInfo(null);
    setError(null);
  }, [resetSignal]);

  function setPreparedFile(image: PreparedImage) {
    const input = fileInputRef.current;

    if (!input) return;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(image.file);
    input.files = dataTransfer.files;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    const nextPreviewUrl = URL.createObjectURL(image.file);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setFileInfo(`${megapixels(image.width, image.height)} - JPEG`);
  }

  async function prepareSelectedFile(file: File) {
    setBusy(true);
    setError(null);

    try {
      const imageSource = await imageSourceFromFile(file);

      try {
        setPreparedFile(
          await prepareImage(
            imageSource.source,
            imageSource.width,
            imageSource.height,
            file.name,
          ),
        );
      } finally {
        imageSource.close?.();
      }
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Bild konnte nicht vorbereitet werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      await prepareSelectedFile(file);
    }
  }

  async function startCamera() {
    if (streamRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Kamera ist in diesem Browser nicht verfuegbar.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 5312 },
          height: { ideal: 3000 },
        },
      });
      const track = stream.getVideoTracks()[0];
      const capabilities =
        typeof track?.getCapabilities === "function"
          ? (track.getCapabilities() as TorchCapabilities)
          : {};

      streamRef.current = stream;
      setTorchAvailable(Boolean(capabilities.torch));
      setCameraActive(true);
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Kamera konnte nicht gestartet werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
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

  async function captureFrame() {
    const video = videoRef.current;

    if (!video?.videoWidth || !video.videoHeight) {
      setError("Kamerabild ist noch nicht bereit.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      setPreparedFile(
        await prepareImage(
          video,
          video.videoWidth,
          video.videoHeight,
          `aufnahme-${Date.now()}.jpg`,
        ),
      );

      if (!isScanMode) {
        stopCamera();
      }
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Aufnahme konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="camera-field">
      <label className="camera-field-label" htmlFor={inputId}>
        {label}
      </label>
      <div className={`camera-frame ${cameraActive ? "is-active" : ""}`}>
        {cameraActive ? (
          <video
            ref={videoRef}
            className="camera-video"
            muted
            playsInline
            autoPlay
          />
        ) : previewUrl ? (
          <img className="camera-preview" src={previewUrl} alt={`${label} Vorschau`} />
        ) : (
          <div className="camera-placeholder">{label}</div>
        )}

        {cameraActive ? (
          <button
            className={`icon-button torch-button ${torchOn ? "active" : ""}`}
            type="button"
            title={torchOn ? "Blitz aus" : "Blitz an"}
            aria-label={torchOn ? "Blitz aus" : "Blitz an"}
            aria-pressed={torchOn}
            disabled={!torchAvailable}
            onClick={toggleTorch}
          >
            <LightningIcon />
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        className="native-file-input"
        id={inputId}
        type="file"
        name={name}
        accept="image/*"
        capture="environment"
        required={required}
        onChange={handleFileChange}
      />

      <div className="camera-actions">
        <button
          className="secondary-button camera-command"
          type="button"
          disabled={busy}
          onClick={cameraActive ? stopCamera : startCamera}
        >
          {cameraActive ? stopLabel || "Kamera schliessen" : startLabel || "Kamera oeffnen"}
        </button>
        {cameraActive ? (
          <button
            className="button camera-command"
            type="button"
            disabled={busy}
            onClick={captureFrame}
          >
            {captureLabel || (isScanMode ? "Seite aufnehmen" : "Foto machen")}
          </button>
        ) : null}
        <button
          className="icon-button file-button"
          type="button"
          title="Datei waehlen"
          aria-label="Datei waehlen"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
        </button>
      </div>

      {fileInfo ? (
        <div className="camera-file-info">
          {isScanMode ? `Letzte Seite bereit - ${fileInfo}` : `Foto bereit - ${fileInfo}`}
        </div>
      ) : null}
      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}
