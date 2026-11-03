"use client";

// Dashboard "Templates" tab: pre-computed, read-only reference hearts (a female
// and a male normal heart, a female and a male HCM heart). Each card opens the
// project's landmark page, which shows the results without any editing — see
// ProjectData.isTemplate / readOnly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Heart, Lock, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { projectApi } from "@/lib/api";
import type { TemplateProjectSummary } from "@/types/project";

const CATEGORY_LABEL: Record<string, string> = {
  NOR: "Normal heart",
  HCM: "Hypertrophic cardiomyopathy (HCM)",
  DCM: "Dilated cardiomyopathy (DCM)",
};
const CATEGORY_BLURB: Record<string, string> = {
  NOR: "Reference hearts with normal size, wall thickness and pumping function.",
  HCM: "Hearts with a thickened left-ventricle wall and preserved pumping function.",
  DCM: "Hearts with an enlarged left ventricle and reduced pumping function.",
};
const CATEGORY_COLOR: Record<string, string> = { NOR: "text-red-500", HCM: "text-orange-500", DCM: "text-purple-500" };

const fmt = (v: number | null | undefined, digits = 0, unit = "") =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : "—";

function TemplateCard({ t }: { t: TemplateProjectSummary }) {
  const info = t.templateInfo;
  const sex = info?.sex === "female" ? "Female" : info?.sex === "male" ? "Male" : "—";
  const bsa = info?.heightCm && info?.weightKg ? Math.sqrt((info.heightCm * info.weightKg) / 3600) : null;
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{sex}</CardTitle>
            <CardDescription>
              {info?.age != null ? `Age ${info.age}` : ""}
              {info?.heightCm ? ` · ${info.heightCm} cm` : ""}
              {info?.weightKg ? ` · ${info.weightKg} kg` : ""}
              {bsa ? ` · BSA ${bsa.toFixed(2)} m²` : ""}
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 whitespace-nowrap">
            <Lock className="h-3 w-3" /> Read-only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">LV ejection fraction</dt>
          <dd className="text-right font-medium tabular-nums">{fmt(t.metrics.lvef, 0, "%")}</dd>
          <dt className="text-muted-foreground">LV end-diastolic volume</dt>
          <dd className="text-right font-medium tabular-nums">{fmt(t.metrics.lvedv, 0, " mL")}</dd>
          <dt className="text-muted-foreground">LV mass</dt>
          <dd className="text-right font-medium tabular-nums">{fmt(t.metrics.lvMass, 0, " g")}</dd>
          <dt className="text-muted-foreground">RV ejection fraction</dt>
          <dd className="text-right font-medium tabular-nums">{fmt(t.metrics.rvef, 0, "%")}</dd>
        </dl>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {t.dimensions?.frames ? `${t.dimensions.frames} frames` : ""}
            {t.dimensions?.slices ? ` · ${t.dimensions.slices} slices` : ""}
          </span>
          <Button asChild size="sm">
            <Link href={`/project/${t.projectId}/landmark-detection`}>
              <Eye className="mr-2 h-4 w-4" /> View results
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<TemplateProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await projectApi.getTemplateProjects();
      setTemplates(res.templates ?? []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message ?? err?.message ?? "Could not load the templates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const groups = ["NOR", "HCM", "DCM"].map((cat) => ({
    cat,
    items: (templates ?? []).filter((t) => t.templateInfo?.category === cat),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold">Template hearts</h2>
          <p className="text-muted-foreground text-sm">
            Fully analysed reference hearts. Open one to explore its landmarks, structure and strain —
            nothing needs to be run, and nothing can be changed.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && templates?.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No template hearts are available yet.
          </CardContent>
        </Card>
      )}

      {groups.map(({ cat, items }) =>
        items.length === 0 ? null : (
          <section key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              <Heart className={`h-5 w-5 ${CATEGORY_COLOR[cat] ?? "text-red-500"}`} />
              <h3 className="text-lg font-semibold">{CATEGORY_LABEL[cat]}</h3>
            </div>
            <p className="text-muted-foreground -mt-2 text-sm">{CATEGORY_BLURB[cat]}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((t) => (
                <TemplateCard key={t.projectId} t={t} />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
