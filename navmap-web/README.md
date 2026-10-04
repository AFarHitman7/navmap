# NavMap V3 web editor

The local web app has a unified geographic V3 editor and a public visitor map.
Open `/` for the demo editor or `/editor/:venueId` for another venue. The Visitor
tab opens `/v/:venueId`, showing the latest published map without organizer
sign-in, with starting-point/destination routing and floor-by-floor directions.
There is no legacy editor or maps list.

## Setup

```sh
cp .env.example .env
npm ci
npm run dev -- --host 0.0.0.0
```

The Vite `/api` proxy defaults to `http://127.0.0.1:3000`. Configure
`VITE_API_PROXY_TARGET` and `VITE_PUBLIC_WEB_ORIGIN` in `.env` as needed.
Organizer sign-in uses the backend's `ADMIN_PASSWORD`.

## V3 editor

Create one geographic outdoor boundary, indoor zones and floors, place nodes,
connect them with explicit path/entrance/stairs/elevator edges, and save or
publish the V3 draft. Positions are WGS84 latitude/longitude; integer `z`
represents floor. The editor requires no uploaded raster images.

Use Layers above the map to choose a visible floor for each zone, show all floors,
hide a zone, or hide outdoor paths. Zones initially show ground (or their first
available floor). Hidden floors and their edges are not drawn. These controls
never change the placement zone/floor used for new nodes. The visitor map has
the same layer controls; publish the draft before opening it there.

## Navigable-path drawing

The editor's "Draw path" pen collects pending vertices without touching the
saved graph until `Finish path` (needs at least two vertices). `Cancel path`
(or Escape) discards the pending vertices and leaves the draft unchanged.
Reference points are sampled along each ordinary stretch so gaps stay within
`PATH_POINT_SPACING_METERS` (3, a code constant in
`src/editor-v3/path-geometry.ts`, not a user setting); endpoints, corners,
and junctions are always preserved even when closer than that spacing.

- Clicking the map adds floor-local corners; clicking an existing node reuses
  it as a landing. Crossing an existing same-floor edge (drawn or legacy)
  creates one shared junction node without moving existing points; crossings
  on different floors or zones, and positive-length overlaps, never connect.
- Staircases need an explicit `Link next landing as stairs` step: pick a
  landing, arm the link, then pick a landing in the same building on another
  floor. A floor change alone never creates a transition. After linking,
  placement syncs to the landing floor so drawing continues there.
- Clicking a drawn edge or route selects it (`<name> · N route points`);
  `Delete path` removes that whole route, its exclusive edges, and generated
  points nothing else references. Manually placed nodes, places, and QR
  anchors always survive; generated IDs are never reused. Legacy (ungrouped)
  edges stay selectable separately: `Delete connection` removes only that
  edge, while deleting a grouped connection deletes its whole route so no
  path sequence points at a removed edge.
- Legacy connected nodes are intentionally locked against coordinate, zone, or
  floor moves from drag, form, and floor controls. Disconnect/delete the legacy
  edge first, then move and reconnect, so unpublished topology cannot drift.

## Checks

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```
