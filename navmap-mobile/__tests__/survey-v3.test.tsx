import * as React from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { SurveyScreen } from '../src/SurveyScreen';
import { pathPointLabels, orderSurveyNodes } from '../src/path-survey';
import { memoryTokenStore } from '../src/api';
import type { DraftV3 } from '../src/contract-v3';
import type { WifiScanResults } from '../src/scan';

jest.mock('react-native');

function hostIs(type: unknown, tag: string): boolean {
  return (type as unknown as string) === tag;
}

function texts(root: ReactTestRenderer['root']): string[] {
  return root
    .findAll((n) => hostIs(n.type, 'Text'))
    .map((n) => (n.children ?? []).join(''));
}

const AP = ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02', 'AA:BB:CC:DD:EE:03'];

const scanAt = (t: number): WifiScanResults => ({
  updated: true,
  observedAtElapsedMicros: t,
  readings: [
    { bssid: AP[0], rssi: -50, seenAtElapsedMicros: t },
    { bssid: AP[1], rssi: -65, seenAtElapsedMicros: t },
  ],
});

const draft: DraftV3 = {
  schemaVersion: 4,
  venueId: 'venue-1',
  boundary: null,
  indoorZones: [
    {
      id: 'b1',
      name: 'Building 1',
      bounds: { north: 13, south: 12, east: 78, west: 77 },
      floors: [
        { z: 0, label: 'Ground' },
        { z: 1, label: 'Level 1' },
      ],
    },
  ],
  nodes: [
    { id: 'n-g0', name: 'Ground lobby sample point', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 4 },
    { id: 'n-l1', name: 'Level 1 landing sample point', lat: 12.5, lng: 77.5, z: 1, zoneId: 'b1', fingerprintRevision: 7 },
    { id: 'n-out', name: 'Outdoor gate sample point', lat: 12.6, lng: 77.6, z: 0, zoneId: null, fingerprintRevision: 2 },
  ],
  edges: [],
  places: [],
  anchors: [],
  aps: AP,
};

const base = {
  lastRequestAt: 0,
  now: 100_000,
  throttleMessage: null as string | null,
  onRequestScan: jest.fn(),
  httpPost: jest.fn(),
  tokenStore: memoryTokenStore(),
  onSaved: jest.fn(),
  venueId: 'venue-1',
};

test('v3 picker cascade building > floor > node shows confirm', () => {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SurveyScreen {...base} draft={draft} events={[]} />);
  });
  // Venue is fixed; zone list shows the building plus outdoors.
  expect(r!.root.findByProps({ testID: 'v3-zone-b1' })).toBeTruthy();
  expect(r!.root.findByProps({ testID: 'v3-zone-outdoors' })).toBeTruthy();

  act(() => {
    (r!.root.findByProps({ testID: 'v3-zone-b1' }).props.onPress as () => void)();
  });
  expect(r!.root.findByProps({ testID: 'v3-floor-0' })).toBeTruthy();
  expect(r!.root.findByProps({ testID: 'v3-floor-1' })).toBeTruthy();

  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-1' }).props.onPress as () => void)();
  });
  const nodePicker = r!.root.findByProps({ testID: 'v3-node-n-l1' });
  expect(texts(nodePicker).join('')).toBe('Level 1 landing sample point');
  expect(nodePicker.props.accessibilityLabel).toBe('Survey node Level 1 landing sample point');

  act(() => {
    (nodePicker.props.onPress as () => void)();
  });
  const confirm = texts(r!.root.findByProps({ testID: 'v3-confirm' })).join('\n');
  expect(confirm).toMatch(/Level 1 landing sample point/);
  expect(confirm).toMatch(/n-l1/);
  expect(confirm).toMatch(/b1/);
  expect(confirm).toMatch(/Level 1/);
});

