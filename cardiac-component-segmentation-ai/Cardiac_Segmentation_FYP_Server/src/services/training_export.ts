/**
 * What the Extend Training page's Prepare tab lists, and what it may send back (plan WS13 R1).
 *
 * Pure (no database), so it can be tested; export_training_set.ts uses it for --owner, --selection and the dry run's
 * "cases". A case is one saved, editable mask of one model. Its slices are the ones that qualify on their own, before
 * D5 picks between two models' corrections of the same slice, so a user who clears one model's case can still train
 * the other.
 */
import { SelectedMask, SliceConflict, sliceKey, TrackedMask, TrackedSlice, TrainingModel } from './training_selection';

export const MASK_ID = /^[0-9a-f]{24}$/;
export const MAX_SELECTION = 500;
const STRUCTURES = ['rv', 'myo', 'lvc'];
// The training label of each class, as visheart-retraining/build_training_volumes.py CLASS_TO_LABEL.
const TRAINING_LABEL: Record<string, number> = { rv: 1, myo: 2, lvc: 3, lv: 3 };

export interface FrozenMatch {
    frame: number;
    slice: number;
    frozen: string;
}

interface MaskEntry {
    class?: unknown;
    segmentationmaskcontents?: unknown;
}

export interface CaseSlice {
    frameindex: number;
    sliceindex: number;
    pixelsChanged: number;
    editedClasses: string[];
}

export interface ExportCase {
    maskId: string;
    projectId: string;
    projectName: string;
    model: TrainingModel;
    aiMaskId: string | null;
    editedAt: string | null;
    height: number;
    width: number;
    slices: CaseSlice[];
    pixelsChanged: number;
    structures: string[];
    shared: number; // slices the project's other model also corrected, differently
    frozen: FrozenMatch | null; // the project is a frozen test patient: every export refuses it
}

/**
 * One training label per pixel of a slice (0 background, 1 RV, 2 myocardium, 3 LV cavity), built as
 * build_training_volumes.py label_slice builds it: RLE "start length" pairs over the row-major plane, a run that
 * leaves the plane skipped whole, an unparseable string empty, and in array order the first label written wins.
 */
export function trainingLabels(entries: MaskEntry[] | undefined, planeSize: number): Uint8Array {
    const labels = new Uint8Array(planeSize);
    for (const entry of entries ?? []) {
        const label = TRAINING_LABEL[String(entry.class ?? '').toLowerCase()];
        if (!label) continue;
        const parts = String(entry.segmentationmaskcontents ?? '').split(/\s+/).filter(Boolean).map(Number);
        if (parts.some(part => !Number.isInteger(part))) continue;
        for (let i = 0; i + 1 < parts.length; i += 2) {
            const start = parts[i], length = parts[i + 1];
            if (start < 0 || start + length > planeSize) continue;
            for (let p = start; p < start + length; p++) if (labels[p] === 0) labels[p] = label;
        }
    }
    return labels;
}

/** The pixels whose training label a correction changed. Edit tracking counts per class, so a moved pixel counts twice. */
export function changedTrainingPixels(aiEntries: MaskEntry[] | undefined, editedEntries: MaskEntry[] | undefined,
                                      planeSize: number): number {
    const before = trainingLabels(aiEntries, planeSize);
    const after = trainingLabels(editedEntries, planeSize);
    let changed = 0;
    for (let i = 0; i < planeSize; i++) if (before[i] !== after[i]) changed++;
    return changed;
}

interface FramedMask {
    frames?: { frameindex?: unknown; slices?: { sliceindex?: unknown; segmentationmasks?: MaskEntry[] }[] }[];
}

function entriesAt(mask: FramedMask, frameindex: number, sliceindex: number): MaskEntry[] | undefined {
    return mask.frames?.find(frame => Number(frame.frameindex) === frameindex)
        ?.slices?.find(slice => Number(slice.sliceindex) === sliceindex)?.segmentationmasks;
}

