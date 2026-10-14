// V5 compatibility fixtures: explicit geographic and static map drafts.
//
// Geographic fixture: two floor frames plus an outdoor frame. Static fixture:
// two 1000x1000 PNG floor frames plus an empty optional outdoor frame.
// Static edge costs follow the static convention (source-pixel distance
// divided by the frame's maximum dimension); geographic costs keep legacy
// metre weights.
import type { MapDraft } from '../map-contract.js';

export function geographicDraft(): MapDraft {
  return {
    schemaVersion: 5,
    venueId: 'demo-v5-geo',
    canvas: { kind: 'geographic' },
    boundary: { kind: 'geographic', north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
    indoorZones: [
      {
        id: 'b-a',
        name: 'Building A',
        bounds: { kind: 'geographic', north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
        floors: [
          { z: 0, label: 'Ground' },
          { z: 1, label: 'Level 1' },
        ],
      },
    ],
    frames: [
      {
        id: 'frame-outdoor-z0',
        zoneId: null,
        z: 0,
        bounds: { kind: 'geographic', north: 13.1, south: 13.0, east: 80.3, west: 80.2 },
      },
      {
        id: 'frame-b-a-z0',
        zoneId: 'b-a',
        z: 0,
        bounds: { kind: 'geographic', north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      },
      {
        id: 'frame-b-a-z1',
        zoneId: 'b-a',
        z: 1,
        bounds: { kind: 'geographic', north: 13.08, south: 13.02, east: 80.28, west: 80.22 },
      },
    ],
    nodes: [
      {
        id: 'n-out',
        name: 'Outdoor entrance',
        frameId: 'frame-outdoor-z0',
        position: { kind: 'geographic', lat: 13.05, lng: 80.25 },
        zoneId: null,
        z: 0,
        fingerprintRevision: 1,
        visitorVisible: true,
      },
      {
        id: 'n-a0',
        name: 'Ground lobby',
        frameId: 'frame-b-a-z0',
        position: { kind: 'geographic', lat: 13.05, lng: 80.245 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 2,
        visitorVisible: true,
      },
      {
        id: 'n-a0b',
        name: 'Ground corridor',
        frameId: 'frame-b-a-z0',
        position: { kind: 'geographic', lat: 13.055, lng: 80.248 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 1,
        visitorVisible: true,
      },
      {
        id: 'n-a0g',
        name: 'Survey point',
        frameId: 'frame-b-a-z0',
        position: { kind: 'geographic', lat: 13.052, lng: 80.246 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 1,
        generated: true,
        visitorVisible: false,
      },
      {
        id: 'n-a1',
        name: 'Level 1 landing',
        frameId: 'frame-b-a-z1',
        position: { kind: 'geographic', lat: 13.05, lng: 80.245 },
        zoneId: 'b-a',
        z: 1,
        fingerprintRevision: 3,
        visitorVisible: true,
      },
    ],
    edges: [
      { from: 'n-out', to: 'n-a0', kind: 'entrance', cost: 12, meters: 12 },
      { from: 'n-a0', to: 'n-a0b', kind: 'path', cost: 18, meters: 18 },
      { from: 'n-a0b', to: 'n-a0g', kind: 'path', cost: 5, meters: 5 },
      { from: 'n-a0', to: 'n-a1', kind: 'stairs', cost: 4, meters: 4 },
    ],
    paths: [{ id: 'route-1', name: 'Ground corridor', kind: 'regular', nodeIds: ['n-a0', 'n-a0b', 'n-a0g'] }],
    transitions: [
      { id: 'tr-n-out-n-a0', name: 'entrance n-out ↔ n-a0', kind: 'entrance', nodeIds: ['n-out', 'n-a0'] },
      { id: 'tr-n-a0-n-a1', name: 'stairs n-a0 ↔ n-a1', kind: 'stair', nodeIds: ['n-a0', 'n-a1'] },
    ],
    places: [{ id: 'p-lobby', name: 'Lobby', zoneId: 'b-a', nodeId: 'n-a0' }],
    anchors: [{ id: 'a-1', nodeId: 'n-a0', label: 'lobby-qr' }],
    aps: [],
  };
}

export function staticDraft(): MapDraft {
  const unit = { kind: 'local', left: 0, top: 0, right: 1, bottom: 1 } as const;
  return {
    schemaVersion: 5,
    venueId: 'demo-v5-static',
    canvas: { kind: 'static' },
    boundary: { ...unit },
    indoorZones: [
      {
        id: 'b-a',
        name: 'Building A',
        bounds: { ...unit },
        floors: [
          { z: 0, label: 'Ground' },
          { z: 1, label: 'Level 1' },
        ],
      },
    ],
    frames: [
      {
        id: 'frame-b-a-z0',
        zoneId: 'b-a',
        z: 0,
        bounds: { ...unit },
        background: {
          assetId: 'bg-b-a-z0',
          width: 1000,
          height: 1000,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          byteLength: 248112,
        },
      },
      {
        id: 'frame-b-a-z1',
        zoneId: 'b-a',
        z: 1,
        bounds: { ...unit },
        background: {
          assetId: 'bg-b-a-z1',
          width: 1000,
          height: 1000,
          sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
          byteLength: 251007,
        },
      },
      { id: 'frame-outdoor-z0', zoneId: null, z: 0, bounds: { ...unit } },
    ],
    nodes: [
      {
        id: 's-a0',
        name: 'Ground lobby',
        frameId: 'frame-b-a-z0',
        position: { kind: 'local', x: 0.2, y: 0.3 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 1,
        visitorVisible: true,
      },
      {
        id: 's-a0b',
        name: 'Ground corridor',
        frameId: 'frame-b-a-z0',
        position: { kind: 'local', x: 0.5, y: 0.7 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 1,
        visitorVisible: true,
      },
      {
        id: 's-a0g',
        name: 'Survey point',
        frameId: 'frame-b-a-z0',
        position: { kind: 'local', x: 0.46, y: 0.6 },
        zoneId: 'b-a',
        z: 0,
        fingerprintRevision: 1,
        generated: true,
        visitorVisible: false,
      },
      {
        id: 's-a1',
        name: 'Level 1 landing',
        frameId: 'frame-b-a-z1',
        position: { kind: 'local', x: 0.2, y: 0.3 },
        zoneId: 'b-a',
        z: 1,
        fingerprintRevision: 2,
        visitorVisible: true,
      },
      {
        id: 's-a1b',
        name: 'Level 1 corridor',
        frameId: 'frame-b-a-z1',
        position: { kind: 'local', x: 0.6, y: 0.6 },
        zoneId: 'b-a',
        z: 1,
        fingerprintRevision: 1,
        visitorVisible: true,
      },
    ],
    edges: [
      { from: 's-a0', to: 's-a0b', kind: 'path', cost: 0.5 },
      { from: 's-a0b', to: 's-a0g', kind: 'path', cost: 0.1 },
      { from: 's-a1', to: 's-a1b', kind: 'path', cost: 0.5 },
      { from: 's-a0', to: 's-a1', kind: 'stairs', cost: 4 },
    ],
    paths: [
      { id: 'corr-ground', name: 'Ground corridor', kind: 'regular', nodeIds: ['s-a0', 's-a0b', 's-a0g'] },
      { id: 'corr-upper', name: 'Upper corridor', kind: 'regular', nodeIds: ['s-a1', 's-a1b'] },
    ],
    transitions: [{ id: 'tr-s-a0-s-a1', name: 'stairs s-a0 ↔ s-a1', kind: 'stair', nodeIds: ['s-a0', 's-a1'] }],
    places: [{ id: 'p-lobby', name: 'Lobby', zoneId: 'b-a', nodeId: 's-a0' }],
    anchors: [{ id: 'a-1', nodeId: 's-a0', label: 'lobby-qr' }],
    aps: [],
  };
}