test('v3 outdoors cascade Ground > outdoor node shows confirm', () => {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SurveyScreen {...base} draft={draft} events={[]} />);
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-zone-outdoors' }).props.onPress as () => void)();
  });
  expect(r!.root.findByProps({ testID: 'v3-floor-0' })).toBeTruthy();
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-0' }).props.onPress as () => void)();
  });
  expect(texts(r!.root.findByProps({ testID: 'v3-node-n-out' })).join('')).toBe('Outdoor gate sample point');
  act(() => {
    (r!.root.findByProps({ testID: 'v3-node-n-out' }).props.onPress as () => void)();
  });
  const confirm = texts(r!.root.findByProps({ testID: 'v3-confirm' })).join('\n');
  expect(confirm).toMatch(/Outdoor gate sample point/);
  expect(confirm).toMatch(/n-out/);
});

test('v3 upload posts {nodeId, scans} to the node-samples URL', async () => {
  const store = memoryTokenStore();
  await store.setToken('t');
  const calls: Array<{ url: string; body: unknown }> = [];
  const httpPost = async (url: string, body: unknown) => {
    calls.push({ url, body });
    return { status: 200, json: async () => ({ count: 3 }) };
  };
  const onSaved = jest.fn();
  let r: ReactTestRenderer;
  act(() => {
    r = create(
      <SurveyScreen
        {...base}
        draft={draft}
        venueId="venue-1"
        httpPost={httpPost}
        tokenStore={store}
        onSaved={onSaved}
        events={[scanAt(100), scanAt(135), scanAt(170)]}
      />,
    );
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-zone-b1' }).props.onPress as () => void)();
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-0' }).props.onPress as () => void)();
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-node-n-g0' }).props.onPress as () => void)();
  });
  // Readiness shows once >=3 distinct fresh scans are collected.
  expect(texts(r!.root.findByProps({ testID: 'v3-survey-status' })).join('')).toMatch(/3\/3/);
  await act(async () => {
    await (r!.root.findByProps({ testID: 'v3-survey-save' }).props.onPress as () => void)();
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain('/api/admin/venues/venue-1/node-samples');
  const body = calls[0]!.body as { nodeId?: string; scans?: Array<Record<string, unknown>>; fingerprintRevision?: number };
  expect(body.nodeId).toBe('n-g0');
  // Backend contract: strict {nodeId, scans}; revision travels per scan.
  expect(body.fingerprintRevision).toBeUndefined();
  expect(body.scans).toHaveLength(3);
  for (const scan of body.scans!) {
    expect(scan).toMatchObject({ nodeId: 'n-g0', fingerprintRevision: 4 });
    expect(Object.keys(scan).sort()).toEqual(['capturedAt', 'fingerprintRevision', 'nodeId', 'readings']);
  }
  expect(onSaved).toHaveBeenCalledWith(3);
});

test('pathPointLabels reports one-based ordered membership', () => {
  expect(pathPointLabels({ paths: [{ id: 'p', name: 'Corridor', nodeIds: ['a', 'b'] }] }, 'b'))
    .toEqual([{ pathId: 'p', pathName: 'Corridor', kind: 'regular', index: 2, total: 2 }]);
  expect(pathPointLabels({}, 'b')).toEqual([]);
});

test('pathPointLabels reports differing indices per path for a shared junction', () => {
  const map = {
    paths: [
      { id: 'p-main', name: 'Corridor', nodeIds: ['n-p1', 'n-p2', 'n-p3', 'n-junc'] },
      { id: 'p-side', name: 'Link', nodeIds: ['n-side', 'n-junc'] },
    ],
  };
  expect(pathPointLabels(map, 'n-junc')).toEqual([
    { pathId: 'p-main', pathName: 'Corridor', kind: 'regular', index: 4, total: 4 },
    { pathId: 'p-side', pathName: 'Link', kind: 'regular', index: 2, total: 2 },
  ]);
  // Landing keeps its own sequence index.
  expect(pathPointLabels(map, 'n-p3')).toEqual([
    { pathId: 'p-main', pathName: 'Corridor', kind: 'regular', index: 3, total: 4 },
  ]);
});

test('pathPointLabels preserves explicit stair category for native survey adapters', () => {
  expect(pathPointLabels({ paths: [{ id: 'stair', name: 'East stairs', kind: 'stair', nodeIds: ['lower', 'upper'] }] }, 'upper'))
    .toEqual([{ pathId: 'stair', pathName: 'East stairs', kind: 'stair', index: 2, total: 2 }]);
});

test('orderSurveyNodes follows first-seen path order, retains manual nodes, drops duplicates', () => {
  const map = {
    paths: [
      { id: 'p-main', name: 'Corridor', nodeIds: ['n-p1', 'n-p2', 'n-p3', 'n-junc'] },
      { id: 'p-side', name: 'Link', nodeIds: ['n-side', 'n-junc'] },
    ],
  };
  const mk = (id: string, generated: boolean) => ({ id, generated });
  const input = ['n-manual', 'n-p3', 'n-side', 'n-p1', 'n-p2', 'n-junc', 'n-junc'].map((id) =>
    mk(id, id !== 'n-manual'),
  );
  expect(orderSurveyNodes(map, input).map((n) => n.id)).toEqual([
    'n-p1',
    'n-p2',
    'n-p3',
    'n-junc',
    'n-side',
    'n-manual',
  ]);
  // No paths: draft order is preserved.
  expect(orderSurveyNodes({}, [mk('b', false), mk('a', false)]).map((n) => n.id)).toEqual(['b', 'a']);
});

const generatedDraft: DraftV3 = {
  ...draft,
  nodes: draft.nodes.map((n) => (n.id === 'n-l1' ? { ...n, generated: true } : n)),
  paths: [
    { id: 'p-corridor', name: 'Corridor', nodeIds: ['n-g0', 'n-l1'] },
    { id: 'p-link', name: 'Link', nodeIds: ['n-g0', 'n-l1'] },
  ],
};

function pickerNodeIds(r: ReactTestRenderer): string[] {
  return r.root
    .findAll(
      (n) => (n.type as unknown as string) === 'Pressable' &&
        typeof (n.props as { testID?: unknown }).testID === 'string' &&
        ((n.props as { testID: string }).testID.startsWith('v3-node-')),
    )
    .map((n) => (n.props as { testID: string }).testID.replace(/^v3-node-/, ''));
}

/** Deliberately shuffled draft order: junction appended last (as intersections do),
 * path points out of sequence, manual node first. */
const shuffledDraft: DraftV3 = {
  ...draft,
  nodes: [
    { id: 'n-manual', name: 'Manual desk', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1 },
    { id: 'n-p3', name: 'Corridor landing', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1, generated: true },
    { id: 'n-side', name: 'Side spur', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1, generated: true },
    { id: 'n-p1', name: 'Corridor start', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1, generated: true },
    { id: 'n-p2', name: 'Corridor bend', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1, generated: true },
    { id: 'n-junc', name: 'Shared junction', lat: 12.5, lng: 77.5, z: 0, zoneId: 'b1', fingerprintRevision: 1, generated: true },
  ],
  paths: [
    { id: 'p-main', name: 'Corridor', nodeIds: ['n-p1', 'n-p2', 'n-p3', 'n-junc'] },
    { id: 'p-side', name: 'Link', nodeIds: ['n-side', 'n-junc'] },
  ],
};

test('v3 picker lists generated points in path sequence order with manual retained once', () => {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SurveyScreen {...base} draft={shuffledDraft} events={[]} />);
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-zone-b1' }).props.onPress as () => void)();
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-0' }).props.onPress as () => void)();
  });
  // Generated members follow first-seen path order despite shuffled draft order;
  // the manual node is retained (not hidden) and the shared junction appears once.
  expect(pickerNodeIds(r!)).toEqual(['n-p1', 'n-p2', 'n-p3', 'n-junc', 'n-side', 'n-manual']);
  const junction = texts(r!.root.findByProps({ testID: 'v3-node-n-junc' })).join('');
  expect(junction).toContain('Corridor · Point 4 of 4');
  expect(junction).toContain('Link · Point 2 of 2');
  expect(texts(r!.root.findByProps({ testID: 'v3-node-n-p3' })).join('')).toContain('Corridor · Point 3 of 4');
});

