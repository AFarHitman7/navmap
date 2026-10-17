import { describe, expect, it } from 'vitest';
import { staticDraft } from '../src/fixtures/map-v5';
import { assignBackground, calibrateFrame } from '../src/editor-v3/model';
import { commitEdit, createHistory, undoEdit } from '../src/editor-v3/history';
import { parseMapDraft } from '../src/map-contract';

const asset = { assetId: 'a'.repeat(64), width: 1000, height: 500, sha256: 'b'.repeat(64), byteLength: 42 };

describe('static layout draft edits', () => {
  it('assigns a background and invalidates every node fingerprint in that frame', () => {
    const original = staticDraft();
    const draft = parseMapDraft({
      ...original,
      frames: original.frames.map((frame) => frame.id === 'frame-b-a-z0'
        ? { ...frame, calibration: { metersPerPixel: 0.2 } }
        : frame),
      edges: original.edges.map((edge, index) => index === 0 ? { ...edge, meters: 100 } : edge),
    });
    const before = draft.nodes.filter((node) => node.frameId === 'frame-b-a-z0');
    const next = assignBackground(draft, 'frame-b-a-z0', asset);
    expect(next.frames.find((frame) => frame.id === 'frame-b-a-z0')?.background).toEqual(asset);
    expect(next.frames.find((frame) => frame.id === 'frame-b-a-z0')?.calibration).toBeUndefined();
    expect(next.edges[0]?.meters).toBeUndefined();
    expect(next.nodes.filter((node) => node.frameId === 'frame-b-a-z0').map((node) => node.fingerprintRevision))
      .toEqual(before.map((node) => node.fingerprintRevision + 1));
    expect(next.nodes.filter((node) => node.frameId === 'frame-b-a-z0').map((node) => node.position))
      .toEqual(before.map((node) => node.position));
    expect(draft.frames.find((frame) => frame.id === 'frame-b-a-z0')?.background).not.toEqual(asset);
  });

  it('calibrates a 100-pixel segment as ten metres', () => {
    const draft = staticDraft();
    const next = calibrateFrame(draft, 'frame-b-a-z0', { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, 10);
    expect(next.frames.find((frame) => frame.id === 'frame-b-a-z0')?.calibration?.metersPerPixel).toBeCloseTo(0.1);
    expect(next.edges[0]?.meters).toBeCloseTo(50);
    expect(next.edges[3]?.meters).toBeUndefined();
    expect(next.nodes.filter((node) => node.frameId === 'frame-b-a-z0').map((node) => node.fingerprintRevision))
      .toEqual(draft.nodes.filter((node) => node.frameId === 'frame-b-a-z0').map((node) => node.fingerprintRevision + 1));
  });

  it('rejects identical points, invalid distance, missing frames, and non-static drafts', () => {
    const draft = staticDraft();
    expect(() => calibrateFrame(draft, 'frame-b-a-z0', { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 }, 10))
      .toThrow('Choose two distinct points and a positive distance');
    expect(() => calibrateFrame(draft, 'frame-b-a-z0', { x: 0, y: 0 }, { x: 1, y: 0 }, Number.NaN))
      .toThrow('Choose two distinct points and a positive distance');
    expect(() => calibrateFrame(draft, 'frame-b-a-z0', { x: 0, y: 0 }, { x: 1, y: 0 }, 0))
      .toThrow('Choose two distinct points and a positive distance');
    expect(() => calibrateFrame(draft, 'frame-b-a-z0', { x: -0.1, y: 0 }, { x: 1, y: 0 }, 10))
      .toThrow('Choose two distinct points and a positive distance');
    expect(() => assignBackground(draft, 'missing-floor', asset)).toThrow(/frame/i);
  });

  it('keeps node positions and edge costs when calibration changes', () => {
    const draft = staticDraft();
    const next = calibrateFrame(draft, 'frame-b-a-z0', { x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, 10);
    expect(next.nodes.map((node) => node.position)).toEqual(draft.nodes.map((node) => node.position));
    expect(next.edges.map((edge) => edge.cost)).toEqual(draft.edges.map((edge) => edge.cost));
  });

  it('undoes background and calibration transactions through shared history', () => {
    const initial = staticDraft();
    const withBackground = assignBackground(initial, 'frame-outdoor-z0', asset);
    const withScale = calibrateFrame(withBackground, 'frame-outdoor-z0', { x: 0, y: 0 }, { x: 0.1, y: 0 }, 5);
    const history = commitEdit(commitEdit(createHistory(initial), withBackground, 'Assign background'), withScale, 'Calibrate floor');
    expect(undoEdit(history).present.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.calibration).toBeUndefined();
    expect(undoEdit(undoEdit(history)).present.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.background).toBeUndefined();
  });
});
