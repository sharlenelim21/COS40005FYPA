"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClaimText } from "@/components/doc/medical/Citation";
import type { Claim } from "@/content/medicalGuide";
import { projectApi } from "@/lib/api";
import { SEGMENT_LABELS } from "@/lib/ahaSegments";
import { strainRampHex, strainScaleFraction } from "@/lib/strainColorScale";
import { cn } from "@/lib/utils";
import type { TemplateProjectSummary } from "@/types/project";

// The template hearts as worked examples of the ACDC groups: a gallery of cards
// (one column per group); selecting a card opens its check against each of the
// group's criteria below the grid, with a link to the template itself.

type Group = "NOR" | "HCM" | "DCM";
type MetricKey = "lvef" | "lvedvi" | "maxWallThicknessMm" | "rvedvi" | "rvef" | "lvmi";

const GROUPS: { id: Group; name: string; gist: string }[] = [
  { id: "NOR", name: "Normal (NOR)", gist: "Normal structure and pumping" },
  { id: "HCM", name: "Hypertrophic cardiomyopathy (HCM)", gist: "Thick wall, normal pumping" },
  { id: "DCM", name: "Dilated cardiomyopathy (DCM)", gist: "Enlarged, weak left ventricle" },
];

const METRICS: Record<MetricKey, { name: string; short: string; unit: string; domain: [number, number] }> = {
  lvef: { name: "LV ejection fraction", short: "EF", unit: "%", domain: [0, 80] },
  lvedvi: { name: "LV end-diastolic volume index", short: "LV volume index", unit: "mL/m²", domain: [0, 280] },
  maxWallThicknessMm: { name: "Thickest LV wall at end-diastole", short: "Thickest wall", unit: "mm", domain: [0, 24] },
  rvedvi: { name: "RV end-diastolic volume index", short: "RV volume index", unit: "mL/m²", domain: [0, 140] },
  rvef: { name: "RV ejection fraction", short: "RV EF", unit: "%", domain: [0, 80] },
  lvmi: { name: "LV mass index", short: "LV mass index", unit: "g/m²", domain: [0, 160] },
};

/** The numbers each card shows; the full check lists every criterion. */
const CARD_METRICS: Record<Group, MetricKey[]> = {
  NOR: ["lvef", "lvedvi", "maxWallThicknessMm"],
  HCM: ["lvef", "maxWallThicknessMm", "lvmi"],
  DCM: ["lvef", "lvedvi", "maxWallThicknessMm"],
};

interface Criterion {
  key: MetricKey;
  op: ">" | "<";
  threshold: number;
  /** Who the threshold applies to, when it depends on sex. */
  appliesTo?: string;
  /** Seen in some patients of the group, but not one of its criteria. */
  optional?: boolean;
}

/** Each group's criteria, from Bernard et al. 2018, Section III-A-1 ("Patient selection"). */
function criteriaFor(group: Group, sex: string | undefined): Criterion[] {
  switch (group) {
    case "NOR":
      return [
        { key: "lvef", op: ">", threshold: 50 },
        { key: "maxWallThicknessMm", op: "<", threshold: 12 },
        sex === "male"
          ? { key: "lvedvi", op: "<", threshold: 90, appliesTo: "men" }
          : { key: "lvedvi", op: "<", threshold: 80, appliesTo: "women" },
        { key: "rvedvi", op: "<", threshold: 100 },
        { key: "rvef", op: ">", threshold: 40 },
      ];
    case "HCM":
      return [
        { key: "lvef", op: ">", threshold: 55 },
        { key: "maxWallThicknessMm", op: ">", threshold: 15 },
        { key: "lvmi", op: ">", threshold: 110, optional: true },
      ];
    case "DCM":
      return [
        { key: "lvef", op: "<", threshold: 40 },
        { key: "lvedvi", op: ">", threshold: 100 },
        { key: "maxWallThicknessMm", op: "<", threshold: 12 },
      ];
  }
}

