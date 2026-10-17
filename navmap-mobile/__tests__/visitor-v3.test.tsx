import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { VisitorScreen } from '../src/VisitorScreen';
import { MapView } from '../src/map/MapView';
import { parseManifestV3 } from '../src/contract-v3';
import fixture from '../src/fixtures/unified-v3.json';

jest.mock('react-native');

function hostIs(type: unknown, tag: string): boolean {
  return (type as unknown as string) === tag;
}

function texts(root: ReactTestRenderer['root']): string[] {
  return root
    .findAll((n) => hostIs(n.type, 'Text'))
    .map((n) => (n.children ?? []).join(''));
}

const manifest = parseManifestV3({ ...fixture, version: 1, profiles: [], nodes: fixture.nodes.map((node) =>
  node.id === 'n-a0b' ? { ...node, generated: true, name: 'PRIVATE SURVEY SAMPLE' } : node),
  places: [{ id: 'p-landing', name: 'Upper landing', nodeId: 'n-a1', zoneId: 'b-a' }] });
const base = {
  manifest,
  qrNodeId: null,
  manualNodeId: null,
  destinationId: '',
  onDestination: jest.fn(),
  onManualStart: jest.fn(),
  v3NodeId: 'n-out',
  v3ZoneId: null,
  v3Location: null,
  onResumeAuto: jest.fn(),
};

test('v4 visitor normalizes to visitor presentation and routes without exposing internal IDs or hidden samples', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} />); });
  act(() => { renderer!.root.findByProps({ testID: 'visitor-v3-dest-n-a1' }).props.onPress(); });
  const route = renderer!.root.findByProps({ testID: 'visitor-route' });
  expect(texts(renderer!.root).join(' ')).toContain('Take stairs');
  expect(texts(renderer!.root).join(' ')).not.toContain('n-out');
  expect(texts(renderer!.root).join(' ')).not.toContain('PRIVATE SURVEY SAMPLE');
  expect(texts(renderer!.root).join(' ')).not.toContain('n-a0b');
  expect(renderer!.root.findByProps({ testID: 'visitor-gps-note' })).toBeTruthy();
  expect(renderer!.root.findByProps({ testID: 'visitor-wifi-note' })).toBeTruthy();
});

test('visitor uses Place labels and human-readable current location', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} />); });

  expect(renderer!.root.findByProps({ testID: 'visitor-v3-location' }).props.children).toContain('Outdoor entrance');

  const destination = renderer!.root.findByProps({ testID: 'visitor-v3-dest-n-a1' });
  expect(destination.props.testID).toBe('visitor-v3-dest-n-a1');
  expect(texts(destination).join('')).toBe('Destination Upper landing');

  const start = renderer!.root.findByProps({ testID: 'visitor-start-n-a0' });
  expect(start.props.testID).toBe('visitor-start-n-a0');
  expect(texts(start).join('')).toBe('Start at Building A ground lobby');
});

test('QR/manual positions on hidden samples get a generic location label and no marker choice', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} v3NodeId="n-a0b" />); });
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ')).toBe('Starting point: Building A · Ground');
  expect(texts(renderer!.root).join(' ')).not.toContain('PRIVATE SURVEY SAMPLE');
  expect(renderer!.root.findAll((node) => node.props.testID === 'visitor-start-n-a0b')).toHaveLength(0);
});

