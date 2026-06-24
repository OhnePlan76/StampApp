"use client";

import { useState } from "react";

type UploadImageProps = {
  alt: string;
  className: string;
  fallbackText?: string;
  src: string;
};

export function UploadImage({
  alt,
  className,
  fallbackText = "Bild fehlt",
  src,
}: UploadImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${className} missing-upload`} role="img" aria-label={fallbackText}>
        <span>{fallbackText}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
