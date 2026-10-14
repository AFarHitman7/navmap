import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SurveyScreen } from '../src/SurveyScreen';
import { Root } from '../src/Root';
import { staticDraft } from '../src/fixtures/map-v5';
import { memoryTokenStore } from '../src/api';
import { buildLeafletHtml } from '../src/map/leafletHtml';

jest.mock('react-native');

function textContent(root: ReactTestRenderer['root']): string {
  return root.findAll((item) => (item.type as unknown as string) === 'Text').map((item) => (item.children ?? []).join('')).join(' ');
}

test('static survey lists internal reference points and shows normalized local positions', () => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<SurveyScreen
      events={[]} lastRequestAt={0} now={100_000} throttleMessage={null} onRequestScan={() => undefined}
      httpPost={jest.fn()} tokenStore={memoryTokenStore()} onSaved={() => undefined} draft={{ ...staticDraft(), version: 2, profiles: [] }}
    />);
  });
  act(() => { renderer!.root.findByProps({ testID: 'v3-zone-b-a' }).props.onPress(); });
  act(() => { renderer!.root.findByProps({ testID: 'v3-floor-0' }).props.onPress(); });
  expect(renderer!.root.findByProps({ testID: 'v3-node-s-a0g' })).toBeTruthy();
  act(() => { renderer!.root.findByProps({ testID: 'v3-node-s-a0g' }).props.onPress(); });
  const details = renderer!.root.findByProps({ testID: 'v3-confirm' });
  expect(textContent(renderer!.root)).toContain('0.46, 0.6');
  expect(textContent(renderer!.root)).not.toContain('lat');
});

test('static root never requests GPS and offline WebView renders only CRS.Simple image content', () => {
  jest.useFakeTimers();
  const getGps = jest.fn(async () => ({ lat: 1, lon: 2, accuracy: 3, seenAt: Date.now() }));
  const draft = { ...staticDraft(), version: 2, profiles: [] };
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<Root venueId="demo" initialManifest={draft} getGps={getGps} subscribeScans={() => () => undefined}
      packAdapter={{ getJson: async () => ({}), getBytes: async () => new Uint8Array(), writeBytes: async () => undefined, readBytes: async () => new Uint8Array(), hashBytes: async () => '', writeFile: async () => undefined, readFile: async () => '', rename: async () => undefined, rmrf: async () => undefined }} />);
  });
  act(() => { renderer!.root.findByProps({ testID: 'gps-refresh' }).props.onPress(); });
  expect(getGps).not.toHaveBeenCalled();
  act(() => { renderer!.unmount(); });
  jest.useRealTimers();
  const html = buildLeafletHtml({ path: [], onlineTiles: true, staticFrame: { width: 200, height: 100, imageDataUri: 'data:image/png;base64,AA==', nodes: [] }, v3: { boundary: null, zones: [], nodes: [], activeZoneId: null, floorFilter: null } });
  expect(html).toContain('crs:L.CRS.Simple');
  expect(html.indexOf('if(d.staticFrame)')).toBeLessThan(html.indexOf('if(d.onlineTiles'));
});