/**
 * A copy of `mask` whose tracked slices count the pixels whose training label changed, compared with its AI result,
 * so the 20-pixel rule, the page and the builder all use the pixels that train. The saved per-class count is kept
 * as pixelsChangedPerClass. Without the AI result the saved counts stand, and `mask` is returned as it is.
 */
export function withTrainingPixelCounts<M extends TrackedMask & FramedMask>(mask: M, aiMask: FramedMask | undefined,
                                                                         planeSize: number): M {
    if (!aiMask || !mask.editTracking?.slices) return mask;
    const slices = mask.editTracking.slices.map((slice: TrackedSlice) => {
        const frameindex = Number(slice.frameindex), sliceindex = Number(slice.sliceindex);
        return { ...slice, pixelsChangedPerClass: slice.pixelsChanged,
                 pixelsChanged: changedTrainingPixels(entriesAt(aiMask, frameindex, sliceindex),
                                                      entriesAt(mask, frameindex, sliceindex), planeSize) };
    });
    return { ...mask, editTracking: { ...mask.editTracking, slices } };
}

/** The mask ids of a --selection file, {"maskIds": [...]}. Anything else is refused, never guessed at. */
export function parseSelection(content: unknown): string[] {
    const ids = (content as { maskIds?: unknown } | null)?.maskIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SELECTION) {
        throw new Error(`a selection lists 1 to ${MAX_SELECTION} mask ids`);
    }
    for (const id of ids) {
        if (typeof id !== 'string' || !MASK_ID.test(id)) throw new Error(`not a mask id: ${JSON.stringify(id)}`);
    }
    return [...new Set(ids as string[])];
}

/** The editable-masks query, narrowed to one user's projects and to the chosen masks when those are given. */
export function maskQuery(models: readonly string[], ownedProjectIds: string[] | null,
                          selection: string[] | null): Record<string, unknown> {
    return {
        isMedSAMOutput: false, segmentationModel: { $in: [...models] }, 'editTracking.status': 'computed',
        ...(ownedProjectIds ? { projectid: { $in: ownedProjectIds } } : {}),
        ...(selection ? { _id: { $in: selection } } : {}),
    };
}

/**
 * One row of the Prepare tab. `own` is selectTrainingSlices([mask]).selected[0]; `conflicts` are the project's;
 * `frozen` is the frozen-set guard's match for the project's source volume, when the dry run checked it.
 */
export function describeCase<M extends TrackedMask>(
    project: { _id?: unknown; name?: unknown; dimensions?: { height?: number; width?: number } },
    own: SelectedMask<M>, conflicts: SliceConflict[], frozen: FrozenMatch | null = null): ExportCase {
    const tracking = own.mask.editTracking ?? {};
    const slices = own.slices.map((slice: TrackedSlice) => ({
        frameindex: Number(slice.frameindex), sliceindex: Number(slice.sliceindex),
        pixelsChanged: Number(slice.pixelsChanged),
        editedClasses: (Array.isArray(slice.editedClasses) ? (slice.editedClasses as unknown[]) : []).map(String),
    }));
    const keys = new Set(slices.map(slice => sliceKey(slice.frameindex, slice.sliceindex)));
    const shared = conflicts.filter(conflict => keys.has(sliceKey(conflict.frameindex, conflict.sliceindex))
        && conflict.contenders.some(contender => contender.model === own.model)).length;
    return {
        maskId: String(own.mask._id), projectId: String(project._id), projectName: String(project.name ?? 'Untitled project'),
        model: own.model, aiMaskId: tracking.aiMaskId ? String(tracking.aiMaskId) : null,
        editedAt: tracking.editedAt ? String(tracking.editedAt) : null,
        height: Number(project.dimensions?.height ?? 0), width: Number(project.dimensions?.width ?? 0),
        slices, pixelsChanged: slices.reduce((sum, slice) => sum + slice.pixelsChanged, 0),
        structures: STRUCTURES.filter(name => slices.some(slice => slice.editedClasses.includes(name))),
        shared, frozen,
    };
}
