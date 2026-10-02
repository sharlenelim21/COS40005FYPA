"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Brain, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EDITED_KEY } from "@/components/extend-training/CasePreview";
import { clearedCases, initialSelection, reviewLabel, trainableCases } from "@/components/extend-training/logic";
import { PrepareTab } from "@/components/extend-training/PrepareTab";
import { ResultsTab } from "@/components/extend-training/ResultsTab";
import { SwitchDialog, SwitchTarget } from "@/components/extend-training/SwitchDialog";
import { isActiveJob, RetrainingStatus, retrainingApi } from "@/lib/retraining-api";

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 30000;
const CLEARED_KEY = "extend-training-cleared"; // this browser only: the cases the user chose to leave out

type Tab = "prepare" | "results";

function readCleared(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function writeCleared(ids: string[]): void {
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify(ids));
  } catch {
    // the page works without it; the choice is just not remembered
  }
}

function takeEditedFlag(): boolean {
  try {
    const edited = sessionStorage.getItem(EDITED_KEY) !== null;
    sessionStorage.removeItem(EDITED_KEY);
    return edited;
  } catch {
    return false;
  }
}

function ModelInUse({ status }: { status: RetrainingStatus }) {
  const active = status.versions.find(version => version.is_active);
  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-sm md:min-w-64">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Model in use</p>
      <p className="mt-1 flex items-center gap-2 font-medium">
        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
        {status.active}
      </p>
      <p className="text-xs text-muted-foreground">
        {status.active === status.original ? "The original model" : `Trained from ${active?.base ?? status.original}`}
      </p>
    </div>
  );
}

function ExtendTrainingInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const asked = searchParams.get("tab");
  const [tab, setTabState] = useState<Tab | null>(asked === "prepare" || asked === "results" ? asked : null);
  const [status, setStatus] = useState<RetrainingStatus | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<SwitchTarget | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const previousJob = useRef<{ id: string; state: string } | null>(null);
  const autoChecked = useRef(false);
  const knownCases = useRef<string | null>(null);
  const registered = Boolean(user && user.role !== "guest");

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    router.replace(`/extend-training?tab=${next}`, { scroll: false });
  }, [router]);

  const refresh = useCallback(async (): Promise<RetrainingStatus | null> => {
    const reply = await retrainingApi.status();
    if (!reply.success || !reply.data) {
      setOffline(reply.message || "The training service could not be reached.");
      return null;
    }
    setOffline(null);
    setStatus(reply.data);
    const job = reply.data.job;
    const before = previousJob.current;
    if (job && before && before.id === job.id && before.state !== job.state && (before.state === "running" || before.state === "queued")) {
      if (job.state === "succeeded") toast.success("A new version is ready for review.");
      if (job.state === "failed") toast.error(job.error ?? "Training did not finish.");
    }
    previousJob.current = job ? { id: job.id, state: job.state } : null;
    return reply.data;
  }, []);

  const checkCorrections = useCallback(async () => {
    setChecking(true);
    const reply = await retrainingApi.checkCorrections();
    setChecking(false);
    if (!reply.success) toast.error(reply.message);
    await refresh();
  }, [refresh]);

  // First load: check again when the last check is old, or when coming back from Edit.
  useEffect(() => {
    if (!registered) return;
    let stopped = false;
    void (async () => {
      const data = await refresh();
      if (stopped || !data || autoChecked.current) return;
      const cameBack = takeEditedFlag();
      if (!data.busy && (cameBack || !data.eligible || !data.eligible.fresh)) {
        autoChecked.current = true;
        await checkCorrections();
      }
    })();
    return () => {
      stopped = true;
    };
  }, [registered, refresh, checkCorrections]);

  const busy = status?.busy ?? false;
  useEffect(() => {
    if (!registered) return;
    const timer = window.setInterval(() => void refresh(), busy ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [registered, busy, refresh]);

  // Without ?tab=, open Results while a training runs or its new version awaits a decision.
  useEffect(() => {
    if (tab || !status) return;
    const job = status.job;
    const waiting = job?.state === "succeeded"
      && status.versions.some(version => version.label === job.result?.label && version.status === "candidate");
    setTabState(isActiveJob(job) || waiting ? "results" : "prepare");
  }, [tab, status]);

  // Every case that can train starts selected, except those this browser remembers the user clearing.
  const cases = status?.eligible?.cases;
  const caseKey = cases ? trainableCases(cases).map(item => item.maskId).join(",") : null;
  useEffect(() => {
    if (caseKey === null || caseKey === knownCases.current) return;
    knownCases.current = caseKey;
    setSelected(new Set(initialSelection(caseKey ? caseKey.split(",") : [], readCleared())));
  }, [caseKey]);

  const changeSelection = useCallback((next: Set<string>) => {
    setSelected(next);
    if (caseKey !== null) writeCleared(clearedCases(caseKey ? caseKey.split(",") : [], next));
  }, [caseKey]);

  const start = async () => {
    setStarting(true);
    const reply = await retrainingApi.start([...selected]);
    setStarting(false);
    if (reply.success) {
      toast.success("Training started. You can close this page; it keeps going.");
      setTab("results");
    } else {
      toast.error(reply.message);
    }
    await refresh();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!registered) {
    return (
      <div className="container mx-auto max-w-3xl p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sign in to use UNet Extend Training</AlertTitle>
          <AlertDescription>
            Training a new version of the model needs a user or admin account. Guest accounts cannot use it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const shownReview = reviewing && status?.versions.some(version => version.label === reviewing && version.status !== "deleted")
    ? reviewing
    : status ? reviewLabel(status.versions, status.job?.result?.label) : null;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Link href="/dashboard" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6" />
            UNet Extend Training
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Teach the segmentation model from the corrections you saved. A new version is compared on scans it has never
            seen, and nothing changes until you choose to use it.
          </p>
        </div>
        {status && <ModelInUse status={status} />}
      </header>

      {status?.simulated && (
        <Alert>
          <AlertTitle>Simulation mode</AlertTitle>
          <AlertDescription>
            The training service was started with --simulate. Your corrections are listed for real, but a training only
            walks through its steps: nothing is exported, trained or changed.
          </AlertDescription>
        </Alert>
      )}

      {offline && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>The training service is not available</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{offline}</p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>Try again</Button>
          </AlertDescription>
        </Alert>
      )}

      {!status && !offline && <div className="h-40 animate-pulse rounded-lg bg-muted" />}

      {status && tab && (
        <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="gap-4">
          <TabsList>
            <TabsTrigger value="prepare">1 · Prepare</TabsTrigger>
            <TabsTrigger value="results" className="gap-1.5">
              2 · Results
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="A training is running" />}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="prepare">
            <PrepareTab
              status={status}
              selected={selected}
              onSelectedChange={changeSelection}
              checking={checking}
              starting={starting}
              onCheck={() => void checkCorrections()}
              onStart={() => void start()}
              onShowResults={() => setTab("results")}
            />
          </TabsContent>
          <TabsContent value="results">
            <ResultsTab
              status={status}
              reviewing={shownReview}
              onReview={label => {
                setReviewing(label);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onAction={(label, action) => setTarget({ label, action })}
              onChanged={() => void refresh()}
              onPrepare={() => setTab("prepare")}
            />
          </TabsContent>
        </Tabs>
      )}

      <SwitchDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void refresh();
        }}
      />
    </div>
  );
}

export default function ExtendTrainingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <ExtendTrainingInner />
    </Suspense>
  );
}
