import { Fragment, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DIAGRAMS, type DiagramId } from "@/components/doc/diagrams";
import {
  LV_RV_REFERENCES_ID,
  LV_RV_SHARED_STEPS_ID,
  LV_STRAIN_METHOD_ID,
  RV_STRAIN_METHOD_SECTION_ID,
} from "@/components/doc/guides";
import { Callout } from "@/components/doc/medical/Callout";
import { DocImage } from "@/components/doc/DocImage";
import { FormulaList, type FormulaItem } from "@/components/doc/technical/FormulaList";
import { REFERENCES, type Reference } from "@/content/medicalGuide";
import { cn } from "@/lib/utils";

// "How LV and RV Works" — how VisHeart's LV (AHA 17-segment) and RV (9-segment,
// research) strain are calculated. Mirrors visheart-inference-gpu/app/
// bullseye_analysis.py (geometry) and routes/bullseye_route.py (formulas): keep
// the numbers here in step with the constants there (_MIN_MYO_PIXELS,
// _MIN_RV_PIXELS, _RV_RAY_STEP_PX, _RV_SMOOTH_HALF_WINDOW, _RV_ARC_TRIM_*,
// _RV_LONG_CHORD_FACTOR, _RV_MIN_VALID_CHORD_FRAC). The Strain tab's red
// "Research output only" notices link to the RV card (RV_STRAIN_METHOD_SECTION_ID).

// ── References (numbered in this order on this page) ─────────────────────────
const SECTION_REFS = ["cerqueira2002", "tokodi2021", "scmr2025", "bernard2018", "myronenko2010", "bazhutina2023"] as const;
type SectionRef = (typeof SECTION_REFS)[number];
const refAnchor = (id: SectionRef) => `lv-rv-ref-${id}`;

const linkClass =
  "text-primary focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none";

function Cite({ ids }: { ids: SectionRef[] }) {
  return (
    <sup className="ml-0.5 text-[0.7em] font-medium">
      [
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && ", "}
          <a href={`#${refAnchor(id)}`} aria-label={`Reference ${SECTION_REFS.indexOf(id) + 1}`} className={linkClass}>
            {SECTION_REFS.indexOf(id) + 1}
          </a>
        </Fragment>
      ))}
      ]
    </sup>
  );
}

// ── Tables and formulas ──────────────────────────────────────────────────────
const AT_A_GLANCE: { row: string; lv: string; rv: string }[] = [
  {
    row: "Segments",
    lv: "AHA 17: 6 basal, 6 mid, 4 apical, 1 apex",
    rv: "9 free-wall segments (3 rings × 3 sections) plus 1 septal value per ring",
  },
  {
    row: "What is measured",
    lv: "The LV wall (myocardium): its thickness and the length of its borders",
    rv: "The RV cavity: free-wall border length, cavity area and septal-side border length",
  },
  { row: "Reported values", lv: "GRS (wall thickening), GCS (border shortening)", rv: "GCS, GAS, FAC (= −GAS), septal GCS" },
  { row: "Where the rays start", lv: "LV-cavity centre of each slice", rv: "LV-cavity centre of each slice (not the RV's own centre)" },
  {
    row: "Layout across frames",
    lv: "Slice → ring fixed at ED; each frame's sectors are aligned with that frame's own landmarks where they exist",
    rv: "Slice → ring and ray → section both fixed at ED and reused for every frame",
  },
  {
    row: "Status",
    lv: "Standard AHA segment model; strain is a geometric measure from the outlines",
    rv: "Research output: our own method, not validated",
  },
];

