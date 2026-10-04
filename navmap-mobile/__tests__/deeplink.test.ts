import type { ManifestV3 } from '../src/contract-v3';
import { handleAnchorUrl, parseAnchorUrl } from '../src/anchor';

const manifest = {
  schemaVersion: 4, venueId: 'demo', version: 1,
  anchors: [{ id: 'a1', nodeId: 'n-a0', label: 'Entrance' }],
} as unknown as ManifestV3;

test('valid saved QR changes start once; repeat is deduped', () => {
  expect(
    handleAnchorUrl('navmap://anchor/demo/1/a1', manifest, null),
  ).toMatchObject({ nodeId: 'n-a0' });
  expect(
    handleAnchorUrl(
      'navmap://anchor/demo/1/a1',
      manifest,
      'navmap://anchor/demo/1/a1',
    ),
  ).toBeNull();
});

test('unknown anchor and other venue are rejected', () => {
  expect(parseAnchorUrl('navmap://anchor/other/1/a1', manifest)).toBeNull();
  expect(parseAnchorUrl('navmap://anchor/demo/1/nope', manifest)).toBeNull();
  expect(handleAnchorUrl('navmap://anchor/demo/9/a1', manifest, null)).toBeNull();
  expect(handleAnchorUrl('https://example.com/v/demo/a/a1', manifest, null)).toBeNull();
});
