"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  DATASET_NAMES, Gate, isActiveJob, RetrainingStatus, retrainingApi, STRUCTURE_KEYS, STRUCTURE_NAMES,
  StructureKey, VersionAction, VersionResults,
} from "@/lib/retraining-api";
import { LABEL_COLORS } from "@/types/segmentation";
import { changeTone, overallAccuracy, percent, points, verdict, whyNotSwitch } from "@/components/extend-training/logic";
import { ExampleViewer } from "@/components/extend-training/ExampleViewer";
import { TrainingProgress } from "@/components/extend-training/TrainingProgress";
import { VersionsTable } from "@/components/extend-training/VersionsTable";

const STRUCTURE_COLOR: Record<StructureKey, string> = { rv: LABEL_COLORS.rv, myocardium: LABEL_COLORS.myo, lv_cavity: LABEL_COLORS.lvc };
const VERDICT_STYLE = {
  good: "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100",
  mixed: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  bad: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
};
const CHANGE_STYLE = { up: "text-green-600 dark:text-green-400", down: "text-red-600 dark:text-red-400", flat: "text-muted-foreground" };

function dice(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `Dice ${value.toFixed(4)}`;
}

function average(scores: Record<StructureKey, number> | undefined): number | undefined {
  return scores ? STRUCTURE_KEYS.reduce((sum, key) => sum + scores[key], 0) / STRUCTURE_KEYS.length : undefined;
}

