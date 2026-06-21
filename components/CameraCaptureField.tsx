"use client";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";

type CameraCaptureFieldProps = {
  name: string;
  label: string;
  required?: boolean;
};

function revokePreview(url: string | null) {
  if (url) {
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

  function setInputFile(file: File) {
    if (!inputRef.current) return;

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputRef.current.files = transfer.files;
      inputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      // Some mobile browsers do not allow assigning generated files to inputs.
      // The hidden imageData/cropData field still carries the camera photo.
    }

    setFileName(file.name);
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

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );

    if (!blob) {
      setError("Foto konnte nicht uebernommen werden.");
      return;
    }

    const file = new File([blob], `${name}-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const nextPreviewUrl = URL.createObjectURL(blob);

    revokePreview(previewUrl);
    setPreviewUrl(nextPreviewUrl);
    setCapturedData(imageData);
    setInputFile(file);
    closeCamera();
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    revokePreview(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setCapturedData("");
    setFileName(file.name);
    setError(null);
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