function selectNodeL1(r: ReactTestRenderer): void {
  act(() => {
    (r.root.findByProps({ testID: 'v3-zone-b1' }).props.onPress as () => void)();
  });
  act(() => {
    (r.root.findByProps({ testID: 'v3-floor-1' }).props.onPress as () => void)();
  });
  act(() => {
    (r.root.findByProps({ testID: 'v3-node-n-l1' }).props.onPress as () => void)();
  });
}

test('v3 generated path point shows path order in picker and confirmation', () => {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SurveyScreen {...base} draft={generatedDraft} events={[]} />);
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-zone-b1' }).props.onPress as () => void)();
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-1' }).props.onPress as () => void)();
  });
  // Path membership is shown next to the node name without hiding manual nodes.
  expect(texts(r!.root.findByProps({ testID: 'v3-node-n-l1' })).join('')).toContain('Corridor · Point 2 of 2');
  // Manual nodes stay reachable via the floor filter (n-g0 is manual, on Ground).
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-0' }).props.onPress as () => void)();
  });
  expect(texts(r!.root.findByProps({ testID: 'v3-node-n-g0' })).join('')).toContain('Corridor · Point 1 of 2');
  act(() => {
    (r!.root.findByProps({ testID: 'v3-floor-1' }).props.onPress as () => void)();
  });
  act(() => {
    (r!.root.findByProps({ testID: 'v3-node-n-l1' }).props.onPress as () => void)();
  });
  const confirm = texts(r!.root.findByProps({ testID: 'v3-confirm' })).join('\n');
  expect(confirm).toMatch(/Corridor · Point 2 of 2/);
  expect(confirm).toMatch(/Level 1/);
  // Coordinates make physical survey placement unambiguous.
  expect(confirm).toMatch(/12\.5/);
  expect(confirm).toMatch(/77\.5/);
});

