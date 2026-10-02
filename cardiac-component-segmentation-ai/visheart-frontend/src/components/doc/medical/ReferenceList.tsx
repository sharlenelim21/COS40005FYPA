import { ExternalLink } from "lucide-react";
import { CITED_REFERENCE_IDS, REFERENCES, type Reference } from "@/content/medicalGuide";
import { referenceAnchorId } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";

const linkClassName =
  "text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none";

function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function ReferenceLink({ reference }: { reference: Reference }) {
  if (reference.doi !== undefined) {
    return <ExternalAnchor href={`https://doi.org/${reference.doi}`}>doi:{reference.doi}</ExternalAnchor>;
  }
  return <ExternalAnchor href={reference.url}>Source link</ExternalAnchor>;
}

export function ReferenceList() {
  return (
    <ol className="space-y-2 text-sm">
      {CITED_REFERENCE_IDS.map((id, index) => {
        const reference: Reference = REFERENCES[id];
        return (
          <li
            key={id}
            id={referenceAnchorId(id)}
            tabIndex={-1}
            className="target:bg-muted -mx-2 flex scroll-mt-44 gap-3 rounded-md p-2 transition-colors focus:outline-none lg:scroll-mt-32"
          >
            <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{index + 1}.</span>
            <div className="min-w-0 space-y-1 break-words">
              <p>
                <ContentText text={reference.citation} />
              </p>
              <p className="text-xs">
                <ReferenceLink reference={reference} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