/** Disease pattern gate codes (diseasePatternGates.met_codes) → the guide's group names. */
const GATE_NAMES: Record<string, { group?: Group; label: string }> = {
  NOR_LV: { group: "NOR", label: "NOR" },
  NOR_RV: { group: "NOR", label: "NOR" },
  HCM: { group: "HCM", label: "HCM" },
  DCM: { group: "DCM", label: "DCM" },
  MINF: { label: "MINF" },
  RV: { label: "ARV" },
};

const isGroup = (value: unknown): value is Group => value === "NOR" || value === "HCM" || value === "DCM";
const fmt = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1));
const meets = (value: number, c: Criterion) => (c.op === ">" ? value > c.threshold : value < c.threshold);
const personLabel = (t: TemplateProjectSummary) =>
  `${t.templateInfo?.sex === "male" ? "Man" : "Woman"}${t.templateInfo?.age ? `, ${t.templateInfo.age}` : ""}`;

export function ReferenceHearts({ note }: { note?: Claim }) {
  const [templates, setTemplates] = useState<TemplateProjectSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    projectApi
      .getTemplateSummaries()
      .then((res) => active && setTemplates(res.templates.filter((t) => isGroup(t.templateInfo?.category))))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        The reference hearts could not be loaded. Check that VisHeart&apos;s server is running, then reload the page.
      </p>
    );
  }
  if (templates && templates.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        No reference hearts are installed yet.
      </p>
    );
  }

  const selected = templates?.find((t) => t.projectId === selectedId) ?? null;
  const selectedGroup = selected?.templateInfo?.category;
  const ofGroup = (group: Group) =>
    (templates ?? [])
      .filter((t) => t.templateInfo?.category === group)
      .sort((a, b) => (a.templateInfo?.order ?? 99) - (b.templateInfo?.order ?? 99));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {GROUPS.map((group) => (
          <div key={group.id} className="min-w-0 space-y-3">
            <div>
              <h4 className="text-sm font-semibold">{group.name}</h4>
              <p className="text-muted-foreground text-xs">{group.gist}</p>
            </div>
            {templates
              ? ofGroup(group.id).map((t) => (
                  <HeartCard
                    key={t.projectId}
                    template={t}
                    group={group.id}
                    selected={t.projectId === selectedId}
                    onSelect={() => setSelectedId(t.projectId === selectedId ? null : t.projectId)}
                  />
                ))
              : [0, 1].map((i) => <div key={i} className="bg-muted h-28 animate-pulse rounded-lg" />)}
          </div>
        ))}
      </div>

      {selected && isGroup(selectedGroup) && <HeartDetail template={selected} group={selectedGroup} />}

      {note && (
        <p className="text-muted-foreground text-xs">
          <ClaimText claim={note} />
        </p>
      )}
    </div>
  );
}

function HeartCard({
  template,
  group,
  selected,
  onSelect,
}: {
  template: TemplateProjectSummary;
  group: Group;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      aria-controls="reference-heart-detail"
      className={cn(
        "bg-card grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-lg border p-3 text-left transition-colors",
        "hover:border-foreground/30 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        selected && "border-primary ring-primary ring-1",
      )}
    >
      <StrainBullseye segments={template.strainSegments} size={64} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{personLabel(template)}</span>
        {template.templateInfo?.subjectCode && (
          <span className="text-muted-foreground block font-mono text-[11px]">{template.templateInfo.subjectCode}</span>
        )}
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          {CARD_METRICS[group].map((key) => {
            const value = template.metrics[key];
            return (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{METRICS[key].short}</dt>
                <dd className="font-medium tabular-nums">
                  {typeof value === "number" ? `${fmt(value)} ${METRICS[key].unit}` : "—"}
                </dd>
              </div>
            );
          })}
        </dl>
      </span>
    </button>
  );
}

