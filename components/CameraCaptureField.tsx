"use client";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";

type CameraCaptureFieldProps = {
  name: string;
  label: string;
  required?: boolean;
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
  const maxEdge = 1600;

  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / Math.max(width, height);

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function resizeImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = targetImageSize(image.naturalWidth, image.naturalHeight);

      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.drawImage(image, 0, 0, size.width, size.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Bild konnte nicht vorbereitet werden."));
    };

    image.src = objectUrl;
  });
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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play();
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

  async function openCamera() {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      inputRef.current?.click();
      return;
    }

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });

      stream?.getTracks().forEach((track) => track.stop());
      setStream(nextStream);
    } catch {
      setError("Kamera nicht freigegeben. Alternativ Datei/Kamera auswaehlen.");
      inputRef.current?.click();
    }
  }

  function closeCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setError("Kamera ist noch nicht bereit.");
      return;
    }

    const canvas = document.createElement("canvas");
    const size = targetImageSize(video.videoWidth, video.videoHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);
    const imageData = canvas.toDataURL("image/jpeg", 0.82);

    revokePreview(previewUrl);
    setPreviewUrl(imageData);
    setCapturedData(imageData);
    setFileName(`${name}-${Date.now()}.jpg`);
    closeCamera();
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setError(null);

    try {
      const imageData = await resizeImageFile(file);

      revokePreview(previewUrl);
      setPreviewUrl(imageData);
      setCapturedData(imageData);
      setFileName(`${file.name} - verkleinert`);
      event.currentTarget.value = "";
    } catch {
      setCapturedData("");
      setFileName(file.name);
      setError(
        file.size > 4 * 1024 * 1024
          ? "Bild ist sehr gross. Bitte Kamera oeffnen nutzen."
          : "Bild wird unverkleinert gesendet.",
      );
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
          <video
            ref={videoRef}
            className="camera-video"
            autoPlay
            muted
            playsInline
          />
          <div className="camera-actions">
            <button className="button" type="button" onClick={capturePhoto}>
              Foto uebernehmen
            </button>
            <button className="secondary-button" type="button" onClick={closeCamera}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="camera-picker">
          <button className="button" type="button" onClick={openCamera}>
            Kamera oeffnen
          </button>
          <button className="secondary-button" type="button" onClick={chooseFile}>
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
