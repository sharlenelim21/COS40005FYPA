import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes } from "lucide-react";
import { DocImage } from "@/components/doc/DocImage";

export function SegmentDivisionSection() {
  return (
    <div className="space-y-6 md:space-y-8 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          How Segments Division on 3D Model Works
        </h2>
        <p className="text-muted-foreground mb-6">
          Separately from the 2D bullseye plots, VisHeart&apos;s 3D heart
          model needs every point on its surface to know which AHA segment
          it belongs to, so it can be coloured segment by segment. VisHeart
          currently gets there differently for each ventricle.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <Boxes className="w-5 h-5 flex-shrink-0" />
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
                LV
              </div>
              <div>
                <h4 className="font-semibold">Left Ventricle — 17 Segments</h4>
                <p className="text-sm text-muted-foreground">
                  Labelled by warping a reference atlas shape onto the
                  patient&apos;s own reconstructed mesh.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
                RV
              </div>
              <div>
                <h4 className="font-semibold">Right Ventricle — 9 Segments</h4>
                <p className="text-sm text-muted-foreground">
                  Built per-slice from the septal direction, then labelled
                  directly from the patient&apos;s own stacked 2D segments,
                  with no reference atlas involved.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LV */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              LV
            </div>
            Left Ventricle 17 Segments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The left ventricle&apos;s 3D model is labelled by comparing it
            against a single reference heart shape that was already divided
            into its 17 segments once, then letting every point on the
            patient&apos;s own model borrow its label from whichever point on
            that reference shape it lines up with most closely.
          </p>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              • That reference shape is elastically warped — stretched and
              bent, not just rotated or resized — to line up with the
              patient&apos;s own reconstructed left ventricle, using an
              algorithm called Coherent Point Drift (Myronenko &amp; Song,
              2010).
            </li>
            <li>
              • Once the two shapes are aligned, each point on the
              patient&apos;s model is given the segment label of whichever
              point on the warped reference shape ends up closest to it.
            </li>
            <li>
              • If that alignment step doesn&apos;t produce a usable result,
              VisHeart falls back to a simpler, fixed geometric rule
              (dividing the shape by height and angle) instead of leaving
              the model unlabelled.
            </li>
          </ul>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/lv_cpd_atlas_meshes.png"
              alt="3D plot of multiple reference atlas meshes, normalized and aligned into the same coordinate frame."
              className="w-full h-auto rounded-md border shadow-sm bg-white"
            />
            <p className="text-xs text-muted-foreground mt-2">
              The reference atlas meshes, normalized and aligned into one
              coordinate frame, ready to be registered against a patient
              mesh.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/lv_cpd_sampled_points.png"
              alt="3D scatter plot of thousands of points densely sampled from the surface of a normalized left ventricle mesh, forming a dense point cloud."
              className="w-full h-auto rounded-md border shadow-sm bg-white"
            />
            <p className="text-xs text-muted-foreground mt-2">
              The patient&apos;s own mesh is normalized and sampled into a
              dense point cloud — this is what the atlas gets registered
              against.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/lv_cpd_deformed_meshes.png"
              alt="3D plot of the reference atlas meshes after Coherent Point Drift deformation, now bent and aligned to the patient's own mesh shape."
              className="w-full h-auto rounded-md border shadow-sm bg-white"
            />
            <p className="text-xs text-muted-foreground mt-2">
              After Coherent Point Drift, the atlas meshes are elastically
              deformed to align with the patient&apos;s own shape. Each point
              on the patient&apos;s mesh then borrows the segment label of
              whichever atlas point ends up closest to it.
            </p>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Figures from VisHeart&apos;s own research notebook prototyping
            this CPD atlas-warp method.
          </p>
        </CardContent>
      </Card>

      {/* RV */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              RV
            </div>
            Right Ventricle 9 Segments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The AHA standard above only covers the left ventricle. VisHeart
            gives the right ventricle 9 segments of its own, built on the
            same idea — extending the AHA model to the RV — but worked out
            and tested by the team in-house, not copied from any one
            published algorithm.
          </p>

          <h4 className="font-semibold text-sm">
            Step 1 — Building the 9 segments per slice
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              • Like the left ventricle, the right ventricle is first split
              into three levels from base to apex — basal, mid and apical —
              and each level is then divided into 3 segments going around
              it, for 9 in total.
            </li>
            <li>
              • To work out where those 3 segments fall at each level,
              VisHeart starts from the Right Ventricle Segmentation masks
              output: it finds the RV&apos;s own centre point on that slice,
              then draws a line straight through it, at a right angle to the
              direction pointing from the RV&apos;s centre towards the
              LV&apos;s centre (that direction is the septum — the wall
              between the two ventricles, and a natural, consistent
              landmark to anchor the cut to).
            </li>
            <li>
              • That line crosses the RV&apos;s outline at two points. The
              midpoint between the centre and each of those points becomes a
              cut — together, the two cuts split the level into Segment 1,
              2 and 3, going around the RV in order.
            </li>
            <li>
              • Anchoring the cut to the septum this way means each
              slice&apos;s segments naturally line up with the slice above
              and below it, without needing any extra step to keep them
              consistent — a problem earlier in-house attempts, which cut
              based on the RV outline&apos;s own widest point instead of the
              septum, did run into.
            </li>
          </ul>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
              <DocImage
                src="/images/doc/rv_9segment_per_slice_steps.png"
                alt="Five panels showing one short-axis slice's RV and LV masks, the RV centre point and septal direction, the cutting line through the centre perpendicular to the septal direction, the two cut points, and the final Segment 1/2/3 labels in that slice."
                className="w-full h-auto rounded-md border shadow-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                How one short-axis slice&apos;s RV outline is split into its
                3 segments: the LV&apos;s position sets the septal
                direction, and a line through the RV&apos;s own centre
                point, at a right angle to it, marks where the two cuts
                fall.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
              <DocImage
                src="/images/doc/rv_9segment_all_slices.png"
                alt="Eight short-axis slices from apex to base of the same study, each showing the RV outline split into Segment 1, 2 and 3 by the same septal-anchored cutting line."
                className="w-full h-auto rounded-md border shadow-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                The same construction applied to every slice of one study,
                apex to base — because the cut&apos;s direction follows each
                slice&apos;s own septal reference, segment identity stays
                consistent from one slice to the next with no extra
                adjustment.
              </p>
            </div>
          </div>

          <h4 className="font-semibold text-sm mt-4">
            Step 2 — Labelling the 3D mesh
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              • The right ventricle&apos;s 3D model is labelled differently
              from the left&apos;s — not against a reference shape at all,
              but directly from the patient&apos;s own 2D slice-by-slice
              segments above: every point on the 3D model simply borrows the
              label of whichever already-labelled 2D point, from any slice,
              is nearest to it in space.
            </li>
            <li>
              • Every RV pixel on every slice already carries a segment
              label (1–9) from the per-slice construction above. Stacking
              all of those labelled points from every slice together builds
              one labelled point cloud in 3D space. Each point on the
              reconstructed RV surface then simply takes the label of
              whichever point in that cloud sits closest to it.
            </li>
            <li>
              • This replaced an earlier version of VisHeart&apos;s RV
              pipeline that labelled the 3D model the same
              reference-shape-warping way the left ventricle still does
              today. It was changed specifically for the RV because the
              reference shape&apos;s structure is comparatively flat, while a
              real patient&apos;s right ventricle is often more sharply
              curved — warping a flat reference onto a sharply curved shape
              tended to fragment a single segment into many small,
              disconnected pieces on the final model.
            </li>
          </ul>
          <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
            <DocImage
              src="/images/doc/rv_9segment_3d_fusion.png"
              alt="Two pairs of 3D plots: the segment-labelled points from every slice stacked together, and the same labels carried onto the final reconstructed RV surface, each shown from two camera angles."
              className="w-full h-auto rounded-md border shadow-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              The per-slice segment labels, stacked from every slice into a
              labelled point cloud, are then carried onto the reconstructed
              RV surface — each point on the surface takes its nearest
              labelled neighbour&apos;s segment — producing the final
              9-segment 3D model.
            </p>
          </div>

          <div className="p-2 md:p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mt-4">
            <p className="text-sm font-medium mb-1">⚠️ Research output only</p>
            <p className="text-sm text-muted-foreground">
              VisHeart&apos;s RV segment division — both the per-slice
              9-segment construction and its 3D mesh labelling — is the
              team&apos;s own research output, built and tested in-house. It
              is not a validated clinical standard and has not been checked
              against a ground-truth RV atlas. Treat RV segment boundaries,
              and any measurement derived from them, as indicative only, not
              diagnostic.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
