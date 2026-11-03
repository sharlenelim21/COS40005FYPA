import type { VideoBlock } from "@/content/medicalGuide";
import { DocVideo } from "@/components/doc/DocVideo";
import { FigureCaption } from "@/components/doc/medical/FigureCaption";

interface VideoSlotProps extends Omit<VideoBlock, "kind"> {
  number: number;
}

export function VideoSlot({ number, src, ariaLabel, mode, poster, maxWidth, caption, attribution, refs }: VideoSlotProps) {
  return (
    <figure className="bg-muted/30 rounded-lg border p-2 md:p-4">
      <DocVideo
        src={src}
        ariaLabel={ariaLabel}
        mode={mode}
        poster={poster}
        maxWidth={maxWidth}
        className="rounded-md border shadow-sm"
      />
      <FigureCaption number={number} caption={caption} attribution={attribution} refs={refs} />
    </figure>
  );
}