const RV_SOURCES: { part: string; source: string; refs: SectionRef[]; changed: string }[] = [
  {
    part: "Basal, mid and apical levels, each split into equal-angle sections measured from the RV insertion point",
    source: "AHA 17-segment model of the left ventricle",
    refs: ["cerqueira2002"],
    changed: "Applied to the RV free wall: 3 levels × 3 sections, instead of 6 or 4 sectors around the LV.",
  },
  {
    part: "Free wall and septum measured separately; circumferential strain and area strain reported as separate numbers",
    source: "ReVISION method (3D echocardiography, 15 RV segments)",
    refs: ["tokodi2021"],
    changed:
      "Simplified to 9 free-wall segments on short-axis MRI slices, plus one septal value per level. No longitudinal strain, which needs long-axis views.",
  },
  {
    part: "Strain sign: shortening and shrinking are negative",
    source: "SCMR cardiac MRI reference values",
    refs: ["scmr2025"],
    changed: "Same sign convention, but our values cannot be compared with the published ranges.",
  },
  {
    part: "Outline labels: RV cavity, LV wall (myocardium) and LV cavity",
    source: "ACDC cardiac MRI dataset",
    refs: ["bernard2018"],
    changed: "There is no RV wall label, so RV strain follows the border of the RV cavity instead of the RV muscle.",
  },
  {
    part: "Rays from the LV centre, border lengths from joined ray points, layout fixed at end-diastole",
    source: "Our own method, adapted from VisHeart's LV bullseye",
    refs: [],
    changed: "Not taken from a paper. This is the part that most needs validation.",
  },
];

const SHARED_FORMULAS: FormulaItem[] = [
  {
    label: "Strain of any measure (LV and RV)",
    formula: "Strain (%) = (value at frame − value at ED) ÷ value at ED × 100",
    note: (
      <>
        ED = end-diastole, the reference frame (its own strain is 0 %). Negative = shorter / smaller, positive =
        longer / thicker.
        <Cite ids={["scmr2025"]} />
      </>
    ),
  },
];

const LV_FORMULAS: FormulaItem[] = [
  { label: "Wall thickness of a ray", formula: "WT = distance(inner border point, outer border point)" },
  {
    label: "Wall thickness of a segment",
    formula: "WT_segment = mean WT of the segment's rays, then mean over the ring's slices",
  },
  {
    label: "GRS: radial strain (per segment)",
    formula: "GRS (%) = (WT_frame − WT_ED) ÷ WT_ED × 100",
    note: "Positive = the wall thickens.",
  },
  {
    label: "Border length of a segment (inner, mid-wall and outer border separately)",
    formula: "L = Σ distance(point on ray i, point on ray i + 1)   over the segment's rays",
    note: "A chord sum: the border is approximated by joining the points of neighbouring rays. The mid-wall point is halfway between the inner and outer points of the same ray.",
  },
  {
    label: "GCS: circumferential strain (per segment)",
    formula: "GCS (%) = mean of  strain(L_inner), strain(L_mid), strain(L_outer)",
    note: "Negative = the borders shorten. Uses whichever of the three borders could be measured.",
  },
  {
    label: "Global GRS",
    formula: "Global GRS (%) = (mean WT_frame − mean WT_ED) ÷ mean WT_ED × 100",
    note: "Means over the segments measured in both frames (ratio of means, not the mean of 17 percentages).",
  },
  {
    label: "Global GCS",
    formula: "Global GCS (%) = mean over the 3 borders of (mean L_frame − mean L_ED) ÷ mean L_ED × 100",
  },
];

const RV_FORMULAS: FormulaItem[] = [
  {
    label: "RV GCS: free-wall circumferential strain (per segment)",
    formula: "GCS (%) = (L_free,frame − L_free,ED) ÷ L_free,ED × 100",
    note: "L_free = sum of the distances between neighbouring free-wall (exit) points over the section's rays, averaged over the ring's slices. The main RV value.",
  },
  {
    label: "RV GAS: area strain (per segment)",
    formula: "GAS (%) = (A_frame − A_ED) ÷ A_ED × 100",
    note: "A = number of RV pixels whose angle from the LV centre falls inside the section's rays × the area of one pixel (the full wedge, no end trim).",
  },
  {
    label: "RV FAC: fractional area change",
    formula: "FAC (%) = −GAS",
    note: "A short-axis MRI area change, not the echocardiography 4-chamber FAC, so echocardiography cut-offs do not apply.",
  },
  {
    label: "RV septal GCS (one per ring)",
    formula: "Septal GCS (%) = (L_septal,frame − L_septal,ED) ÷ L_septal,ED × 100",
    note: "L_septal = sum of the distances between neighbouring septal-side (entry) points across the whole RV arc. Kept separate from the free wall.",
  },
  {
    label: "Global RV GCS, GAS and septal GCS",
    formula: "Global (%) = (Σ value_frame − Σ value_ED) ÷ Σ value_ED × 100",
    note: "Totals over the segments measured in both frames. This weights each segment by its size instead of averaging nine percentages.",
  },
];

