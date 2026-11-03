import { Fragment } from "react";
import type { RefId } from "@/content/medicalGuide";
import { CitationMarker } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";

const URL_SPLIT = /(https?:\/\/\S+)/;
const IS_URL = /^https?:\/\/\S+$/;

function SourceText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT).map((part, index) =>
        IS_URL.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary focus-visible:ring-ring rounded-sm break-all underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            {part}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <Fragment key={index}>
            <ContentText text={part} />
          </Fragment>
        ),
      )}
    </>
  );
}

interface FigureCaptionProps {
  number: number;
  caption: string;
  attribution?: string;
  refs?: readonly RefId[];
}

export function FigureCaption({ number, caption, attribution, refs = [] }: FigureCaptionProps) {
  return (
    <figcaption className="mt-2 space-y-1">
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-semibold">Figure {number}.</span> <ContentText text={caption} />
        <CitationMarker refs={refs} />
      </p>
      {attribution && (
        <p className="text-muted-foreground/80 text-[11px] break-words">
          Source: <SourceText text={attribution} />
        </p>
      )}
    </figcaption>
  );
}
