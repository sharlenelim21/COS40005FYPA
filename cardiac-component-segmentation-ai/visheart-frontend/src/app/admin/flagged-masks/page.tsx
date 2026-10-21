"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, FileEdit, ExternalLink } from "lucide-react";
import { adminAlertStore } from "@/lib/adminAlerts";

interface FlaggedMask {
  maskId: string;
  maskName: string;
  status: string;
  projectId: string;
  projectName: string;
  flaggedAt?: string;
  flaggedByUserId?: string;
  createdByUserId?: string;
  createdByRole?: string;
}

const STATUS_STYLES: Record<string, string> = {
  final: "bg-green-100 text-green-800",
  draft: "bg-amber-100 text-amber-800",
  rejected: "bg-gray-100 text-gray-800",
  superseded: "bg-gray-100 text-gray-800",
};

export default function FlaggedMasksPage() {
  const [masks, setMasks] = useState<FlaggedMask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await adminApi.getFlaggedMasks();
      const list = data?.flaggedMasks ?? [];
      setMasks(list);
      // Visiting this page counts as reviewing the current queue — stops the global
      // notifier from re-chiming about masks already visible here.
      adminAlertStore.markSeen("flagged-masks", list.map((m: FlaggedMask) => m.maskId));
      if (!silent) setError(null);
    } catch {
      if (!silent) setError("Failed to load flagged masks.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll in the background so a newly-flagged mask shows up without a manual refresh.
  // Silent so it never flashes the skeleton loader over an already-loaded table.
  useEffect(() => {
    const interval = setInterval(() => void load(true), 15000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flagged Masks</h1>
          <p className="text-muted-foreground">
            Segmentation edits a Doctor or Clinical Assistant flagged as worth considering for the
            next U-Net retraining round.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileEdit className="h-5 w-5" />
            Review queue ({masks.length})
          </CardTitle>
          <CardDescription>
            Open a case in Extend Training to include its corrections in the next retraining run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : masks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been flagged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mask</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Flagged at</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {masks.map((mask) => (
                  <TableRow key={mask.maskId}>
                    <TableCell className="font-medium">{mask.maskName}</TableCell>
                    <TableCell>{mask.projectName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLES[mask.status] ?? ""}>
                        {mask.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {mask.flaggedAt ? new Date(mask.flaggedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href="/extend-training?tab=prepare">
                        <Button size="sm" variant="outline">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Open in Extend Training
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