function StructureTable({ results, gate, dataset }: { results: VersionResults | null; gate: Gate | null; dataset: string }) {
  const scores = results?.datasets?.[dataset];
  const row = gate?.public[dataset];
  const heart = row?.lower ? "down" : changeTone(row?.mean_delta_cardiac);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Heart structure</TableHead>
            <TableHead className="text-right">Model in use</TableHead>
            <TableHead className="text-right">New version</TableHead>
            <TableHead className="text-right" title="Change in accuracy: the Dice overlap with the expert outline, times 100">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {STRUCTURE_KEYS.map(key => {
            const before = scores?.against[key];
            const after = scores?.label[key];
            const change = before !== undefined && after !== undefined ? after - before : undefined;
            const tone = changeTone(change);
            return (
              <TableRow key={key} className={tone === "down" ? "bg-red-50/60 dark:bg-red-950/20" : undefined}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STRUCTURE_COLOR[key] }} aria-hidden />
                    {STRUCTURE_NAMES[key]}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums" title={dice(before)}>{percent(before)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", tone === "down" && CHANGE_STYLE.down)} title={dice(after)}>
                  {percent(after)}
                </TableCell>
                <TableCell className={cn("text-right font-medium tabular-nums", CHANGE_STYLE[tone])}>{points(change)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow className="font-medium">
            <TableCell>
              Whole heart
              {row?.lower && <Badge variant="destructive" className="ml-2">Lower</Badge>}
              {row && !row.complete && <Badge variant="outline" className="ml-2">Not fully scored</Badge>}
            </TableCell>
            <TableCell className="text-right tabular-nums" title={dice(average(scores?.against))}>{percent(average(scores?.against))}</TableCell>
            <TableCell className="text-right tabular-nums" title={dice(average(scores?.label))}>{percent(average(scores?.label))}</TableCell>
            <TableCell
              className={cn("text-right tabular-nums", CHANGE_STYLE[heart])}
              title={row?.ci95 ? `95% interval ${points(row.ci95[0])} to ${points(row.ci95[1])}, over ${row.n} scans` : undefined}
            >
              {points(row?.mean_delta_cardiac)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/** The whole heart over all three datasets' scans, above the per-dataset table. */
function OverallAccuracy({ results, newName }: { results: VersionResults | null; newName: string }) {
  const total = overallAccuracy(results?.datasets);
  if (!total) return null;
  const change = total.label - total.against;
  const tone = changeTone(change);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Whole-heart accuracy over all {total.datasets === 3 ? "3 datasets" : `${total.datasets} datasets`} ·{" "}
        {total.scans} scans
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          { title: "Model in use", value: percent(total.against), style: "" },
          { title: newName, value: percent(total.label), style: tone === "down" ? CHANGE_STYLE.down : "" },
          { title: "Change", value: points(change), style: CHANGE_STYLE[tone] },
        ].map(item => (
          <div key={item.title} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{item.title}</p>
            <p className={cn("text-2xl font-semibold tabular-nums", item.style)}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionReview({ label, status, admin, onReview, onAction }: {
  label: string;
  status: RetrainingStatus;
  admin: boolean;
  onReview: (label: string) => void;
  onAction: (label: string, action: VersionAction) => void;
}) {
  const version = status.versions.find(item => item.label === label);
  const [results, setResults] = useState<VersionResults | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dataset, setDataset] = useState("acdc");
  const versionState = version?.status;

  useEffect(() => {
    let stopped = false;
    setResults(null);
    setProblem(null);
    void retrainingApi.results(label).then(reply => {
      if (stopped) return;
      if (reply.success && reply.data) setResults(reply.data);
      else setProblem(reply.message);
    });
    return () => {
      stopped = true;
    };
  }, [label, versionState]);

  if (!version) return null;
  const gate = results?.gate ?? version.gate;
  const datasets = Object.keys(gate?.public ?? results?.datasets ?? {});
  const shown = datasets.includes(dataset) ? dataset : datasets[0] ?? dataset;
  const summary = gate ? verdict(gate.public, DATASET_NAMES) : null;
  const scans = gate ? Object.values(gate.public).reduce((sum, row) => sum + (row.n ?? 0), 0) : 0;
  const against = results?.against ?? gate?.against ?? status.original;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="break-all">{label}</CardTitle>
            <CardDescription>
              {version.is_original
                ? "The original model, shipped with VisHeart. Trained versions are compared with it."
                : `Compared with ${against} on ${scans} scans neither was trained on${version.registered_at ? ` · made ${new Date(version.registered_at).toLocaleString()}` : ""}`}
            </CardDescription>
          </div>
          {version.status === "candidate" && <Badge variant="outline">Decision required</Badge>}
          {version.is_active && <Badge>In use</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {summary && (
          <div className={cn("flex items-start gap-3 rounded-lg border p-4", VERDICT_STYLE[summary.tone])}>
            {summary.tone === "good"
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
            <div className="space-y-1">
              <p className="font-medium">{summary.text}</p>
              {gate && gate.warnings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-sm opacity-90">
                  {gate.warnings.map(line => <li key={line}>{line}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
        {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
        <OverallAccuracy results={results} newName={version.is_original ? "Original model" : "New version"} />
        {datasets.length > 0 && (
          <div className="space-y-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={shown} className="flex-wrap"
                         onValueChange={value => { if (value) setDataset(value); }}>
              {datasets.map(name => (
                <ToggleGroupItem key={name} value={name} className="px-3">
                  {DATASET_NAMES[name] ?? name}{gate?.public[name]?.n ? ` · ${gate.public[name].n} scans` : ""}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <StructureTable results={results} gate={gate} dataset={shown} />
            {results && !results.datasets && (
              <p className="text-sm text-muted-foreground">
                The scores by structure need the report that scored this version, and none was found. The whole-heart
                change comes from its comparison.
              </p>
            )}
          </div>
        )}
        {!version.is_original && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            These scans come from ACDC, M&amp;Ms-1 and M&amp;Ms-2, and no training may use them: the frozen-set guard
            refuses any export that holds one. Testing on your own corrected cases would favour the new version unfairly.
          </p>
        )}
        {status.versions.some(item => item.status !== "deleted" && item.label !== label) && (
          <div className="space-y-3">
            <h3 className="font-medium">Inspect scans neither model was trained on</h3>
            {results
              ? <ExampleViewer label={label} against={against} active={status.active} index={results.examples}
                               dataset={shown} versions={status.versions} admin={admin} onChoose={onReview} onAction={onAction}
                               cannotSwitch={whyNotSwitch(status.problem, status.busy)} busy={status.busy} />
              : !problem && <div className="h-24 animate-pulse rounded-md bg-muted" />}
          </div>
        )}
        {version.is_active && !version.is_original && admin && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            This version is in use. To go back, choose the original model in the scan viewer and use it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ResultsTab({ status, admin, reviewing, onReview, onAction, onChanged, onPrepare }: {
  status: RetrainingStatus;
  admin: boolean;
  reviewing: string | null;
  onReview: (label: string) => void;
  onAction: (label: string, action: VersionAction) => void;
  onChanged: () => void;
  onPrepare: () => void;
}) {
  const running = isActiveJob(status.job);
  return (
    <div className="space-y-6">
      {status.problem && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Versions cannot be switched on this computer: {status.problem}. The training data or the model files here
            do not match; see SETUP-ANOTHER-PC.md in visheart-retraining.
          </AlertDescription>
        </Alert>
      )}
      {status.job && <TrainingProgress job={status.job} admin={admin} onChanged={onChanged} />}
      {reviewing ? (
        <VersionReview key={reviewing} label={reviewing} status={status} admin={admin} onReview={onReview} onAction={onAction} />
      ) : !running && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="font-medium">No new version to review yet.</p>
            <p className="text-sm text-muted-foreground">
              {admin
                ? "Choose the corrected cases on the Prepare tab and train a new version. Its results appear here."
                : "An admin trains new versions from the corrected cases. Their results appear here."}
            </p>
            <Button variant="outline" onClick={onPrepare}>Go to Prepare</Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
          <CardDescription>
            Every version on this computer. The original is always kept; a version is deleted when another replaces it or when you delete it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VersionsTable status={status} admin={admin} reviewing={reviewing} onReview={onReview} onAction={onAction} />
        </CardContent>
      </Card>
    </div>
  );
}
