"use client";

import { ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Eye, Loader2, Lock, Pencil, RefreshCw, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CorrectionCase, isActiveJob, MODEL_NAMES, RetrainingStatus } from "@/lib/retraining-api";
import { LABEL_COLORS } from "@/types/segmentation";
import { canEditCase, editorHref, matchesQuery, selectionSummary, testScanName, trainableCases } from "@/components/extend-training/logic";
import { CasePreview, markEdited } from "@/components/extend-training/CasePreview";

/** Edit tracking's classes as short tags, in the editor's colours; the full name shows on hover. */
const STRUCTURES: Record<string, { short: string; name: string; color: string }> = {
  rv: { short: "RV", name: "Right ventricle", color: LABEL_COLORS.rv },
  myo: { short: "MYO", name: "Myocardium", color: LABEL_COLORS.myo },
  lvc: { short: "LV", name: "Left ventricle cavity", color: LABEL_COLORS.lvc },
};
const CORRECTED_AT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function correctedAt(value: string | null): string {
  return value ? CORRECTED_AT.format(new Date(value)) : "—";
}

function Message({ children }: { children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">{children}</TableCell>
    </TableRow>
  );
}

function StructureTags({ names }: { names: string[] }) {
  return (
    <div className="flex flex-nowrap gap-1">
      {names.map(key => {
        const structure = STRUCTURES[key];
        if (!structure) return null;
        return (
          <span
            key={key}
            title={structure.name}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 text-foreground"
            style={{ backgroundColor: `${structure.color}24` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: structure.color }} aria-hidden />
            {structure.short}
          </span>
        );
      })}
    </div>
  );
}