test('v3 shared junction confirmation shows both path memberships', () => {
  let r: ReactTestRenderer;
  act(() => {
    r = create(<SurveyScreen {...base} draft={generatedDraft} events={[]} />);
  });
  selectNodeL1(r!);
  const confirm = texts(r!.root.findByProps({ testID: 'v3-confirm' })).join('\n');
  expect(confirm).toMatch(/Corridor · Point 2 of 2/);
  expect(confirm).toMatch(/Link · Point 2 of 2/);
});

test('v3 generated point upload posts node id and revision, not a path id', async () => {
  const store = memoryTokenStore();
  await store.setToken('t');
  const calls: Array<{ url: string; body: unknown }> = [];
  const httpPost = async (url: string, body: unknown) => {
    calls.push({ url, body });
    return { status: 200, json: async () => ({ count: 3 }) };
  };
  const onSaved = jest.fn();
  let r: ReactTestRenderer;
  act(() => {
    r = create(
      <SurveyScreen
        {...base}
        draft={generatedDraft}
        venueId="venue-1"
        httpPost={httpPost}
        tokenStore={store}
        onSaved={onSaved}
        events={[scanAt(100), scanAt(135), scanAt(170)]}
      />,
    );
  });
  selectNodeL1(r!);
  await act(async () => {
    await (r!.root.findByProps({ testID: 'v3-survey-save' }).props.onPress as () => void)();
  });
  expect(calls).toHaveLength(1);
  const body = calls[0]!.body as { nodeId?: string; scans?: Array<Record<string, unknown>> };
  expect(body.nodeId).toBe('n-l1');
  expect(body.scans).toHaveLength(3);
  for (const scan of body.scans!) {
    expect(scan).toMatchObject({ nodeId: 'n-l1', fingerprintRevision: 7 });
  }
  expect(JSON.stringify(body)).not.toContain('p-corridor');
});
