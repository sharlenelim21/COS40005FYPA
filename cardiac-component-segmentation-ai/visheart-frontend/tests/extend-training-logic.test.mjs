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

test("a test scan is named by its dataset and case, in words", () => {
  assert.equal(logic.testScanName("acdc/patient108_frame01.nii.gz#z0"), "the ACDC scan patient108_frame01");
  assert.equal(logic.testScanName("mms1/A1D0Q7_12.nii.gz"), "the M&Ms-1 scan A1D0Q7_12");
  assert.equal(logic.testScanName("mms2/045_SA_ED.nii#z3"), "the M&Ms-2 scan 045_SA_ED");
  assert.equal(logic.testScanName("other/x.nii.gz"), "the other scan x");
  assert.equal(logic.testScanName(""), "a test scan");
});

// v13 is in use and newest; v1 is the original and oldest; v7 was deleted.
const history = Array.from({ length: 13 }, (_, i) => ({
  label: `v${i + 1}`, status: i === 0 ? "original" : i === 6 ? "deleted" : "candidate",
  is_active: i === 12, is_original: i === 0, registered_at: `2026-09-${String(i + 1).padStart(2, "0")}`,
}));

test("the history shows 10 versions, always with the one in use and the original, until asked for all", () => {
  const alive = history.filter(v => v.status !== "deleted").reverse();         // newest first, as the table sorts
  const many = [...alive, { label: "v14", status: "candidate", is_active: false, is_original: false, registered_at: "x" },
                { label: "v15", status: "candidate", is_active: false, is_original: false, registered_at: "y" }];
  const shown = logic.historyRows(many, false);
  assert.equal(shown.rows.length, 10);
  assert.equal(shown.hidden, 4);
  assert.ok(shown.rows.some(v => v.label === "v13") && shown.rows.some(v => v.label === "v1"));
  assert.deepEqual(shown.rows.map(v => v.label).slice(0, 3), ["v13", "v12", "v11"]);   // the order is kept
  assert.equal(logic.historyRows(many, true).rows.length, 14);
  assert.equal(logic.historyRows(alive.slice(0, 5), false).hidden, 0);
});

test("a version can be compared with any other version that was not deleted", () => {
  const options = logic.compareOptions(history, "v12").map(v => v.label);
  assert.deepEqual(options.slice(0, 3), ["v13", "v1", "v11"]);                 // in use, original, then newest
  assert.ok(!options.includes("v12") && !options.includes("v7"));
  assert.equal(options.length, 11);
});

test("the example viewer keeps the model in use on the left and never offers it on the right", () => {
  // Reviewing v12 while v13 is in use: v13 is fixed on the left, and v12 starts on the right.
  const reviewing = logic.exampleSides(history, "v13", "v12", "v11");
  const offered = reviewing.options.map(v => v.label);
  assert.equal(reviewing.initial, "v12");
  assert.deepEqual(offered.slice(0, 3), ["v12", "v1", "v11"]);                 // this version, original, newest
  assert.ok(!offered.includes("v13") && !offered.includes("v7"));              // not the one in use, not deleted
  assert.equal(offered.length, 11);
  // Reviewing the version in use: the right starts on the one it was compared with, if that was not deleted.
  assert.equal(logic.exampleSides(history, "v13", "v13", "v11").initial, "v11");
  assert.equal(logic.exampleSides(history, "v13", "v13", "v7").initial, "v1");  // v7 was deleted: the original
  assert.ok(!logic.exampleSides(history, "v13", "v13", "v7").options.some(v => v.label === "v13"));
  // Back on the original: it is on the left, so the reviewed version is on the right.
  const original = history.map(v => ({ ...v, is_active: v.label === "v1" }));
  assert.equal(logic.exampleSides(original, "v1", "v12", "v1").initial, "v12");
  assert.equal(logic.exampleSides([history[0]], "v1", "v1", null).initial, null);   // nothing else to compare
});

test("versions can be switched unless a training runs or this computer's model files do not match", () => {
  assert.equal(logic.whyNotSwitch(null, false), null);
  assert.match(logic.whyNotSwitch("unet.pth is not the registered original any more", false),
               /cannot be switched on this computer: unet\.pth is not the registered original/);
  assert.match(logic.whyNotSwitch("anything", true), /training is running/);        // the running job comes first
});

test("the scan viewer offers to use or delete only the version it compares with the model in use", () => {
  const candidate = { label: "v3", status: "candidate", is_original: false };
  const original = { label: "v1", status: "original", is_original: true };
  assert.deepEqual(logic.decisionFor(candidate, "v1"), { use: true, remove: true });
  assert.deepEqual(logic.decisionFor(original, "v3"), { use: true, remove: false });   // the original is never deleted
  assert.equal(logic.decisionFor(candidate, "v3"), null);                              // in use: nothing to compare
  assert.equal(logic.decisionFor({ ...candidate, status: "deleted" }, "v1"), null);
});

test("the scan viewer shows the dataset chosen above the table, keeping the kind of scan shown before", () => {
  const examples = [
    { n: 0, dataset: "acdc", role: "lowest" }, { n: 1, dataset: "acdc", role: "median" },
    { n: 3, dataset: "mms2", role: "lowest" }, { n: 4, dataset: "mms2", role: "highest" },
  ];
  assert.equal(logic.exampleFor(examples, "mms2", "highest"), 4);
  assert.equal(logic.exampleFor(examples, "acdc", "highest"), 0);   // ACDC has no highest here: its first scan
  assert.equal(logic.exampleFor(examples, "mms2", null), 3);
  assert.equal(logic.exampleFor(examples, "mms1", "lowest"), null);  // no scans from that dataset
});

test("a version the user deleted is described in the user's words", () => {
  assert.deepEqual(logic.jobOutcome("v3", "v2", [{ label: "v3", status: "deleted", deleted_because: "rejected" }]), {
    title: "v3 was deleted",
    text: "You deleted it from the version history. The model in use is v2.",
  });
});
