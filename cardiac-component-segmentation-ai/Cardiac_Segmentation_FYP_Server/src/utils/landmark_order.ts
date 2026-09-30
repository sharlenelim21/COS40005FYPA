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

export function normalizeLandmarkJobResult<T>(result: T): T {
    const r = result as any;
    if (!r || typeof r !== "object") return result;

    if (Array.isArray(r.slices)) {
        let anySwapped = false;
        const slices = r.slices.map((s: any) => {
            const [lm1] = normalizeRvInsertionOrder(s?.lm1, s?.lm2);
            if (lm1 === s?.lm1) return s;
            anySwapped = true;
            return { ...s, lm1: s.lm2, lm2: s.lm1, hm1_max: s.hm2_max, hm2_max: s.hm1_max };
        });
        if (!anySwapped) return result;

        const out: any = { ...r, slices };
        const both = slices.filter((s: any) => s?.lm1 && s?.lm2);
        if (both.length) {
            out.avg_lm1 = { x: mean(both.map((s: any) => s.lm1.x)), y: mean(both.map((s: any) => s.lm1.y)) };
            out.avg_lm2 = { x: mean(both.map((s: any) => s.lm2.x)), y: mean(both.map((s: any) => s.lm2.y)) };
        }
        return out;
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
