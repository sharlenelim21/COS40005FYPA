import {
  normalizeRvInsertionOrder,
  normalizeLandmarkJobResult,
  normalizeLandmarkFrames,
} from "../src/utils/landmark_order";

describe("normalizeRvInsertionOrder", () => {
  it("keeps a pair that is already ordered (anterior on top)", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 30, y: 80 };
    const [first, second] = normalizeRvInsertionOrder(a, b);
    expect(first).toBe(a);
    expect(second).toBe(b);
  });

  it("swaps a pair whose first point is below the second", () => {
    const a = { x: 10, y: 80 };
    const b = { x: 30, y: 20 };
    const [first, second] = normalizeRvInsertionOrder(a, b);
    expect(first).toBe(b);
    expect(second).toBe(a);
  });

  it("keeps the current order on a tie", () => {
    const a = { x: 10, y: 50 };
    const b = { x: 30, y: 50 };
    const [first, second] = normalizeRvInsertionOrder(a, b);
    expect(first).toBe(a);
    expect(second).toBe(b);
  });

  it("does not swap when either point is missing", () => {
    const a = { x: 10, y: 80 };
    expect(normalizeRvInsertionOrder(a, null)).toEqual([a, null]);
    expect(normalizeRvInsertionOrder(undefined, a)).toEqual([undefined, a]);
  });

  it("accepts [x, y] arrays", () => {
    const a: [number, number] = [10, 80];
    const b: [number, number] = [30, 20];
    expect(normalizeRvInsertionOrder(a, b)).toEqual([b, a]);
  });
});

describe("normalizeLandmarkJobResult", () => {
  it("swaps only the swapped slice and recomputes avg_lm1/avg_lm2 from the reordered slices", () => {
    const result = {
      slices: [
        { slice: 0, lm1: { x: 10, y: 20 }, lm2: { x: 30, y: 80 }, hm1_max: 0.9, hm2_max: 0.8 },
        { slice: 1, lm1: { x: 50, y: 90 }, lm2: { x: 70, y: 40 }, hm1_max: 0.7, hm2_max: 0.6 },
      ],
      avg_lm1: { x: 30, y: 55 },
      avg_lm2: { x: 50, y: 60 },
      n_total: 2,
    };
    const out: any = normalizeLandmarkJobResult(result);

    expect(out.slices[0]).toBe(result.slices[0]);
    expect(out.slices[1]).toMatchObject({ lm1: { x: 70, y: 40 }, lm2: { x: 50, y: 90 }, hm1_max: 0.6, hm2_max: 0.7 });
    expect(out.avg_lm1).toEqual({ x: 40, y: 30 });
    expect(out.avg_lm2).toEqual({ x: 40, y: 85 });
    expect(out.n_total).toBe(2);
    expect(result.slices[1].lm1).toEqual({ x: 50, y: 90 });
    expect(result.avg_lm1).toEqual({ x: 30, y: 55 });
  });

  it("returns an already-ordered result untouched (GPU averages kept)", () => {
    const result = {
      slices: [{ slice: 0, lm1: { x: 10, y: 20 }, lm2: { x: 30, y: 80 } }],
      avg_lm1: { x: 10.0001, y: 20 },
      avg_lm2: { x: 30, y: 80 },
    };
    expect(normalizeLandmarkJobResult(result)).toBe(result);
  });

  it("swaps old-format predictions[] arrays", () => {
    const out: any = normalizeLandmarkJobResult({
      predictions: [{ frame_id: 0, rv_insertion_1: [5, 90], rv_insertion_2: [6, 10] }],
    });
    expect(out.predictions[0].rv_insertion_1).toEqual([6, 10]);
    expect(out.predictions[0].rv_insertion_2).toEqual([5, 90]);
  });

  it("passes through null / non-object results", () => {
    expect(normalizeLandmarkJobResult(null)).toBeNull();
    expect(normalizeLandmarkJobResult(undefined)).toBeUndefined();
  });
});

describe("normalizeLandmarkFrames", () => {
  const frames = [
    {
      frameindex: 0,
      frameinferred: true,
      slices: [
        {
          sliceindex: 0,
          landmarks: [
            { key: "rv_insertion_1", x: 10, y: 90, flag: "normal" },
            { key: "rv_insertion_2", x: 20, y: 30, flag: "normal" },
          ],
        },
        { sliceindex: 1, landmarks: [{ key: "rv_insertion_2", x: 20, y: 5 }] },
      ],
    },
  ];

  it("swaps the keys of a swapped slice and leaves one-point slices alone", () => {
    const out = normalizeLandmarkFrames(frames);
    const [s0, s1] = out[0].slices!;
    expect(s0.landmarks).toEqual([
      { key: "rv_insertion_2", x: 10, y: 90, flag: "normal" },
      { key: "rv_insertion_1", x: 20, y: 30, flag: "normal" },
    ]);
    expect(s1).toBe(frames[0].slices[1]);
    expect(frames[0].slices[0].landmarks[0].key).toBe("rv_insertion_1");
  });

  it("is idempotent", () => {
    const once = normalizeLandmarkFrames(frames);
    expect(normalizeLandmarkFrames(once)).toEqual(once);
  });
});
