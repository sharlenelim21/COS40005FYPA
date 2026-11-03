import {
  checkFrameSelection, everyKthFrame, MIN_FRAMES, originalFrameResult, originalMeshName,
} from '../src/services/reconstruction_frames';

describe('4D reconstruction frame selection', () => {
  it('builds every frame when no selection is given, or when it names every frame', () => {
    expect(checkFrameSelection(undefined, 30, 1)).toEqual({ ok: true, frameMap: null });
    expect(checkFrameSelection([3, 1, 2], 3, 1)).toEqual({ ok: true, frameMap: null });
  });

  it('keeps a selection sorted, without repeats, as 0-based original frames', () => {
    expect(checkFrameSelection([13, 1, 7, 7, 25], 30, 1)).toEqual({ ok: true, frameMap: [0, 6, 12, 24] });
  });

  it('refuses a selection without the end-diastole frame, with too few frames, or outside the scan', () => {
    expect(checkFrameSelection([2, 5, 9], 30, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/end-diastole/) });
    expect(checkFrameSelection([1, 12], 30, 1)).toMatchObject({ ok: false, error: expect.stringMatching(`at least ${MIN_FRAMES}`) });
    expect(checkFrameSelection([1, 5, 31], 30, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
    expect(checkFrameSelection([1, 2.5, 3], 30, 1)).toMatchObject({ ok: false });
    expect(checkFrameSelection('1,2,3', 30, 1)).toMatchObject({ ok: false });
    expect(checkFrameSelection([1, 2], 2, 1)).toEqual({ ok: true, frameMap: null });  // a 2-frame scan: both frames
  });

  it('offers every k-th frame, always with end-diastole and end-systole', () => {
    expect(everyKthFrame(10, 3, 1, 5)).toEqual([1, 4, 5, 7, 10]);
    expect(everyKthFrame(6, 2, 2)).toEqual([1, 2, 3, 5]);
  });

  it('renames a returned mesh from its build position to the original frame', () => {
    const map = [0, 6, 12, 24];
    expect(originalMeshName('gpu_callback_1_x_4D_lv_frame02.glb', map)).toBe('gpu_callback_1_x_4D_lv_frame12.glb');
    expect(originalMeshName('x_4D_rv_frame00_ED.obj', map)).toBe('x_4D_rv_frame00_ED.obj');
    expect(originalMeshName('x_4D_lv_frame03.glb', map)).toBe('x_4D_lv_frame24.glb');
    expect(originalMeshName('frame9_input_4D_lv_frame01.glb', map)).toBe('frame9_input_4D_lv_frame06.glb');
    expect(originalMeshName('x_4D_lv_frame07.glb', map)).toBe('x_4D_lv_frame07.glb');   // unknown position: unchanged
  });

  it("re-keys the GPU's per-frame results to the original frames", () => {
    const result = { ed_frame_index: 1, frame_aha_vertex_labels: { 0: [1], 1: [2], 3: [3] },
                     temporal_info: { processed_frame_indices: [0, 1, 3] }, chamber: 'lv' };
    expect(originalFrameResult(result, [2, 8, 14, 20])).toEqual({
      ed_frame_index: 8, frame_aha_vertex_labels: { 2: [1], 8: [2], 20: [3] },
      temporal_info: { processed_frame_indices: [2, 8, 20] }, chamber: 'lv', total_frames: 21,
      built_frames: [3, 9, 15, 21],
    });
  });
});
