// Tests for src/lib/image-cache-keys.ts. Run: node --test tests/image-cache-keys.test.mjs
// Compiled with the frontend's own typescript package, like extend-training-logic.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/image-cache-keys.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const keys = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("an image's cache key names its project, frame and slice", () => {
  assert.equal(keys.imageId("6a818bd9", 3, 12), "6a818bd9_f3_s12");
});

test("frames and slices are read from the keys alone, sorted and without repeats", () => {
  const ids = ["p_1_f1_s2", "p_1_f0_s2", "p_1_f0_s10", "p_1_f1_s0", "not-a-key", 42];
  assert.deepEqual(keys.framesAndSlices(ids), { frames: [0, 1], slices: [0, 2, 10] });
  assert.deepEqual(keys.framesAndSlices([]), { frames: [], slices: [] });
});
