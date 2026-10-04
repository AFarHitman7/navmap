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

const manifest = parseManifestV3({ ...fixture, version: 1, profiles: [] });
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

test('v3 visitor chooses a node destination and shows an explicit floor-aware route', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} />); });
  act(() => { renderer!.root.findByProps({ testID: 'visitor-v3-dest-n-a1' }).props.onPress(); });
  const route = renderer!.root.findByProps({ testID: 'visitor-route' });
  expect(route.props.children).toContain('n-out → n-a0 → n-a1');
  expect(renderer!.root.findByProps({ testID: 'visitor-gps-note' })).toBeTruthy();
  expect(renderer!.root.findByProps({ testID: 'visitor-wifi-note' })).toBeTruthy();
});

test('v4 visitor presents node names while preserving ids for routing controls', () => {
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<VisitorScreen {...base} />); });

  expect(renderer!.root.findByProps({ testID: 'visitor-v3-location' }).props.children).toContain('Outdoor entrance');

  const destination = renderer!.root.findByProps({ testID: 'visitor-v3-dest-n-a1' });
  expect(destination.props.testID).toBe('visitor-v3-dest-n-a1');
  expect(texts(destination).join('')).toBe('Destination Building A level 1 landing');

  const start = renderer!.root.findByProps({ testID: 'visitor-start-n-a0' });
  expect(start.props.testID).toBe('visitor-start-n-a0');
  expect(texts(start).join('')).toBe('Start at Building A ground lobby');
});
