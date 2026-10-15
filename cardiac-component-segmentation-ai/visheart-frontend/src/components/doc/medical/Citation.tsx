import { Fragment } from "react";
import { referenceNumber, type Claim, type RefId } from "@/content/medicalGuide";
import { ContentText } from "@/components/doc/medical/ContentText";

export const referenceAnchorId = (id: RefId) => `ref-${id}`;

export function CitationMarker({ refs }: { refs: readonly RefId[] }) {
  if (refs.length === 0) return null;
  const numbered = [...new Set(refs)]
    .map((id) => ({ id, n: referenceNumber(id) }))
    .sort((a, b) => a.n - b.n);

  return (
    <sup className="ml-0.5 text-[0.7em] font-medium">
      [
      {numbered.map(({ id, n }, index) => (
        <Fragment key={id}>
          {index > 0 && ", "}
          <a
            href={`#${referenceAnchorId(id)}`}
            aria-label={`Reference ${n}`}
            className="text-primary focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {n}
          </a>
        </Fragment>
      ))}
      ]
    </sup>
  );
}

export function ClaimText({ claim }: { claim: Claim }) {
  return (
    <>
      <ContentText text={claim.text} />
      <CitationMarker refs={claim.refs} />
    </>
  );
}

export function ClaimParagraphs({ claims, className }: { claims: Claim[]; className?: string }) {
  return (
    <>
      {claims.map((claim, index) => (
        <p key={index} className={className}>
          <ClaimText claim={claim} />
        </p>
      ))}
    </>
  );
}
