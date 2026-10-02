import {
  changedTrainingPixels, describeCase, maskQuery, MAX_SELECTION, parseSelection, trainingLabels, withTrainingPixelCounts,
} from '../src/services/training_export';
import { selectTrainingSlices } from '../src/services/training_selection';

type Row = [number, number, number, string[]];
const mask = (id: string, model: string, editedAt: string, rows: Row[]) => ({
  _id: id,
  segmentationModel: model,
  editTracking: {
    status: 'computed', editedSliceCount: rows.length, editedAt, aiMaskId: `ai-${id}`,
    slices: rows.map(([frameindex, sliceindex, pixelsChanged, editedClasses]) =>
      ({ frameindex, sliceindex, pixelsChanged, editedClasses, byClass: {} })),
  },
});
const project = { _id: 'p1', name: 'Patient 012', dimensions: { height: 216, width: 256 } };

describe('Extend Training export helpers (plan WS13 R1)', () => {
  it('reads a selection file of mask ids and refuses anything else', () => {
    const id = 'a'.repeat(24);
    expect(parseSelection({ maskIds: [id, id] })).toEqual([id]);
    expect(() => parseSelection({ maskIds: [] })).toThrow();
    expect(() => parseSelection({ maskIds: ['not-a-mask-id'] })).toThrow();
    expect(() => parseSelection({ maskIds: [{ $ne: null }] })).toThrow();
    const tooMany = Array.from({ length: MAX_SELECTION + 1 }, (_, i) => i.toString(16).padStart(24, '0'));
    expect(() => parseSelection({ maskIds: tooMany })).toThrow();
    expect(() => parseSelection(null)).toThrow();
  });

  it("narrows the query to one user's projects and to the chosen masks", () => {
    const models = ['unet', 'medsam'];
    expect(maskQuery(models, null, null)).toEqual(
      { isMedSAMOutput: false, segmentationModel: { $in: models }, 'editTracking.status': 'computed' });
    expect(maskQuery(models, ['p1'], ['m1'])).toMatchObject({ projectid: { $in: ['p1'] }, _id: { $in: ['m1'] } });
    expect(maskQuery(models, [], null)).toMatchObject({ projectid: { $in: [] } }); // no projects: nothing matches
  });

  it('describes a case from its own qualifying slices, before D5 picks between models', () => {
    const unet = mask('m-unet', 'unet', '2026-09-26T05:00:00Z',
      [[0, 3, 120, ['rv']], [0, 4, 900, ['rv', 'myo']], [1, 2, 5, ['lvc']]]);
    const medsam = mask('m-medsam', 'medsam', '2026-09-26T06:00:00Z', [[0, 4, 300, ['myo']]]);
    const both = selectTrainingSlices([unet, medsam], 20);
    const row = describeCase(project, selectTrainingSlices([unet], 20).selected[0], both.conflicts);
    expect(row).toEqual({
      maskId: 'm-unet', projectId: 'p1', projectName: 'Patient 012', model: 'unet', aiMaskId: 'ai-m-unet',
      editedAt: '2026-09-26T05:00:00Z', height: 216, width: 256,
      slices: [{ frameindex: 0, sliceindex: 3, pixelsChanged: 120, editedClasses: ['rv'] },
               { frameindex: 0, sliceindex: 4, pixelsChanged: 900, editedClasses: ['rv', 'myo'] }],
      pixelsChanged: 1020, structures: ['rv', 'myo'], shared: 1, frozen: null,
    });
    // With both selected, D5 gives frame 0 slice 4 to the later MedSAM save, as before.
    expect(both.selected.find(entry => entry.model === 'unet')!.slices).toHaveLength(1);
  });

  it('marks a case whose project is a frozen test patient, so Prepare can lock it', () => {
    const unet = mask('m-unet', 'unet', '2026-09-26T05:00:00Z', [[0, 3, 120, ['rv']]]);
    const hit = { frame: 0, slice: 0, frozen: 'acdc/patient108_frame01.nii.gz#z0' };
    expect(describeCase(project, selectTrainingSlices([unet], 20).selected[0], [], hit).frozen).toEqual(hit);
  });

  it('labels a slice the way training does: first class written wins, manual and unknown classes ignored', () => {
    const labels = trainingLabels([
      { class: 'RV', segmentationmaskcontents: '0 3' },
      { class: 'myo', segmentationmaskcontents: '2 2' },          // pixel 2 stays RV: first written wins
      { class: 'manual', segmentationmaskcontents: '5 1' },
      { class: 'lv', segmentationmaskcontents: '6 1' },
      { class: 'lvc', segmentationmaskcontents: '7 5' },           // leaves the 8-pixel plane: skipped whole
      { class: 'rv', segmentationmaskcontents: 'not numbers' },
    ], 8);
    expect([...labels]).toEqual([1, 1, 1, 2, 0, 0, 3, 0]);
  });

  it('counts a pixel moved between structures once, as the training label changes', () => {
    const ai = [{ class: 'rv', segmentationmaskcontents: '0 4' }];
    const edited = [{ class: 'rv', segmentationmaskcontents: '0 2' }, { class: 'myo', segmentationmaskcontents: '2 3' }];
    // Per structure this is 2 RV + 3 MYO = 5 changes; the training label changes on pixels 2, 3 and 4 only.
    expect(changedTrainingPixels(ai, edited, 8)).toBe(3);
    expect(changedTrainingPixels(undefined, edited, 8)).toBe(5);  // a slice missing from the AI result: all of it
  });

  it("recounts a mask's tracked slices from its AI result, and leaves the mask itself untouched", () => {
    const frames = (entries: object[]) => [{ frameindex: 0, slices: [{ sliceindex: 3, segmentationmasks: entries }] }];
    const edited = { ...mask('m-unet', 'unet', '2026-09-26T05:00:00Z', [[0, 3, 5, ['rv', 'myo']]]),
                     frames: frames([{ class: 'rv', segmentationmaskcontents: '0 2' }, { class: 'myo', segmentationmaskcontents: '2 3' }]) };
    const ai = { _id: 'ai-m-unet', frames: frames([{ class: 'rv', segmentationmaskcontents: '0 4' }]) };
    const recounted = withTrainingPixelCounts(edited, ai, 8);
    expect(recounted.editTracking.slices[0]).toMatchObject({ pixelsChanged: 3, pixelsChangedPerClass: 5 });
    expect(edited.editTracking.slices[0].pixelsChanged).toBe(5);
    expect(withTrainingPixelCounts(edited, undefined, 8)).toBe(edited);  // no AI result: the saved counts stand
  });
});
