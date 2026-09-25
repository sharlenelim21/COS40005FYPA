/**
 * Which slices of a project's saved editable masks become training labels for the UNet.
 *
 * Pure (no database), so it can be tested: the export script groups a project's masks and calls this.
 * UNet and MedSAM corrections count alike (Jy, 2026-09-15): a slice counts when edit tracking found at
 * least `minPixels` changed pixels and no `manual` pixels. `manual` marks a region whose anatomical class
 * is unknown, and dropping only those pixels would teach the model that they are background. A
 * bounding-box re-run that reproduces the AI output changes no pixels, so it never counts.
 *
 * One image slice gives at most one label. When both models corrected the same frame and slice:
 * - pixel-identical corrections are not a conflict, and one copy is used;
 * - otherwise the later save is suggested (UNet on a tie), and a reviewed choice overrides it.
 */
export const TRAINING_MODELS = ["unet", "medsam"] as const;
export type TrainingModel = typeof TRAINING_MODELS[number];

export interface TrackedSlice {
    frameindex: number;
    sliceindex: number;
    pixelsChanged: number;
    byClass?: Record<string, number>;
    [key: string]: unknown;
}

export interface TrackedMask {
    _id?: unknown;
    segmentationModel?: string;
    model_used?: string;
    editTracking?: {
        status?: string;
        editedSliceCount?: number;
        suspect?: string;
        editedAt?: string;
        slices?: TrackedSlice[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface SelectedMask<M extends TrackedMask> {
    mask: M;
    model: TrainingModel;
    slices: TrackedSlice[];
}

export interface SelectionOptions {
    /** "frame:slice" keys where the competing corrections are pixel-identical. */
    identicalSlices?: Set<string>;
    /** "frame:slice" -> the model whose correction to use, from a reviewed conflicts file. */
    choices?: Record<string, string>;
}

export interface SliceConflict {
    frameindex: number;
    sliceindex: number;
    suggested: TrainingModel;
    used: TrainingModel;
    chosen: boolean;
    contenders: { model: TrainingModel; editedAt: string | null }[];
}

export const sliceKey = (frameindex: number, sliceindex: number) => `${frameindex}:${sliceindex}`;

export const selectTrainingSlices = <M extends TrackedMask>(masks: M[], minPixels: number, options: SelectionOptions = {}) => {
    const skipped: Record<string, number> = {};
    const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

    type Candidate = { mask: M; model: TrainingModel; savedAt: number; editedAt: string | null; slices: TrackedSlice[] };
    const candidates: Candidate[] = [];
    for (const mask of masks) {
        const tag = String(mask.segmentationModel || mask.model_used || "").toLowerCase();
        if (!(TRAINING_MODELS as readonly string[]).includes(tag)) { skip("unknown_model"); continue; }
        const tracking = mask.editTracking;
        if (!tracking || tracking.status !== "computed" || !(Number(tracking.editedSliceCount) > 0)) { skip("not_tracked"); continue; }
        if (tracking.suspect) { skip("suspect"); continue; }
        const slices = (tracking.slices ?? []).filter((slice) => {
            if ((slice.byClass?.manual ?? 0) > 0) { skip("slice_manual"); return false; }
            if (!(slice.pixelsChanged >= minPixels)) { skip("slice_below_min_pixels"); return false; }
            return true;
        });
        const savedAt = tracking.editedAt ? Date.parse(tracking.editedAt) : NaN;
        candidates.push({ mask, model: tag as TrainingModel, savedAt: Number.isNaN(savedAt) ? 0 : savedAt,
                          editedAt: tracking.editedAt ?? null, slices });
    }

    const contenders = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
        for (const slice of candidate.slices) {
            const key = sliceKey(slice.frameindex, slice.sliceindex);
            contenders.set(key, [...(contenders.get(key) ?? []), candidate]);
        }
    }

    // Each slice gets one owner: the reviewed choice if valid, else the later save (UNet on a tie).
    const later = (a: Candidate, b: Candidate) =>
        a.savedAt !== b.savedAt ? a.savedAt > b.savedAt : a.model === "unet" && b.model !== "unet";
    const owner = new Map<string, Candidate>();
    const conflicts: SliceConflict[] = [];
    for (const [key, group] of contenders) {
        const suggested = group.reduce((best, candidate) => (later(candidate, best) ? candidate : best));
        let winner = suggested;
        if (group.length > 1) {
            let dropReason = "slice_duplicate_identical";
            if (!options.identicalSlices?.has(key)) {
                const choice = options.choices?.[key];
                const chosen = choice === undefined ? undefined : group.find((candidate) => candidate.model === choice);
                if (choice !== undefined && !chosen) skip("invalid_choice");
                winner = chosen ?? suggested;
                dropReason = chosen ? "slice_conflict_other_choice" : "slice_conflict_older_save";
                const [frameindex, sliceindex] = key.split(":").map(Number);
                conflicts.push({ frameindex, sliceindex, suggested: suggested.model, used: winner.model, chosen: Boolean(chosen),
                                 contenders: group.map((candidate) => ({ model: candidate.model, editedAt: candidate.editedAt })) });
            }
            for (const candidate of group) if (candidate !== winner) skip(dropReason);
        }
        owner.set(key, winner);
    }

    const selected: SelectedMask<M>[] = [];
    for (const candidate of candidates) {
        const kept = candidate.slices
            .filter((slice) => owner.get(sliceKey(slice.frameindex, slice.sliceindex)) === candidate)
            .sort((a, b) => a.frameindex - b.frameindex || a.sliceindex - b.sliceindex);
        if (kept.length > 0) selected.push({ mask: candidate.mask, model: candidate.model, slices: kept });
    }
    conflicts.sort((a, b) => a.frameindex - b.frameindex || a.sliceindex - b.sliceindex);
    return { selected, skipped, conflicts };
};
