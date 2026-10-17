"use client";

import React, { useState } from "react";
import { DOC_IMAGE_SIZES } from "@/components/doc/docImageSizes";

interface DocImageProps {
  src: string;
  alt: string;
  className?: string;
  capAtIntrinsicWidth?: boolean;
}

export const DocImage: React.FC<DocImageProps> = ({ src, alt, className, capAtIntrinsicWidth = false }) => {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`flex items-center justify-center bg-muted/50 rounded-md border text-muted-foreground text-sm ${className ?? ""}`}
        style={{ minHeight: 120 }}
        aria-label={alt}
      >
        <span className="px-4 py-6 text-center">{alt}</span>
      </div>
    );
  }

  const [width, height] = DOC_IMAGE_SIZES[src] ?? [];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={className}
      style={capAtIntrinsicWidth && width ? { maxWidth: width } : undefined}
      onError={() => setErrored(true)}
    />
  );
};
