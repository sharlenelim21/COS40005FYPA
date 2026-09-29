// Tests for src/components/extend-training/logic.ts (plan WS13 R1). Run: node --test tests/extend-training-logic.test.mjs
// The file is compiled with the frontend's own typescript package, so no test framework is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/extend-training/logic.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const logic = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const cases = [
  { maskId: "m1", projectName: "Patient 012", model: "unet", slices: [{}, {}, {}] },
  { maskId: "m2", projectName: "Patient 007", model: "medsam", slices: [{}] },
  { maskId: "m3", projectName: "Volunteer A", model: "unet", slices: [{}, {}] },
];

test("every case starts selected, except those this browser remembers clearing", () => {
  assert.deepEqual(logic.initialSelection(["m1", "m2", "m3"], ["m2", "gone"]), ["m1", "m3"]);
  assert.deepEqual(logic.clearedCases(["m1", "m2", "m3"], new Set(["m1"])), ["m2", "m3"]);
});

test("the summary counts the chosen cases and their slices", () => {
  assert.deepEqual(logic.selectionSummary(cases, new Set(["m1", "m3"])), { cases: 2, slices: 5 });
});

test("a search matches every word in the project name or the model", () => {
  assert.deepEqual(cases.filter(item => logic.matchesQuery(item, "patient UNET")).map(item => item.maskId), ["m1"]);
  assert.equal(cases.filter(item => logic.matchesQuery(item, "  ")).length, 3);
});

test("the verdict names every dataset, and a lower one is never left out", () => {
  const names = { acdc: "ACDC", mms1: "M&Ms-1", mms2: "M&Ms-2" };
  const rows = {
    acdc: { complete: true, lower: true, mean_delta_cardiac: -0.011 },
    mms1: { complete: true, lower: false, mean_delta_cardiac: -0.0016 },
    mms2: { complete: true, lower: false, mean_delta_cardiac: 0.0035 },
  };
  assert.deepEqual(logic.verdict(rows, names),
    { tone: "mixed", text: "Better on M&Ms-2. About the same on M&Ms-1. Lower on ACDC." });
  assert.equal(logic.verdict({ acdc: { complete: false } }, names).tone, "bad");
  assert.deepEqual(logic.verdict({ acdc: { complete: true, lower: false, mean_delta_cardiac: 0.002 } }, names),
    { tone: "good", text: "Better on ACDC." });
});

test("scores read as accuracy, changes as points, and ranks in words", () => {
  assert.equal(logic.percent(0.90129), "90.1%");
  assert.equal(logic.percent(undefined), "—");
  assert.equal(logic.points(-0.0131), "−1.3 pts");
  assert.equal(logic.points(0.0004), "0.0 pts");
  assert.equal(logic.points(0.0035), "+0.4 pts");
  assert.deepEqual([-0.0131, 0.0004, 0.0035].map(logic.changeTone), ["down", "flat", "up"]);
  assert.equal(logic.exampleTitle("lowest", -0.041), "Lowest change (−4.1 pts)");
});

test("saved masks become one label per pixel, their differences and their outline", () => {
  const decode = (rle, height, width) => {
    const mask = new Uint8Array(height * width);
    const [start, length] = rle.split(" ").map(Number);
    mask.fill(1, start, start + length);
    return mask;
  };
  const labels = logic.labelMap([{ class: "rv", segmentationmaskcontents: "0 2" },
                                 { class: "LVC", segmentationmaskcontents: "3 1" },
                                 { class: "unknown", segmentationmaskcontents: "2 1" }], 2, 2, decode);
  assert.deepEqual([...labels], [1, 1, 0, 3]);
  // As training labels a slice: the first class written wins where two overlap, and "manual" is not a label.
  const overlap = logic.labelMap([{ class: "rv", segmentationmaskcontents: "0 2" },
                                  { class: "myo", segmentationmaskcontents: "1 2" },
                                  { class: "manual", segmentationmaskcontents: "3 1" }], 2, 2, decode);
  assert.deepEqual([...overlap], [1, 1, 2, 0]);
  assert.deepEqual([...logic.differences(labels, new Uint8Array([1, 0, 0, 3]))], [0, 1, 0, 0]);
  const square = new Uint8Array(25);
  for (const i of [6, 7, 8, 11, 12, 13, 16, 17, 18]) square[i] = 2;
  const edge = logic.outline(square, 5, 5);
  assert.equal(edge.reduce((sum, value) => sum + value, 0), 8);
  assert.equal(edge[12], 0);
});

test("painting colours only labelled pixels", () => {
  const rgba = new Uint8ClampedArray(8);
  logic.paintLabels(rgba, new Uint8Array([0, 1]), { 1: [34, 197, 94] }, 0.5);
  assert.deepEqual([...rgba], [0, 0, 0, 0, 34, 197, 94, 128]);
  assert.deepEqual(logic.hexToRgb("#ef4444"), [239, 68, 68]);
});

test("Edit opens the editor at that exact mask, frame and slice", () => {
  assert.equal(logic.editorHref("p1", "medsam", 3, 5),
    "/project/p1/segmentation?model=medsam&frame=3&slice=5&from=extend-training");
});

test("Results opens on the last training's version, else the newest waiting, else a trained one in use", () => {
  const v = (label, status, extra = {}) =>
    ({ label, status, is_active: false, is_original: false, registered_at: null, ...extra });
  const versions = [v("orig", "original", { is_original: true, is_active: true }),
                    v("old", "candidate", { registered_at: "2026-09-24T00:00:00Z" }),
                    v("new", "candidate", { registered_at: "2026-09-25T00:00:00Z" }), v("gone", "deleted")];
  assert.equal(logic.reviewLabel(versions, "old"), "old");
  assert.equal(logic.reviewLabel(versions, "gone"), "new");
  assert.equal(logic.reviewLabel(versions, null), "new");
  assert.equal(logic.reviewLabel([v("orig", "original", { is_original: true }), v("t", "active", { is_active: true })], null), "t");
  assert.equal(logic.reviewLabel([v("orig", "original", { is_original: true, is_active: true })], undefined), null);
});

test("a frozen test patient's cases are listed but never trainable", () => {
  const listed = [...cases, { maskId: "m4", projectName: "patient108_4d", model: "unet", slices: [{}],
                              frozen: { frame: 0, slice: 0, frozen: "acdc/patient108_frame01.nii.gz#z0" } }];
  assert.deepEqual(logic.trainableCases(listed).map(item => item.maskId), ["m1", "m2", "m3"]);
});

test("the finished training says what happened to its version since", () => {
  const versions = [{ label: "v1", status: "candidate" }, { label: "v2", status: "original" },
                    { label: "v3", status: "deleted", deleted_because: "replaced by v2" }];
  assert.deepEqual(logic.jobOutcome("v1", "v2", versions), {
    title: "v1 is ready for review",
    text: "Its results are below. Nothing has changed yet: the model in use stays active until you choose.",
  });
  assert.deepEqual(logic.jobOutcome("v1", "v1", versions), {
    title: "v1 is in use",
    text: "You chose to use it. The original model is always kept, and the version history can bring it back.",
  });
  assert.deepEqual(logic.jobOutcome("v3", "v2", versions), {
    title: "v3 was deleted",
    text: "It was replaced by v2. The model in use is v2.",
  });
});
