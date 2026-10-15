import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { VisitorScreen } from '../src/VisitorScreen';
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
  expect(texts(renderer!.root.findByProps({ testID: 'visitor-v3-location' })).join(' ')).toBe('Current location: Building A · Ground');
  expect(texts(renderer!.root).join(' ')).not.toContain('PRIVATE SURVEY SAMPLE');
  expect(renderer!.root.findAll((node) => node.props.testID === 'visitor-start-n-a0b')).toHaveLength(0);
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
