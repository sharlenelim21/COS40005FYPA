import { ImageIcon } from "lucide-react";
import type { FigureBlock } from "@/content/medicalGuide";
import { DocImage } from "@/components/doc/DocImage";
import { CitationMarker } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";

export function FigureSlot({ src, alt, caption, attribution, refs = [] }: Omit<FigureBlock, "kind">) {
  return (
    <figure className="bg-muted/30 rounded-lg border p-2 md:p-4">
      {src ? (
        <DocImage src={src} alt={alt} className="h-auto w-full rounded-md border shadow-sm" />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="text-muted-foreground flex aspect-[16/9] max-h-72 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center text-sm"
        >
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <span>Figure slot</span>
          <span className="text-xs">
            <ContentText text={alt} />
          </span>
        </div>
      )}
      <figcaption className="mt-2 space-y-1">
        <p className="text-muted-foreground text-xs">
          <ContentText text={caption} />
          <CitationMarker refs={refs} />
        </p>
        <p className="text-muted-foreground/80 text-[11px]">
          Source: <ContentText text={attribution} />
        </p>
      </figcaption>
    </figure>
  );
}
