import { ImageIcon } from "lucide-react";
import type { FigureBlock } from "@/content/medicalGuide";
import { DocImage } from "@/components/doc/DocImage";
import { ContentText } from "@/components/doc/medical/ContentText";
import { FigureCaption } from "@/components/doc/medical/FigureCaption";

interface FigureSlotProps extends Omit<FigureBlock, "kind"> {
  number: number;
}

export function FigureSlot({ number, src, alt, caption, attribution, refs }: FigureSlotProps) {
  return (
    <figure className="bg-muted/30 rounded-lg border p-2 md:p-4">
      {src ? (
        <DocImage
          src={src}
          alt={alt}
          capAtIntrinsicWidth
          className="mx-auto block h-auto w-full rounded-md border shadow-sm"
        />
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
      <FigureCaption number={number} caption={caption} attribution={attribution} refs={refs} />
    </figure>
  );
}