/** Two models corrected the same slice of this project: D5 keeps only the later save. */
function DuplicateWarning({ item }: { item: CorrectionCase }) {
  const other = item.model === "unet" ? "MedSAM" : "UNet";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="shrink-0 text-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
                aria-label="Duplicate slice edit on another model, only the last edit will be used">
          <AlertTriangle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        Duplicate slice edit on another model, only the last edit will be used.
        <span className="mt-1 block opacity-80">
          {item.shared} {item.shared === 1 ? "slice is" : "slices are"} also corrected in {other}.
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The project is a scan of the frozen test set, which every new version is tested on: it can never train. */
function LockedTestScan({ item }: { item: CorrectionCase }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Test scan: not used for training">
          <Lock className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        Test scan — not used for training
        <span className="mt-1 block opacity-80">
          This is {testScanName(item.frozen?.frozen ?? "")}, one of the scans used to test every new version. If the
          model trained on it, it would already know the answers, and the test would not be fair. You can still
          preview and edit it.
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function IconAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function PrepareTab({ status, userId, selected, onSelectedChange, checking, starting, onCheck, onStart, onShowResults }: {
  status: RetrainingStatus;
  userId: string | null;   // the signed-in admin, who edits only their own cases
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  checking: boolean;
  starting: boolean;
  onCheck: () => void;
  onStart: () => void;
  onShowResults: () => void;
}) {
  const [query, setQuery] = useState("");
  const [previewing, setPreviewing] = useState<CorrectionCase | null>(null);
  const eligible = status.eligible;
  const cases = useMemo(() => eligible?.cases ?? [], [eligible]);
  const trainable = useMemo(() => trainableCases(cases), [cases]);
  const shown = useMemo(() => cases.filter(item => matchesQuery(item, query)), [cases, query]);
  const shownTrainable = trainableCases(shown);
  const summary = selectionSummary(trainable, selected);
  const locked = cases.length - trainable.length;
  const running = isActiveJob(status.job);
  const allShown = shownTrainable.length > 0 && shownTrainable.every(item => selected.has(item.maskId));

  const toggle = (maskId: string, value: boolean) => {
    const next = new Set(selected);
    if (value) next.add(maskId);
    else next.delete(maskId);
    onSelectedChange(next);
  };
  const toggleShown = (value: boolean) => {
    const next = new Set(selected);
    for (const item of shownTrainable) {
      if (value) next.add(item.maskId);
      else next.delete(item.maskId);
    }
    onSelectedChange(next);
  };

  const reason = checking ? "Checking the saved corrections…"
    : running ? "A training is running. The selection stays as it is until it finishes."
    : !eligible ? "The corrections have not been checked yet."
    : trainable.length === 0 ? "None of the corrections can train yet."
    : summary.cases === 0 ? "Choose at least one case."
    : null;
  const canStart = reason === null && !starting && status.training.allowed;

  return (
    <div className="space-y-6">
      {running && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>A training is running</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{status.training.reason}</span>
            <Button size="sm" variant="outline" onClick={onShowResults}>See its progress</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Selected for training</p>
            <p className="text-3xl font-semibold tabular-nums">
              {summary.cases}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                of {trainable.length} cases · {summary.slices} corrected slices
              </span>
            </p>
            {locked > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                {locked} {locked === 1 ? "case is a test scan and is" : "cases are test scans and are"} not used for training
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{eligible ? `Checked ${new Date(eligible.checked_at).toLocaleString()}` : "Not checked yet"}</span>
              <Button variant="link" size="sm" className="h-auto p-0" disabled={checking || running} onClick={onCheck}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
                Check again
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:max-w-sm md:items-end">
            <Button size="lg" disabled={!canStart} onClick={onStart}>
              {starting
                ? "Starting…"
                : summary.cases > 0
                  ? `Train a new version from ${summary.cases} ${summary.cases === 1 ? "case" : "cases"}`
                  : "Train a new version"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground md:text-right">
              The model in use stays active. Nothing is replaced without your approval.
            </p>
            {reason && <p className="text-sm text-amber-700 dark:text-amber-400 md:text-right">{reason}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Corrected cases</CardTitle>
          <CardDescription>
            Every user&apos;s saved corrections. A case is one project, corrected in one model; only its changed slices
            train the new version. You can preview any case; only the user who owns the project can edit it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search projects or users"
                aria-label="Search the corrected cases"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{summary.cases} selected</span>
              <Button variant="link" size="sm" className="h-auto p-0" disabled={running || summary.cases === 0}
                      onClick={() => onSelectedChange(new Set())}>
                Clear selection
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allShown} disabled={running || shownTrainable.length === 0}
                              onCheckedChange={value => toggleShown(value === true)} aria-label="Select every case shown" />
                  </TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Corrected by</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Corrected</TableHead>
                  <TableHead className="text-right">Slices</TableHead>
                  <TableHead>Structures</TableHead>
                  <TableHead className="text-right">Pixels</TableHead>
                  <TableHead className="w-20 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checking && cases.length === 0 && (
                  <Message>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Checking the saved corrections…
                  </Message>
                )}
                {!checking && eligible && cases.length === 0 && (
                  <Message>
                    No corrections can train yet. Open one of your projects, correct its segmentation and save it; only
                    the slices you change count.
                  </Message>
                )}
                {cases.length > 0 && shown.length === 0 && <Message>No case matches “{query}”.</Message>}
                {shown.map(item => {
                  const first = item.slices[0];
                  const model = MODEL_NAMES[item.model] ?? item.model;
                  const mine = canEditCase(item, userId);
                  return (
                    <TableRow key={item.maskId} data-state={selected.has(item.maskId) ? "selected" : undefined}
                              className={item.frozen ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        <Checkbox checked={!item.frozen && selected.has(item.maskId)} disabled={running || !!item.frozen}
                                  onCheckedChange={value => toggle(item.maskId, value === true)}
                                  aria-label={item.frozen ? `${item.projectName} (${model}) is a test scan and is not used for training`
                                    : `Train on ${item.projectName} (${model})`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <button type="button" className="text-left font-medium hover:underline" onClick={() => setPreviewing(item)}>
                            {item.projectName}
                          </button>
                          {item.frozen ? <LockedTestScan item={item} /> : item.shared > 0 && <DuplicateWarning item={item} />}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {mine ? <span className="font-medium">You</span> : item.ownerName ?? "Another user"}
                      </TableCell>
                      <TableCell><Badge variant="outline">{model}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{correctedAt(item.editedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.slices.length}</TableCell>
                      <TableCell><StructureTags names={item.structures} /></TableCell>
                      <TableCell className="text-right tabular-nums">{item.pixelsChanged.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-0.5">
                          <IconAction label="Preview">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewing(item)}
                                    aria-label={`Preview ${item.projectName}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </IconAction>
                          {first && mine && (
                            <IconAction label="Edit in the editor">
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                <Link href={editorHref(item.projectId, item.model, first.frameindex, first.sliceindex)}
                                      onClick={markEdited} aria-label={`Edit ${item.projectName} in the editor`}>
                                  <Pencil className="h-4 w-4" />
                                </Link>
                              </Button>
                            </IconAction>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            A slice counts when at least 20 of its pixels changed their label and none of its regions is marked
            “manual”. Training never changes your scans or your saved corrections.
          </p>
        </CardContent>
      </Card>

      <CasePreview
        item={previewing}
        selected={previewing ? selected.has(previewing.maskId) : false}
        locked={running || !!previewing?.frozen}
        canEdit={previewing ? canEditCase(previewing, userId) : false}
        onSelectedChange={value => { if (previewing) toggle(previewing.maskId, value); }}
        onClose={() => setPreviewing(null)}
      />
    </div>
  );
}
