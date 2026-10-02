import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocImage } from "@/components/doc/DocImage";

export function LandmarkDetectionSection() {
  return (
    <div className="space-y-6 md:space-y-8 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          How Landmark Detection Works
        </h2>
        <p className="text-muted-foreground mb-6">
          Landmark detection finds the RV insertion points on each frame, then uses them to compute
          regional strain — shown as an AHA 17-segment bullseye synced with a 3D heart model.
        </p>
      </div>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              1
            </div>
            Starting a Landmark Detection Job
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click into the highlighted <strong>Landmark Detection</strong> button on the project page. The
            detection runs automatically using the model shown in the page header.
          </p>
          <p className="text-sm text-muted-foreground">
            Switch to the <strong>Landmarks</strong> tab anytime to check the detected points frame by
            frame.
          </p>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
            <DocImage
              src="/images/doc/landmark-start.png"
              alt="Landmark Detection button on the project page"
              className="w-full h-auto rounded-md border shadow-sm"
            />
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
            Bullseye / Regional Strain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Switch to the <strong>Strain</strong> tab, then click <strong>Recompute all frames</strong> to
            measure wall thickness and strain (GRS/GCS) across the whole cardiac cycle for the selected
            model.
          </p>
          <p className="text-sm text-muted-foreground">
            The bullseye stays synced with the 3D heart model, and <strong>By Region</strong> /{" "}
            <strong>Full Cycle</strong> break the same data down further. GLS isn&apos;t shown — it needs a
            4-chamber view, and this pipeline only reads short-axis slices.
          </p>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
            <DocImage
              src="/images/doc/landmark-workspace-strain-bullseye.png"
              alt="Strain tab with bullseye and 3D heart model"
              className="w-full h-auto rounded-md border shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {[
              { src: "/images/doc/landmark-strain-region-basal.png", label: "Basal ring" },
              { src: "/images/doc/landmark-strain-region-mid.png", label: "Mid ring" },
              { src: "/images/doc/landmark-strain-region-apical.png", label: "Apical ring" },
              { src: "/images/doc/landmark-strain-region-apex.png", label: "Apex" },
              { src: "/images/doc/landmark-strain-full-cycle.png", label: "Full Cycle" },
            ].map((img) => (
              <div key={img.label} className="rounded-lg border bg-muted/30 p-1.5">
                <DocImage
                  src={img.src}
                  alt={`${img.label} strain chart`}
                  className="w-full h-auto rounded-md border shadow-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1 text-center">
                  {img.label}
                </p>
              </div>
            ))}
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
            Report &amp; Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click <strong>Report Page</strong> for a printable functional analysis report (measurements,
            health status, disease pattern similarity, regional strain), or{" "}
            <strong>Export Data</strong> to download the raw numbers.
          </p>
          <p className="text-sm text-muted-foreground">
            Health Status and Disease Pattern Similarity are rule-based comparisons, not diagnoses.
          </p>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
            <DocImage
              src="/images/doc/landmark-export-report.png"
              alt="Cardiac Functional Analysis Report page"
              className="w-full h-auto rounded-md border shadow-sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
