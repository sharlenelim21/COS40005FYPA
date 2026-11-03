import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap } from "lucide-react";
import { DocImage } from "@/components/doc/DocImage";

export function ReconstructionSection() {
  return (
    <div className="space-y-6 md:space-y-8 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          3D/4D Reconstruction
        </h2>
        <p className="text-muted-foreground mb-6">
          Follow this comprehensive guide to run 3D/4D
          reconstructions. It walks you through preparing your
          project, choosing a reference frame, submitting a
          reconstruction job, monitoring progress, and downloading
          results.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Zap className="w-5 h-5 flex-shrink-0" />
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Reconstruction converts segmentation masks into 3D
            meshes of cardiac structures (myocardium). 4D
            reconstruction produces time-resolved mesh sequences
            across cardiac frames to represent motion. The system
            runs reconstructions on the GPU inference service and
            stores results in cloud storage for download and further
            analysis.
          </p>
          <div className="grid gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
                3D
              </div>
              <div>
                <h4 className="font-semibold">3D Reconstruction</h4>
                <p className="text-sm text-muted-foreground">
                  Single mesh reconstruction generated from a MRI
                  scan with only one frame.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
                4D
              </div>
              <div>
                <h4 className="font-semibold">
                  4D (Time-series) Reconstruction
                </h4>
                <p className="text-sm text-muted-foreground">
                  Mesh sequence generated for multiple frames to
                  capture cardiac motion across time.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              1
            </div>
            Starting a Reconstruction Job
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ensure segmentation has been completed for your project
            first — reconstruction uses those results. Open the
            project and click{" "}
            <strong>Create 4D Reconstruction</strong>.
          </p>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
            <DocImage
              src="/images/doc/project-reconstruction-overview.png"
              alt="Project reconstruction overview"
              className="w-full h-auto rounded-md border shadow-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Project overview with Create 4D Reconstruction button
              to start the process.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              2
            </div>
            Configure 4D Reconstruction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click <strong>Start Reconstruction</strong> to start reconstruction.
          </p>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              • <strong>Segmentation source</strong> — pick MedSAM or UNet. Only that model&apos;s mask is
              used. A card is greyed out if it has no segmentation yet, or marked &quot;In Use&quot; if it
              already has a 4D result (delete it first, or click View 4D).
            </li>
            <li>
              • <strong>Export format</strong> — GLB (recommended, smaller/web-friendly) or OBJ (plain
              text, widely supported).
            </li>
            <li>
              • <strong>ED frame</strong> — the relaxed end-diastole frame. Default 1.
            </li>
            <li>
              • <strong>Advanced settings</strong> (collapsed by default) — SDF iterations (10–200,
              default 30) and mesh resolution (32–256, default 32). Higher values look better but take
              longer.
            </li>
          </ul>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
            <DocImage
              src="/images/doc/project-reconstruction-configuration.png"
              alt="Configure 4D Reconstruction dialog"
              className="w-full h-auto rounded-md border shadow-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Configure 4D Reconstruction dialog.
            </p>
          </div>            
        </CardContent>
      </Card>

      {/* Step 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              3
            </div>
            Inspect &amp; Visualize Results
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            After reconstruction completes, click{" "}
            <strong>View 4D</strong> to open the dedicated,
            full-screen 4D viewer with playback controls.
          </p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              • Inspect the 4D model with playback controls, a frame
              slider, and adjustable playback speed to review cardiac
              motion frame-by-frame
            </li>
            <li>
              • Use <strong>View Segmentation Mask</strong> to jump
              straight to the matching frame in the segmentation
              viewer for comparison
            </li>
            <li>
              • If you re-edit segmentation masks, re-run
              reconstruction to update the 4D model
            </li>
          </ul>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/project-reconstruction.png"
              alt="Reconstruction results"
              className="w-full h-auto rounded-md border shadow-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Reconstruction results showing completed 4D
              reconstruction with metadata and view options.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/project-reconsturction-view.png"
              alt="4D reconstruction viewer"
              className="w-full h-auto rounded-md border shadow-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Interactive 4D viewer with playback timeline controls
              and a link to jump to the matching segmentation frame.
            </p>
          </div>
          <div className="p-2 md:p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 mt-4">
            <p className="text-sm font-medium mb-1">
              💡 Important Note
            </p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                • If you make changes to your segmentation masks,
                you can{" "}
                <strong>re-run reconstruction</strong> to update the
                4D model.
              </li>
              <li>
                • You can also{" "}
                <strong>delete existing reconstructions</strong> and
                create new ones with different parameters.
              </li>
              <li>
                • Reconstruction models are regenerated based on the
                current segmentation state.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Step 4 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              4
            </div>
            Complete Project Details &amp; Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Access comprehensive project information including
            segmentation masks, reconstruction details, job history,
            metadata, and storage statistics all in one place.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
              <DocImage
                src="/images/doc/project-reconstruction-details.png"
                alt="Project details overview"
                className="w-full h-auto rounded-md border shadow-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Comprehensive project details with metadata, storage
                statistics, and segmentation/reconstruction
                information.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
              <DocImage
                src="/images/doc/project-reconstruction-details2.png"
                alt="Project management actions"
                className="w-full h-auto rounded-md border shadow-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Project management panel with export and reset
                options for easy data management.
              </p>
            </div>
          </div>
          <div className="p-2 md:p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mt-4">
            <p className="text-sm font-medium mb-1">
              ⚠️ Reset Masks Warning
            </p>
            <p className="text-sm text-muted-foreground">
              Using the <strong>Reset Masks</strong> option will
              permanently delete all segmentation masks and
              reconstruction data. This action cannot be undone.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