test('manual and QR starts are labeled by source and geographic tooltip uses a generic hidden-node label', () => {
  for (const [source, label] of [
    ['manual', 'Manual starting point'], ['qr', 'QR check-in'],
  ] as const) {
    let renderer: ReactTestRenderer;
    const location = { kind: 'node' as const, nodeId: 'n-a0b', zoneId: 'b-a', z: 0, source, seenAt: 10 };
    act(() => { renderer = create(<VisitorScreen {...base} v3NodeId="n-a0b" manualNodeId={source === 'manual' ? 'n-a0b' : null}
      qrNodeId={source === 'qr' ? 'n-a0b' : null} v3Location={location} />); });
    expect(texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ')).toBe(`${label}: Building A · Ground`);
    expect(texts(renderer!.root).join(' ')).not.toContain('PRIVATE SURVEY SAMPLE');
    const mapProps = renderer!.root.findByType(MapView).props;
    expect(mapProps.v3.nodes.find((node: { id: string }) => node.id === 'n-a0b')?.name).toBe('Known location');
  }
});

test('unknown and destination-only states never claim a current location', () => {
  let unknown: ReactTestRenderer;
  act(() => { unknown = create(<VisitorScreen {...base} v3NodeId={null} v3Location={{ kind: 'unknown' }} />); });
  expect(texts(unknown!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ')).toBe('Current location: not available');

  let destinationOnly: ReactTestRenderer;
  act(() => { destinationOnly = create(<VisitorScreen {...base} v3NodeId={null} destinationId="p-landing" />); });
  const locationText = texts(destinationOnly!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ');
  expect(locationText).toBe('Current location: choose a starting point');
  expect(locationText).not.toMatch(/Current location: Upper landing/);
});

test('Wi-Fi location reports that it is an estimate and includes the reading time', () => {
  let renderer: ReactTestRenderer;
  const seenAt = 1_700_000_000_000;
  act(() => { renderer = create(<VisitorScreen {...base} v3NodeId="n-a0b"
    v3Location={{ kind: 'node', nodeId: 'n-a0b', zoneId: 'b-a', z: 0, source: 'wifi', seenAt }} />); });
  const text = texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ');
  expect(text).toMatch(/^Wi-Fi estimate \(last updated .+\): Building A · Ground$/);
  expect(text).not.toMatch(/^Current location:/);
});

test('manual frame selection persists across location changes until Resume follow', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} />); });
  const floorOneFrame = 'frame-b-a-z1';
  const floorOne = renderer!.root.findByProps({ testID: `visitor-frame-${floorOneFrame}` });
  act(() => { floorOne.props.onPress(); });
  act(() => { renderer!.update(<VisitorScreen {...base} v3NodeId="n-a0" v3ZoneId="b-a" />); });
  expect(renderer!.root.findByProps({ testID: `visitor-frame-${floorOneFrame}` }).props.accessibilityState.selected).toBe(true);
  act(() => { renderer!.root.findByProps({ testID: 'visitor-resume-auto' }).props.onPress(); });
  expect(renderer!.root.findByProps({ testID: `visitor-frame-${floorOneFrame}` }).props.accessibilityState.selected).toBe(false);
  expect(renderer!.root.findByProps({ testID: 'visitor-frame-frame-b-a-z0' }).props.accessibilityState.selected).toBe(true);
  expect(base.onResumeAuto).toHaveBeenCalled();
});

test('fresh GPS evidence renders as an unsnapped dot separate from the routing start', () => {
  let renderer: ReactTestRenderer;
  const gpsFix = { lat: 13.051, lon: 80.251, accuracy: 12, seenAt: Date.now() };
  act(() => {
    renderer = create(<VisitorScreen
      {...base} v3NodeId={null} v3Location={null} destinationId="" gpsFix={gpsFix} />);
  });
  const mapProps = renderer!.root.findByType(MapView).props;
  expect(mapProps.gps).toEqual({ lat: 13.051, lng: 80.251, accuracyMeters: 12 });
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-gps-status' })).join(' '))
    .toBe('You are here (±12 m). GPS does not set your starting point.');
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' '))
    .toBe('Current location: choose a starting point');
});

test('outside-venue GPS is labelled outside and never sets a start', () => {
  let renderer: ReactTestRenderer;
  const gpsFix = { lat: 14.0, lon: 81.0, accuracy: 30, seenAt: Date.now() };
  act(() => {
    renderer = create(<VisitorScreen
      {...base} v3NodeId={null} v3Location={null} destinationId="" gpsFix={gpsFix} />);
  });
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-gps-status' })).join(' '))
    .toBe('Outside venue (±30 m). GPS does not set your starting point.');
  expect(renderer!.root.findByType(MapView).props.gps).toEqual({ lat: 14.0, lng: 81.0, accuracyMeters: 30 });
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' '))
    .toBe('Current location: choose a starting point');
});

test('stale GPS evidence is labelled stale and never becomes a live dot', () => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<VisitorScreen
      {...base} v3NodeId={null} v3Location={null} destinationId=""
      gpsFix={{ lat: 13.05, lon: 80.25, accuracy: 12, seenAt: 0 }} />);
  });
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-gps-status' })).join(' '))
    .toBe('GPS reading is stale. Choose a known starting point.');
  expect(renderer!.root.findByType(MapView).props.gps).toBeNull();
});

test('static canvas ignores GPS evidence and keeps node-based labels', async () => {
  const { staticDraft } = await import('../src/fixtures/map-v5');
  const manifest = { ...staticDraft(), version: 2, profiles: [] };
  const frame = manifest.frames.find((candidate) => candidate.background);
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<VisitorScreen
      {...base} manifest={manifest} destinationId="p-lobby" v3NodeId="s-a0"
      v3Location={{ kind: 'node', nodeId: 's-a0', zoneId: 'b-a', z: 0, source: 'manual', seenAt: Date.now() }}
      manualNodeId="s-a0"
      packAdapter={{ readBytes: async () => new Uint8Array(frame!.background!.byteLength) } as never}
      gpsFix={{ lat: 13.05, lon: 80.25, accuracy: 12, seenAt: Date.now() }} />);
  });
  expect(renderer!.root.findAll((node) => node.props.testID === 'visitor-gps-status')).toHaveLength(0);
  expect(renderer!.root.findByType(MapView).props.gps).toBeUndefined();
  expect(texts(renderer!.root).join(' ')).toContain('Wi-Fi positioning needs native Android capabilities and surveyed profiles.');
});