// ── Layout helpers ───────────────────────────────────────────────────────────
function StepCard({
  id,
  step,
  color,
  title,
  children,
}: {
  id: string;
  step: number;
  color: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} tabIndex={-1} className="scroll-mt-44 focus:outline-none lg:scroll-mt-32">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
          <div
            className={cn(color, "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white")}
          >
            {step}
          </div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-base font-semibold md:text-lg">{children}</h3>;
}

function Para({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-base leading-6">{children}</p>;
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-base leading-6 marker:font-semibold">{children}</ol>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <strong className="text-foreground">{title}.</strong> {children}
    </li>
  );
}

function DiagramFigure({ diagram, alt, caption }: { diagram: DiagramId; alt: string; caption: string }) {
  const Diagram = DIAGRAMS[diagram];
  return (
    <figure className="bg-muted/30 rounded-lg border p-2 md:p-4">
      <div className="bg-background rounded-md border p-3 shadow-sm md:p-4">
        <Diagram title={alt} />
      </div>
      <figcaption className="text-muted-foreground mt-2 text-sm">{caption}</figcaption>
    </figure>
  );
}

function ImageFigure({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="bg-muted/30 rounded-lg border p-2 md:p-4">
      <DocImage src={src} alt={alt} className="w-full h-auto rounded-md border shadow-sm bg-white" />
      <figcaption className="text-muted-foreground mt-2 text-sm">{caption}</figcaption>
    </figure>
  );
}

function ReferenceLink({ reference }: { reference: Reference }) {
  const href = reference.doi !== undefined ? `https://doi.org/${reference.doi}` : reference.url;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, "inline-flex items-center gap-1 underline")}>
      {reference.doi !== undefined ? `doi:${reference.doi}` : "Source link"}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
