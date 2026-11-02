import { useId } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PatternTableBlock } from "@/content/medicalGuide";
import { CitationMarker } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";
import { SourceText } from "@/components/doc/medical/FigureCaption";

export function DiseasePatternTable({ caption, rows, attribution, refs }: Omit<PatternTableBlock, "kind">) {
  const captionId = useId();
  const sourceId = useId();

  return (
    <div className="bg-card rounded-lg border p-2 md:p-4">
      <p id={captionId} className="mb-3 px-2 text-sm font-medium">
        <ContentText text={caption} />
        <CitationMarker refs={refs} />
      </p>
      <Table className="min-w-[36rem]" aria-labelledby={captionId} aria-describedby={sourceId}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Group</TableHead>
            <TableHead scope="col">What it means</TableHead>
            <TableHead scope="col">Key measurements</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.group}>
              <TableHead scope="row" className="font-medium whitespace-normal">
                {row.group}
              </TableHead>
              <TableCell className="whitespace-normal">
                <ContentText text={row.meaning} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <ContentText text={row.measurements} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p id={sourceId} className="text-muted-foreground/80 mt-3 border-t pt-3 text-[11px] break-words">
        Source: <SourceText text={attribution} />
      </p>
    </div>
  );
}