function HeartDetail({ template, group }: { template: TemplateProjectSummary; group: Group }) {
  const groupName = GROUPS.find((g) => g.id === group)?.name ?? group;
  const alsoMeets = [
    ...new Set(
      (template.patternGates ?? []).flatMap((code) => {
        const gate = GATE_NAMES[code];
        return gate && gate.group !== group ? [gate.label] : [];
      }),
    ),
  ];

  return (
    <div
      id="reference-heart-detail"
      className="bg-card grid gap-5 rounded-lg border p-4 md:grid-cols-[11rem_minmax(0,1fr)] md:p-5"
    >
      <div className="space-y-3">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{groupName}</p>
          <p className="text-base font-semibold">{personLabel(template)}</p>
        </div>
        <StrainBullseye segments={template.strainSegments} size={128} />
        <div className="w-36 space-y-1">
          <div
            className="h-1.5 rounded-full"
            style={{ background: `linear-gradient(to right, ${strainRampHex(0)}, ${strainRampHex(0.5)}, ${strainRampHex(1)})` }}
          />
          <div className="text-muted-foreground flex justify-between text-[10px] tabular-nums">
            <span>0%</span>
            <span>Radial strain</span>
            <span>80%</span>
          </div>
        </div>
        {template.healthStatus && (
          <Badge variant="outline" className="font-medium">
            VisHeart health status: {template.healthStatus}
          </Badge>
        )}
        <div className="space-y-1.5">
          <Button asChild size="sm" className="w-full">
            <Link href={`/project/${template.projectId}/landmark-detection`}>
              Open this heart
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
          <p className="text-muted-foreground text-[11px] leading-snug">
            Scan, 3D model and strain, read-only. Needs a VisHeart account.{" "}
            <Link href="/dashboard?tab=templates" className="text-primary underline-offset-2 hover:underline">
              All templates
            </Link>
          </p>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        {criteriaFor(group, template.templateInfo?.sex).map((c) => (
          <CriterionRow key={c.key} criterion={c} value={template.metrics[c.key]} />
        ))}
        {alsoMeets.length > 0 && (
          <p className="text-muted-foreground border-t pt-3 text-xs">
            This heart also meets the {alsoMeets.join(" and ")} criteria. A heart can meet more than one group&apos;s
            criteria; in the ACDC dataset each patient was given one label.
          </p>
        )}
      </div>
    </div>
  );
}