export function LvRvSection() {
  return (
    <div className="max-w-none space-y-6 md:space-y-8">
      <div>
        <h2 className="mb-4 text-2xl font-bold md:text-3xl">How LV and RV Works</h2>
        <p className="text-muted-foreground mb-4">
          VisHeart measures left ventricle (LV) and right ventricle (RV) strain from the segmentation masks on the
          short-axis slices, the same outlines you see on the Segmentation page (0 = background, 1 = RV cavity, 2 =
          LV wall / myocardium, 3 = LV cavity). Each thickness, length or area is measured at end-diastole (ED) and
          at a later frame, and strain is the percentage change between the two.
        </p>
        <p className="text-muted-foreground">
          These are geometric measurements from outlines, not feature-tracking or tagged-MRI strain, so they should
          not be compared with published normal ranges. The LV uses the standard AHA 17-segment model
          <Cite ids={["cerqueira2002"]} />;{" "}
          <span className="font-semibold text-red-700 dark:text-red-400">
            the RV 9-segment bullseye is our own research method
          </span>{" "}
          (see step 3).
        </p>
      </div>

      <div className="bg-card overflow-hidden rounded-lg border p-2 md:p-4">
        <p className="mb-3 px-2 text-base font-medium">LV and RV strain at a glance</p>
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-36" />
              <TableHead scope="col">Left ventricle (LV)</TableHead>
              <TableHead scope="col">Right ventricle (RV)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {AT_A_GLANCE.map(({ row, lv, rv }) => (
              <TableRow key={row}>
                <TableHead scope="row" className="align-top font-medium whitespace-normal">
                  {row}
                </TableHead>
                <TableCell className="align-top whitespace-normal">{lv}</TableCell>
                <TableCell
                  className={cn(
                    "align-top whitespace-normal",
                    row === "Status" && "font-semibold text-red-700 dark:text-red-400",
                  )}
                >
                  {rv}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── 1. Shared ───────────────────────────────────────────────────── */}
      <StepCard id={LV_RV_SHARED_STEPS_ID} step={1} color="bg-blue-500" title="Steps Shared by Both Ventricles">
        <Steps>
          <Step title="Slice order">
            The stack is put in base-to-apex order. Some scans store the apex first, so this is decided from the mask
            itself: the base end of the LV is the wider one (mean LV area of the first third of the LV slices vs the
            last third). It is decided once, on the ED mask, and used for every frame.
          </Step>
          <Step title="Ray centre">
            On each slice the rays start at the centre of the LV cavity. The cavity is used rather than the wall
            because its centre does not drift when the wall thickens at end-systole. Both ventricles share this one
            reference point.
          </Step>
          <Step title="Rays">
            360 straight lines (rays), one per degree, are cast outward from that centre and grouped into segments
            in the order they are cast.
          </Step>
          <Step title="Alignment">
            The anterior RV insertion point (where the RV wall joins the septum at the front) decides where segment
            1 starts. In order of preference: the points saved for each slice on the Landmarks tab (the anterior
            point of each pair is chosen by geometry, so swapped labels do no harm), a single landmark point, a point
            estimated from the RV in the mask (the leading 2 % of RV pixels seen from the LV centre), or fixed angles
            when the mask has no RV at all.
          </Step>
          <Step title="Units">
            Everything is measured in pixels and converted to mm / mm² with the in-plane pixel spacing of the ED
            file. Percentages do not depend on the conversion.
          </Step>
          <Step title="Quick vs full cycle">
            <em>Quick ED → ES</em> compares two frames. <em>Full cycle</em> compares every frame with ED. The LV
            peak is the frame with the largest global GRS (the measured end-systole), and the peak GCS is read from
            that same frame; the RV peak is the frame with the largest global RV GCS.
          </Step>
        </Steps>
        <FormulaList caption="The one strain formula" items={SHARED_FORMULAS} />
        <DiagramFigure
          diagram="sliceRings"
          alt="Table-like diagram of a 10-slice short-axis stack, base at the top. LV column: slices 1–3 basal (segments 1–6), 4–6 mid (7–12), 7–9 apical (13–16), slice 10 apex (17). RV column: slices 1–3 basal (R1–R3), 4–6 mid (R4–R6), 7–9 apical (R7–R9), slice 10 has no RV and is not used."
          caption="How short-axis slices are grouped into rings, for an example scan where the LV wall shows on all 10 slices and the RV on the first 9. The LV keeps its last slice (its last two on scans with 15 or more slices) for the apex; the RV has no apex segment, so its slices are simply split into thirds."
        />
      </StepCard>

      {/* ── 2. LV ───────────────────────────────────────────────────────── */}
      <StepCard id={LV_STRAIN_METHOD_ID} step={2} color="bg-green-500" title="LV: AHA 17 Segments (GRS and GCS)">
        <Steps>
          <Step title="Rings">
            Slices with at least 50 myocardium pixels are used. The last slice is the apex, segment 17 (the last
            two when there are 15 or more slices). The rest are split into three nearly equal groups: basal
            (segments 1–6), mid (7–12) and apical (13–16).
            <Cite ids={["cerqueira2002"]} /> End-systole and every later frame reuse the ED slice → ring layout,
            so each ring compares the same slices.
          </Step>
          <Step title="Sectors">
            The first ray is cast 60° before the anterior RV insertion point (75° on apical slices). Rays are then
            grouped in order: 6 × 60 rays on basal and mid slices, 4 × 90 rays on apical slices, all 360 for the
            apex. Segment 1 (anterior) is therefore the 60° wedge that ends at the insertion point, and segments 2
            and 3 (the septum) follow it. With per-slice landmarks, each ring uses the mean of its own slices&apos;
            anterior points.
          </Step>
          <Step title="Border points">
            Along each ray, the first two places where the pixel changes between myocardium and not-myocardium are
            the inner border (endocardium) and the outer border (epicardium). The mid-wall point is halfway between
            them.
          </Step>
        </Steps>
        <DiagramFigure
          diagram="lvRayCasting"
          alt="Schematic basal short-axis slice. The LV wall ring is split into six numbered 60° sectors; the first ray is drawn 60° before the anterior RV insertion point, with an arrow showing the rays sweep towards the septum. A few example rays show the inner, mid-wall and outer border points joined ray to ray."
          caption="LV ray casting on a basal slice (schematic, anterior at the top, septum on the left). Wall thickness along each ray gives GRS; the joined border points give the three border lengths averaged for GCS."
        />
        <FormulaList caption="LV formulas" items={LV_FORMULAS} />

        <SubHeading>How the 3D model is labelled</SubHeading>
        <Para>
          Separately from the bullseye above, VisHeart&apos;s 3D LV mesh also needs every point on its surface to
          know which of the 17 segments it belongs to, so it can be coloured segment by segment. This is done by
          comparing the patient&apos;s mesh against a single reference heart shape that was already divided into its
          17 segments once, then letting every point on the patient&apos;s own mesh borrow its label from whichever
          point on that reference shape it lines up with most closely.
        </Para>
        <Steps>
          <Step title="Elastic warp">
            The reference shape is elastically warped — stretched and bent, not just rotated or resized — to line up
            with the patient&apos;s own reconstructed left ventricle, using an algorithm called Coherent Point Drift
            <Cite ids={["myronenko2010"]} />.
          </Step>
          <Step title="Nearest-point label transfer">
            Once the two shapes are aligned, each point on the patient&apos;s mesh is given the segment label of
            whichever point on the warped reference shape ends up closest to it.
          </Step>
          <Step title="Fallback">
            If that alignment step doesn&apos;t produce a usable result, VisHeart falls back to a simpler, fixed
            geometric rule (dividing the shape by height and angle) instead of leaving the mesh unlabelled.
          </Step>
        </Steps>
        <ImageFigure
          src="/images/doc/lv_cpd_pipeline.png"
          alt="Three-panel diagram: (1) the reference atlas's zone meshes, aligned into one coordinate frame; an arrow labelled 'CPD warp' points to (2) the patient's own mesh sampled into a dense point cloud; an arrow labelled 'label transfer' points to (3) the atlas meshes after Coherent Point Drift deformation, now aligned to the patient's shape."
          caption="VisHeart labels the 3D LV mesh by elastically warping a reference atlas (1) onto the patient's own mesh, sampled into a dense point cloud for registration (2), using Coherent Point Drift — producing a deformed atlas aligned to the patient's shape (3). Each point on the patient's mesh then takes the segment label of whichever point on the deformed atlas ends up closest to it. Figures from VisHeart's own research notebook prototyping this method."
        />
      </StepCard>

      {/* ── 3. RV (research) ────────────────────────────────────────────── */}
      <StepCard
        id={RV_STRAIN_METHOD_SECTION_ID}
        step={3}
        color="bg-red-600"
        title="RV: 9 Segments (Research Output)"
      >
        <Callout variant="warning" title="Research output only: not for diagnosis">
          <p>
            This is our own research output and is still under research. The 9-segment RV bullseye, and the 3D mesh
            labelling built on top of it, are our own method, based on our understanding of the published work and
            adapted from the LV method above. Neither has been tested against a reference standard such as
            feature-tracking MRI, 3D echocardiography or expert measurements.
          </p>
          <p>
            There are no normal ranges for these numbers. Use them to compare the segments of one heart, or one heart
            across the heartbeat. Do not compare them with published values or use them to make clinical decisions.
          </p>
        </Callout>

        <Para>
          The RV has no standard segment model like the AHA 17-segment model of the LV
          <Cite ids={["cerqueira2002"]} />, and published RV research divides it in different ways; the ReVISION
          method, for example, uses 15 segments on 3D echocardiography
          <Cite ids={["tokodi2021"]} />. So we built our own 9-segment RV bullseye. The table shows which paper each
          part of the method comes from, and what is our own.
        </Para>

        <div className="bg-card overflow-hidden rounded-lg border p-2 md:p-4">
          <p className="mb-3 px-2 text-base font-medium">Where each part of the RV method comes from</p>
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Part of the method</TableHead>
                <TableHead scope="col">Based on</TableHead>
                <TableHead scope="col">What we changed or added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RV_SOURCES.map(({ part, source, refs, changed }) => (
                <TableRow key={part}>
                  <TableHead scope="row" className="align-top font-medium whitespace-normal">
                    {part}
                  </TableHead>
                  <TableCell className="align-top whitespace-normal">
                    {source}
                    {refs.length > 0 && <Cite ids={refs} />}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">{changed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <SubHeading>How the RV is divided into 9 segments</SubHeading>
        <Para>
          The RV is first cut into three levels from the base of the heart towards the apex: basal, mid and apical.
          On each level, the RV free wall (the outer wall that curves around the LV) is split into three sections,
          from its inferior end (Seg 1) to its anterior end (Seg 3). Three levels × three sections gives nine
          segments, R1 to R9. The septum, the wall the RV shares with the LV, is measured separately as one extra
          value per level
          <Cite ids={["tokodi2021"]} />; it is listed with the other numbers but not drawn on the bullseye.
        </Para>
        <Steps>
          <Step title="Rings">
            Slices with at least 30 RV pixels are put in base-to-apex order and split into even thirds; when they do
            not divide evenly, the extra slice goes to the basal ring first. Unlike the LV there is no apex ring.
          </Step>
          <Step title="Sections">
            On each slice the RV free wall, seen from the LV centre, is an arc. The arc is cut into 3 sections with
            the same number of rays (the same angle), so the sections are not always the same length.
          </Step>
          <Step title="Orientation">
            The end of the arc nearer the slice&apos;s anterior insertion point becomes Seg 3; Seg 1 is the inferior
            end. VisHeart uses each slice&apos;s saved insertion points; a slice without usable points uses the
            default end, and a project with no landmarks has the point estimated from the RV outline.
          </Step>
          <Step title="Fixed at ED">
            The slice → ring labels and the ray → section map are made once, on the ED frame, and reused for
            end-systole and every other frame, so each segment always compares the same slices and the same wedge of
            the heart. Only the LV centre is recomputed per frame.
          </Step>
        </Steps>
        <DiagramFigure
          diagram="rvNineSegments"
          alt="RV 9-segment bullseye: a crescent of three rings (basal outermost, then mid, then apical next to the LV) wrapped around the septal side of the LV bullseye. Each ring is split into three sections, from Seg 1 at the inferior end to Seg 3 at the anterior end, numbered R1 to R9."
          caption="The 9-segment RV bullseye as drawn on the Strain tab: three rings (basal outside, apical next to the LV) × three free-wall sections (Seg 1 inferior to Seg 3 anterior). In the app's tables, R1 is listed as Basal_Seg1, R5 as Mid_Seg2 and R9 as Apical_Seg3."
        />

        <SubHeading>Bullseye ray casting</SubHeading>
        <Para>
          To find the RV wall on each slice, VisHeart casts the 360 rays from the LV centre. Each ray that crosses
          the RV gives two points: where it enters the RV on the septal side, and where it leaves the RV at the free
          wall. Joining these points from one ray to the next traces the two borders of the RV. Rays that never touch
          the RV are ignored; the ones that do form the RV arc that is split into the three sections.
        </Para>
        <Steps>
          <Step title="Ray centre">
            The LV-cavity centre, the same one the LV bullseye uses; on a slice without an LV cavity, the LV-wall
            centre, or the nearest slice&apos;s centre when the LV is missing altogether.
          </Step>
          <Step title="Ray hits">
            Each ray is sampled every 0.25 px. The first run of RV pixels along it gives the septal-side entry point
            and the free-wall exit point. Both borders&apos; distances are smoothed over ±3 neighbouring rays to
            remove the pixel staircase along the edge of the outline.
          </Step>
          <Step title="Arc">
            The arc runs from the first to the last ray that hits the RV (around the largest gap of misses), so small
            gaps inside the RV, such as a muscle band, don&apos;t split it.
          </Step>
          <Step title="Robust lengths">
            The first and last 5 % of the arc&apos;s rays (at least 5 per end) are left out of the lengths, because
            near the insertion points the rays run almost along the wall; they still count towards the area. A
            missing step, or one longer than 3 × the median step, is counted as the median step instead of being
            dropped, so a gap is not read as shortening. A segment with fewer than half of its steps measured is left
            blank.
          </Step>
        </Steps>
        <DiagramFigure
          diagram="rvRayCasting"
          alt="Schematic short-axis slice with the LV on the right and the crescent-shaped RV on its left. Rays fan out from the LV centre; grey rays miss the RV, coloured rays cross it and are grouped into Seg 1 (inferior), Seg 2 and Seg 3 (anterior). Each coloured ray has a hollow point where it enters the RV and a filled point where it leaves it at the free wall."
          caption="RV ray casting on one short-axis slice (schematic, anterior at the top). Each section's free-wall length (solid line) gives RV GCS, its shaded cavity area gives RV GAS, and the septal-side length (dashed line) gives RV septal GCS. Rays are drawn every 4° here; VisHeart uses one per degree."
        />

        <SubHeading>How RV strain is calculated</SubHeading>
        <Para>
          Each length or area is compared with its value at ED: a negative value means the wall became shorter or
          the cavity smaller, and a more negative value means more contraction
          <Cite ids={["scmr2025"]} />. GCS and GAS are always reported as separate numbers and are never combined
          into one value, following the ReVISION method, which reports circumferential and area strain separately
          <Cite ids={["tokodi2021"]} />.
        </Para>
        <FormulaList caption="RV formulas" items={RV_FORMULAS} />

        <SubHeading>How the 3D model is labelled</SubHeading>
        <Para>
          The RV&apos;s 3D mesh is labelled differently from the LV&apos;s above —{" "}
          <span className="font-semibold text-red-700 dark:text-red-400">
            not against a reference atlas at all, since no validated RV atlas exists
          </span>{" "}
          — but built directly from the RV segmentation masks, slice by slice, then carried onto the 3D mesh.
        </Para>
        <SubHeading>Step 1 — Labelling one slice (the septal-anchored chord method)</SubHeading>
        <Para>
          On each short-axis slice, VisHeart starts from that slice&apos;s RV and LV segmentation masks and
          constructs a single chord through the RV&apos;s own centre to split it into Seg1, Seg2 and Seg3 — an
          extension of the AHA 17-segment model to the RV
          <Cite ids={["bazhutina2023"]} />.
        </Para>
        <Steps>
          <Step title="Find the centres">
            From that slice&apos;s RV and LV masks, VisHeart finds the RV&apos;s own centre point and the LV&apos;s
            centre point.
          </Step>
          <Step title="Septal direction">
            The direction from the RV centre to the LV centre is the septum — the wall the two ventricles share —
            which gives a consistent, patient-specific landmark to anchor the cut to on every slice.
          </Step>
          <Step title="The chord">
            A line (the chord) is drawn through the RV&apos;s own centre point, at a right angle to the septal
            direction. This chord crosses the RV&apos;s outline at two points, p1 and p2.
          </Step>
          <Step title="Halve the chord">
            The midpoint between the centre and each of p1 and p2 becomes a cut point — q1 and q2 — perpendicular to
            the chord.
          </Step>
          <Step title="Final per-pixel labels">
            Together, q1 and q2 split the slice into three regions: Seg1, Seg2 and Seg3, going around the RV in
            order. Every RV pixel on that slice is labelled by which of the three regions it falls in.
          </Step>
        </Steps>
        <ImageFigure
          src="/images/doc/rv_9segment_per_slice_steps.png"
          alt="Five panels showing one short-axis slice's RV and LV masks, the RV centre point and septal direction, the cutting line through the centre perpendicular to the septal direction, the two cut points, and the final Segment 1/2/3 labels in that slice."
          caption="The septal-anchored chord method on a real patient slice: (1) the RV and LV masks, (2) the RV's own centre point and the septal direction towards the LV's centre, (3) the chord through the RV centre, perpendicular to the septal direction, (4) halving the chord to the two cut points q1/q2, (5) the final per-pixel Seg1/Seg2/Seg3 labels."
        />
        <ImageFigure
          src="/images/doc/rv_9segment_all_slices.png"
          alt="Eight short-axis slices from apex to base of the same study, each showing the RV outline split into Segment 1, 2 and 3 by the same septal-anchored cutting line."
          caption="The same construction applied to every slice of one study, apex to base — because the cut's direction follows each slice's own septal reference, segment identity stays consistent from one slice to the next with no extra adjustment."
        />
        <SubHeading>Step 2 — From per-slice labels to a labelled 3D mesh</SubHeading>
        <Steps>
          <Step title="Build the point cloud">
            Every RV pixel on every slice already carries a segment label (Seg1–Seg3, combined with its basal/mid/
            apical ring into R1–R9) from Step 1 above. Stacking all of those labelled points from every slice
            together builds one labelled point cloud in 3D space.
          </Step>
          <Step title="Nearest-neighbour transfer">
            Each point on the reconstructed RV surface then simply takes the label of whichever point in that cloud
            sits closest to it — a nearest-neighbour lookup, not a warped-atlas alignment.
          </Step>
          <Step title="Why not the LV's atlas-warp method">
            An earlier version of VisHeart&apos;s RV pipeline labelled the 3D mesh the same reference-shape-warping
            way the LV still does above. It was changed specifically for the RV because the reference shape&apos;s
            structure is comparatively flat, while a real patient&apos;s right ventricle is often more sharply
            curved — warping a flat reference onto a sharply curved shape tended to fragment a single segment into
            many small, disconnected pieces on the final mesh.
          </Step>
        </Steps>
        <ImageFigure
          src="/images/doc/rv_9segment_3d_fusion.png"
          alt="Two pairs of 3D plots: the segment-labelled points from every slice stacked together, and the same labels carried onto the final reconstructed RV surface, each shown from two camera angles."
          caption="The per-slice segment labels, stacked from every slice into a labelled point cloud, are then carried onto the reconstructed RV surface — each point on the surface takes its nearest labelled neighbour's segment — producing the final 9-segment 3D mesh."
        />

        <SubHeading>Known limitations</SubHeading>
        <Callout variant="caution" title="Keep these in mind when reading any RV value">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              The outlines have no label for the RV wall muscle, so RV strain follows the border of the RV cavity.
              <Cite ids={["bernard2018"]} />
            </li>
            <li>
              Short-axis slices cannot measure base-to-apex shortening, which is one of the main ways the RV pumps.
              <Cite ids={["tokodi2021"]} />
            </li>
            <li>Rays that only graze the thin tips of the RV crescent can bias the end sections (Seg 1 and Seg 3).</li>
            <li>
              The thin RV free wall and the basal slices are the hardest parts to outline, so the results depend
              strongly on segmentation quality.
            </li>
            <li>The values have not been compared with feature-tracking MRI, 3D echocardiography or expert measurements.</li>
          </ul>
        </Callout>
      </StepCard>

      {/* ── References ──────────────────────────────────────────────────── */}
      <section
        id={LV_RV_REFERENCES_ID}
        tabIndex={-1}
        aria-labelledby={`${LV_RV_REFERENCES_ID}-heading`}
        className="scroll-mt-44 focus:outline-none lg:scroll-mt-32"
      >
        <h3 id={`${LV_RV_REFERENCES_ID}-heading`} className="mb-3 text-lg font-semibold">
          References
        </h3>
        <ol className="space-y-2 text-base">
          {SECTION_REFS.map((id, index) => {
            const reference: Reference = REFERENCES[id];
            return (
              <li
                key={id}
                id={refAnchor(id)}
                className="target:bg-muted -mx-2 flex scroll-mt-44 gap-3 rounded-md p-2 transition-colors lg:scroll-mt-32"
              >
                <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{index + 1}.</span>
                <div className="min-w-0 space-y-1 break-words">
                  <p>{reference.citation}</p>
                  <p className="text-sm">
                    <ReferenceLink reference={reference} />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
