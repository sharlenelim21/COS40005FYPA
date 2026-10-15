import { useId } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RangeTableBlock } from "@/content/medicalGuide";
import { CitationMarker, ClaimText } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";

const COLUMN_COUNT = 5;

export function ReferenceRangeTable({ caption, groups, footnotes }: Omit<RangeTableBlock, "kind">) {
  const captionId = useId();
  const footnoteId = useId();

  return (
    <div className="bg-card rounded-lg border p-2 md:p-4">
      <p id={captionId} className="mb-3 px-2 text-sm font-medium">
        <ContentText text={caption} />
      </p>
      <Table
        className="min-w-[36rem]"
        aria-labelledby={captionId}
        aria-describedby={footnotes?.length ? footnoteId : undefined}
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Parameter</TableHead>
            <TableHead scope="col">Men</TableHead>
            <TableHead scope="col">Women</TableHead>
            <TableHead scope="col">Unit</TableHead>
            <TableHead scope="col">Source</TableHead>
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.label}>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead
                scope="rowgroup"
                colSpan={COLUMN_COUNT}
                className="text-muted-foreground h-8 text-xs font-semibold tracking-wide uppercase"
              >
                {group.label}
              </TableHead>
            </TableRow>
            {group.rows.map((row) => (
              <TableRow key={row.parameter}>
                <TableHead scope="row" className="font-medium">
                  {row.parameter}
                </TableHead>
                <TableCell className="whitespace-normal">
                  <ContentText text={row.men} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <ContentText text={row.women} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <ContentText text={row.unit} />
                </TableCell>
                <TableCell>
                  <CitationMarker refs={row.refs} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>

      {footnotes && footnotes.length > 0 && (
        <div id={footnoteId} className="text-muted-foreground mt-3 space-y-1 border-t pt-3 text-xs">
          {footnotes.map((note, index) => (
            <p key={index}>
              <span aria-hidden="true">* </span>
              <ClaimText claim={note} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
