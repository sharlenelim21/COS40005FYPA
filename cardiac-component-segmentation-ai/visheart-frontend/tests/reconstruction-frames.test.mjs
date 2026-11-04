// Tests for src/lib/reconstruction-frames.ts. Run: node --test tests/reconstruction-frames.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/reconstruction-frames.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const frames = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("every frame, or every 2nd / 3rd frame with the ED frame and the last frame kept", () => {
  assert.equal(frames.framesFor("all", 30, 1).length, 30);
  assert.deepEqual(frames.framesFor("every3", 10, 1), [1, 4, 7, 10]);
  assert.deepEqual(frames.framesFor("every2", 10, 4), [1, 3, 4, 5, 7, 9, 10]);
  assert.equal(frames.framesFor("every3", 30, 1).length, 11);
});

test("a hand-picked set always keeps the ED frame and drops frames outside the scan", () => {
  assert.deepEqual(frames.framesFor("custom", 30, 5, [12, 1, 40, 12]), [1, 5, 12]);
});

test("at least 3 frames, and every frame is sent as no selection", () => {
  assert.match(frames.frameProblem([1, 12], 30), /at least 3 frames/);
  assert.equal(frames.frameProblem([1, 2], 2), null);
  assert.equal(frames.requestFrames(frames.framesFor("all", 30, 1), 30), null);
  assert.deepEqual(frames.requestFrames([1, 4, 7], 30), [1, 4, 7]);
});

test("uneven spacing is flagged", () => {
  assert.equal(frames.unevenlySpaced([1, 4, 7, 10]), false);
  assert.equal(frames.unevenlySpaced([1, 2, 12, 13]), true);
  assert.equal(frames.unevenlySpaced([1, 3, 4, 5, 7]), false);
});

test("a frame that was not built shows the nearest built frame before it", () => {
  const built = [0, 3, 6, 29];
  assert.equal(frames.nearestBuiltFrame(0, built), 0);
  assert.equal(frames.nearestBuiltFrame(1, built), 0);
  assert.equal(frames.nearestBuiltFrame(5, built), 3);
  assert.equal(frames.nearestBuiltFrame(29, built), 29);
  assert.equal(frames.nearestBuiltFrame(2, [4, 8]), 4);   // before the first built frame: the first
  assert.equal(frames.nearestBuiltFrame(2, []), -1);
});
