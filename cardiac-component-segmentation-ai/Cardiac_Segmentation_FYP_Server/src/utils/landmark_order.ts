type YPoint = { y: number } | readonly number[];

const yOf = (p: YPoint): number => (Array.isArray(p) ? (p as readonly number[])[1] : (p as { y: number }).y);

export function normalizeRvInsertionOrder<T extends YPoint>(
    first: T | null | undefined,
    second: T | null | undefined,
): [T | null | undefined, T | null | undefined] {
    if (!first || !second) return [first, second];
    return yOf(first) > yOf(second) ? [second, first] : [first, second];
}

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

/** Shared by the top-level r.slices case (single-frame GPU responses, kept
 *  for backward compatibility) and the per-frame r.frames[].slices case
 *  (current multi-frame GPU response) — same y-coordinate swap check and
 *  avg_lm1/avg_lm2 recompute, just applied to whichever slice array is
 *  passed in. */
function normalizeSlicesAndAvg(slices: any[]): { slices: any[]; avg_lm1?: any; avg_lm2?: any; swapped: boolean } {
    let anySwapped = false;
    const out = slices.map((s: any) => {
        const [lm1] = normalizeRvInsertionOrder(s?.lm1, s?.lm2);
        if (lm1 === s?.lm1) return s;
        anySwapped = true;
        return { ...s, lm1: s.lm2, lm2: s.lm1, hm1_max: s.hm2_max, hm2_max: s.hm1_max };
    });
    if (!anySwapped) return { slices: out, swapped: false };

    const both = out.filter((s: any) => s?.lm1 && s?.lm2);
    const avg_lm1 = both.length ? { x: mean(both.map((s: any) => s.lm1.x)), y: mean(both.map((s: any) => s.lm1.y)) } : undefined;
    const avg_lm2 = both.length ? { x: mean(both.map((s: any) => s.lm2.x)), y: mean(both.map((s: any) => s.lm2.y)) } : undefined;
    return { slices: out, avg_lm1, avg_lm2, swapped: true };
}

export function normalizeLandmarkJobResult<T>(result: T): T {
    const r = result as any;
    if (!r || typeof r !== "object") return result;

    // Current multi-frame GPU response: one entry per cardiac frame, each
    // with its own slices[]/avg_lm1/avg_lm2 — normalize every frame's
    // slices independently, then refresh the top-level avg_lm1/avg_lm2
    // (frame 0 / ED's) the same way the single-frame branch below does.
    if (Array.isArray(r.frames) && r.frames.length > 0 && Array.isArray(r.frames[0]?.slices)) {
        let anySwapped = false;
        const frames = r.frames.map((f: any) => {
            const { slices, avg_lm1, avg_lm2, swapped } = normalizeSlicesAndAvg(f.slices ?? []);
            if (!swapped) return f;
            anySwapped = true;
            return { ...f, slices, avg_lm1: avg_lm1 ?? f.avg_lm1, avg_lm2: avg_lm2 ?? f.avg_lm2 };
        });
        if (!anySwapped) return result;

<<<<<<< HEAD
        const edFrame = frames[0];
        return { ...r, frames, avg_lm1: edFrame?.avg_lm1 ?? r.avg_lm1, avg_lm2: edFrame?.avg_lm2 ?? r.avg_lm2 };
    }

    if (Array.isArray(r.slices)) {
        const { slices, avg_lm1, avg_lm2, swapped } = normalizeSlicesAndAvg(r.slices);
        if (!swapped) return result;
        return { ...r, slices, avg_lm1: avg_lm1 ?? r.avg_lm1, avg_lm2: avg_lm2 ?? r.avg_lm2 };
=======
        const out: any = { ...r, slices };
        // avg_lm1/avg_lm2 are the ED (frame 0) mean: averaging across cardiac phases would blend
        // positions of a heart that moves through the cycle. Results without per-slice frames are ED-only.
        const both = slices.filter((s: any) => s?.lm1 && s?.lm2 && (s.frame ?? 0) === 0);
        if (both.length) {
            out.avg_lm1 = { x: mean(both.map((s: any) => s.lm1.x)), y: mean(both.map((s: any) => s.lm1.y)) };
            out.avg_lm2 = { x: mean(both.map((s: any) => s.lm2.x)), y: mean(both.map((s: any) => s.lm2.y)) };
        }
        return out;
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
    }

    if (Array.isArray(r.predictions)) {
        let anySwapped = false;
        const predictions = r.predictions.map((p: any) => {
            const [rv1] = normalizeRvInsertionOrder(p?.rv_insertion_1, p?.rv_insertion_2);
            if (rv1 === p?.rv_insertion_1) return p;
            anySwapped = true;
            return {
                ...p,
                rv_insertion_1: p.rv_insertion_2, rv_insertion_2: p.rv_insertion_1,
                hm1_max: p.hm2_max, hm2_max: p.hm1_max,
            };
        });
        return anySwapped ? ({ ...r, predictions } as T) : result;
    }

    return result;
}

export function normalizeLandmarkFrames<F extends { slices?: { landmarks?: { key: string; y: number }[] }[] }>(
    frames: F[],
): F[] {
    return frames.map((frame) => ({
        ...frame,
        slices: frame.slices?.map((slice) => {
            const landmarks = slice.landmarks ?? [];
            const p1 = landmarks.find((p) => p.key === "rv_insertion_1");
            const p2 = landmarks.find((p) => p.key === "rv_insertion_2");
            const [anterior] = normalizeRvInsertionOrder(p1, p2);
            if (anterior === p1) return slice;
            return {
                ...slice,
                landmarks: landmarks.map((p) =>
                    p === p1 ? { ...p, key: "rv_insertion_2" }
                    : p === p2 ? { ...p, key: "rv_insertion_1" }
                    : p,
                ),
            };
        }),
    }));
}
