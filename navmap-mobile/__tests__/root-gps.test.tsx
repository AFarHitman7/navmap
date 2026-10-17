import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Root } from '../src/Root';
import { VisitorScreen } from '../src/VisitorScreen';
import { geographicDraft } from '../src/fixtures/map-v5';

jest.mock('react-native');

const adapter = {
  getJson: async () => ({}),
  getBytes: async () => new Uint8Array(),
  writeBytes: async () => undefined,
  readBytes: async () => new Uint8Array(),
  hashBytes: async () => '',
  writeFile: async () => undefined,
  readFile: async () => '',
  rename: async () => undefined,
  rmrf: async () => undefined,
};

test('geographic root only requests GPS on explicit refresh and forwards raw evidence', async () => {
  jest.useFakeTimers();
  const getGps = jest.fn(async () => ({ lat: 13.05, lon: 80.25, accuracy: 8, seenAt: Date.now() }));
  const draft = { ...geographicDraft(), version: 2, profiles: [] };
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Root venueId="demo-v5-geo" initialManifest={draft} getGps={getGps}
      subscribeScans={() => () => undefined} packAdapter={adapter} />);
  });
  // No background GPS request on mount: opt-in only.
  expect(getGps).not.toHaveBeenCalled();
  await act(async () => {
    renderer!.root.findByProps({ testID: 'gps-refresh' }).props.onPress();
  });
  expect(getGps).toHaveBeenCalledTimes(1);
  const visitor = renderer!.root.findByType(VisitorScreen);
  expect(visitor.props.gpsFix).toMatchObject({ lat: 13.05, lon: 80.25, accuracy: 8 });
  await act(async () => { renderer!.unmount(); });
  jest.useRealTimers();
});