function CriterionRow({ criterion, value }: { criterion: Criterion; value: number | null | undefined }) {
  const metric = METRICS[criterion.key];
  const measured = typeof value === "number";
  const ok = measured && meets(value, criterion);
  const rule = `${criterion.op === ">" ? "Above" : "Below"} ${criterion.threshold} ${metric.unit}${
    criterion.appliesTo ? ` for ${criterion.appliesTo}` : ""
  }${criterion.optional ? ". Seen in some patients, not required" : ""}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <div className="min-w-0">
        <p className="text-sm font-medium">{metric.name}</p>
        <p className="text-muted-foreground text-xs">{rule}</p>
      </div>
      {criterion.optional ? (
        <Badge variant="outline" className="font-medium">
          {ok ? "Above" : "Not above"}
        </Badge>
      ) : !measured ? (
        <Badge variant="outline" className="font-medium">Not measured</Badge>
      ) : ok ? (
        <Badge className="border-transparent bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          Meets
        </Badge>
      ) : (
        <Badge variant="outline" className="border-red-300 font-medium text-red-700 dark:border-red-800 dark:text-red-400">
          Doesn&apos;t meet
        </Badge>
      )}
      <div className="col-span-2">{measured && <CriterionScale criterion={criterion} value={value} />}</div>
    </div>
  );
}

/** One criterion as a number line: the group's range shaded, its limit marked, this heart as a dot. */
function CriterionScale({ criterion, value }: { criterion: Criterion; value: number }) {
  const metric = METRICS[criterion.key];
  const [lo, hi] = metric.domain;
  const at = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100;
  const limit = at(criterion.threshold);
  const dot = at(value);
  const zone = criterion.op === ">" ? { left: limit, width: 100 - limit } : { left: 0, width: limit };
  // Keep labels inside the line near its ends.
  const shift = (pos: number) => (pos < 12 ? "translateX(0)" : pos > 88 ? "translateX(-100%)" : "translateX(-50%)");

  return (
    <div
      className="relative h-12"
      role="img"
      aria-label={`${metric.name}: ${fmt(value)} ${metric.unit}; limit ${criterion.op === ">" ? "above" : "below"} ${criterion.threshold} ${metric.unit}`}
    >
      <span
        className="absolute top-0 text-xs font-semibold whitespace-nowrap tabular-nums"
        style={{ left: `${dot}%`, transform: shift(dot) }}
      >
        {fmt(value)} {metric.unit}
      </span>
      <div className="bg-muted absolute inset-x-0 top-[1.4rem] h-1 rounded-full" />
      <div
        className={cn("absolute top-[1.15rem] h-3 rounded", criterion.optional ? "bg-foreground/10" : "bg-emerald-500/25")}
        style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
      />
      <div className="bg-muted-foreground absolute top-[0.95rem] h-4 w-px" style={{ left: `${limit}%` }} />
      <span
        className="text-muted-foreground absolute top-[2.15rem] text-[10px] whitespace-nowrap tabular-nums"
        style={{ left: `${limit}%`, transform: shift(limit) }}
      >
        {criterion.op === ">" ? "above" : "below"} {criterion.threshold}
      </span>
      <span
        className="bg-foreground ring-card absolute top-[1.05rem] size-3 rounded-full ring-2"
        style={{ left: `calc(${dot}% - 0.375rem)` }}
      />
    </div>
  );
}

/** AHA 17-segment bullseye of radial strain, anterior at the top and septum on the left, as in VisHeart. */
function StrainBullseye({ segments, size }: { segments?: (number | null)[] | null; size: number }) {
  const radii = [0, 10, 22, 35, 48];
  const point = (r: number, deg: number) =>
    `${(50 + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(50 - r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const sector = (r0: number, r1: number, a0: number, a1: number) =>
    `M${point(r1, a0)}A${r1} ${r1} 0 0 0 ${point(r1, a1)}L${point(r0, a1)}A${r0} ${r0} 0 0 1 ${point(r0, a0)}Z`;
  const fill = (i: number) => {
    const v = segments?.[i];
    return typeof v === "number" ? strainRampHex(strainScaleFraction(v, "LV_GRS")) : "var(--muted)";
  };
  const title = (i: number) => {
    const v = segments?.[i];
    return `${i + 1} ${SEGMENT_LABELS[i]}: ${typeof v === "number" ? `${fmt(v)}%` : "not measured"}`;
  };
  const six = [90, 150, 210, 270, 330, 30];
  const four = [90, 180, 270, 0];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Radial strain by AHA segment"
      className="max-w-full shrink-0"
      style={{ stroke: "var(--card)", strokeWidth: 1.2 }}
    >
      {six.map((c, k) => (
        <path key={`b${k}`} d={sector(radii[3], radii[4], c - 30, c + 30)} fill={fill(k)}>
          <title>{title(k)}</title>
        </path>
      ))}
      {six.map((c, k) => (
        <path key={`m${k}`} d={sector(radii[2], radii[3], c - 30, c + 30)} fill={fill(k + 6)}>
          <title>{title(k + 6)}</title>
        </path>
      ))}
      {four.map((c, k) => (
        <path key={`a${k}`} d={sector(radii[1], radii[2], c - 45, c + 45)} fill={fill(k + 12)}>
          <title>{title(k + 12)}</title>
        </path>
      ))}
      <circle cx="50" cy="50" r={radii[1]} fill={fill(16)}>
        <title>{title(16)}</title>
      </circle>
    </svg>
  );
}
