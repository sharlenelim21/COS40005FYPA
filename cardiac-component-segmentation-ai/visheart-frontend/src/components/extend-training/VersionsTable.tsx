"use client";

import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DATASET_NAMES, ModelVersion, RetrainingStatus, VersionAction } from "@/lib/retraining-api";
import { changeTone, historyRows, HISTORY_ROWS, points } from "@/components/extend-training/logic";

const CHIP = {
  up: "border-green-200 text-green-700 dark:border-green-900 dark:text-green-400",
  down: "border-red-200 text-red-700 dark:border-red-900 dark:text-red-400",
  flat: "text-muted-foreground",
};

function Changes({ version, active }: { version: ModelVersion; active: string }) {
  if (version.is_original) return <span className="text-sm text-muted-foreground">The shipped model</span>;
  if (!version.gate) return <span className="text-sm text-muted-foreground">Not compared yet</span>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(version.gate.public).map(([name, row]) => {
          const tone = !row.complete || row.lower ? "down" : changeTone(row.mean_delta_cardiac);
          return (
            <span
              key={name}
              className={cn("rounded border px-1.5 py-0.5 text-xs tabular-nums", CHIP[tone])}
              title={row.ci95
                ? `Mean change in cardiac Dice ${row.mean_delta_cardiac?.toFixed(4)}; 95% interval ${row.ci95[0].toFixed(4)} to ${row.ci95[1].toFixed(4)}; ${row.n} scans`
                : `${row.n} of ${row.expected ?? "?"} scans scored`}
            >
              {DATASET_NAMES[name] ?? name} {row.complete ? points(row.mean_delta_cardiac) : "incomplete"}
            </span>
          );
        })}
      </div>
      {version.gate.against !== active && (
        <p className="text-xs text-muted-foreground">Compared with {version.gate.against}, which is no longer in use</p>
      )}
    </div>
  );
}

export function VersionsTable({ status, reviewing, onReview, onAction }: {
  status: RetrainingStatus;
  reviewing: string | null;
  onReview: (label: string) => void;
  onAction: (label: string, action: VersionAction) => void;
}) {
  const disabled = status.busy;
  // View results scrolls the page up; handing focus back to the ⋯ button would scroll it back down.
  const viewing = useRef(false);
  const shown = status.versions
    .filter(version => version.status !== "deleted")
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || String(b.registered_at).localeCompare(String(a.registered_at)));
  const deleted = status.versions.length - shown.length;
  // After many trainings the history grows long: the newest 10 (with the version in use and the original) by default.
  const [expanded, setExpanded] = useState(false);
  const { rows, hidden } = historyRows(shown, expanded);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Made</TableHead>
              <TableHead title="Change in accuracy on scans the model has never seen">Change on unseen scans</TableHead>
              <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(version => (
              <TableRow key={version.label} data-state={version.label === reviewing ? "selected" : undefined}>
                <TableCell>
                  <button type="button" className="break-all text-left font-medium hover:underline" onClick={() => onReview(version.label)}>
                    {version.label}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {version.is_active && <Badge>In use</Badge>}
                    {version.is_original && <Badge variant="secondary">Original</Badge>}
                    {version.status === "candidate" && <Badge variant="outline">Not in use</Badge>}
                    {version.gate && version.gate.warnings.length > 0 && (
                      <Badge variant="outline" className={CHIP.down} title={version.gate.warnings.join("\n")}>
                        {version.gate.warnings.length} {version.gate.warnings.length === 1 ? "warning" : "warnings"}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {version.registered_at ? new Date(version.registered_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell><Changes version={version} active={status.active} /></TableCell>
                <TableCell className="text-right">
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${version.label}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={event => {
                      if (viewing.current) event.preventDefault();
                      viewing.current = false;
                    }}>
                      <DropdownMenuItem onSelect={() => { viewing.current = true; onReview(version.label); }}>
                        View results
                      </DropdownMenuItem>
                      {version.status === "candidate" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={disabled} onSelect={() => onAction(version.label, "activate")}>
                            Use this version
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={disabled} className="text-red-600 focus:text-red-600 dark:text-red-400"
                                            onSelect={() => onAction(version.label, "reject")}>
                            Delete this version
                          </DropdownMenuItem>
                        </>
                      )}
                      {version.is_original && !version.is_active && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={disabled} onSelect={() => onAction(version.label, "activate")}>
                            Back to the original model
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(hidden > 0 || (expanded && shown.length > HISTORY_ROWS)) && (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setExpanded(!expanded)}>
          {expanded ? `Show the newest ${HISTORY_ROWS} only` : `Show all ${shown.length} versions (${hidden} more)`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Not choosing is fine: a new version stays here until you use it or delete it.
        {deleted > 0 ? ` ${deleted} earlier versions were deleted when they were replaced or you deleted them; the original is always kept.` : ""}
      </p>
    </div>
  );
}
