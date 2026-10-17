# Map authoring, canvas types, and visitor abstraction

## Scope and status

This design records the two user requests and the proposed direction discussed in chat. The user requested a comprehensive implementation plan. This document and its companion plan do not authorize implementation or claim that implementation has started.

## Requirements

1. The right inspector displays only the active tool's parameters or selected object's properties, not all Build sections at once.
2. Generated path points are internal routing/survey references. Default node lists contain main authored nodes; paths appear as named objects.
3. Paths render as continuous lines without sampling markers. Collinear sampling points do not create visible handles. Intentional bends, intersections, and floor transitions remain geometrically correct.
4. Every document-editing tool supports Ctrl+Z/Cmd+Z; redo and visible history buttons are included. Pending drawing clicks are reversible. Native input undo remains native.
5. Layer/floor controls occupy a compact default row rather than a large expanded panel.
6. Replace the separate Connect tool with unified path/transition workflows only after preserving its existing-node, entrance, stair, and elevator capabilities.
7. Node subcategories: Regular (indoor), Entrance (indoor/outdoor), Stair (floor X/floor Y). Path subcategories: Regular and Stair. Existing outdoor nodes and elevators remain supported, without adding unrelated new toolbar categories.
8. Provide named persistent maps, a map picker, New map, Rename, Save, and guarded map switching. Save draft and Publish remain distinct.
9. Visitor maps show destinations/main nodes and current location, not the underlying paths or generated points. Routing still uses the complete graph. Default active-route lines are hidden too.
10. Offer Geographic/OSM or Static layout when creating a map. Static layouts accept PNG or PDF, support floor backgrounds and manual node placement, and do not use GPS.
11. Geographic mode supports optional device geolocation, displays accuracy, and never infers indoor rooms/floors from GPS alone. Web Wi-Fi positioning is not promised; native survey/positioning remains available.
12. Increase geographic editor zoom from 20 to 24, keeping native OSM raster tile zoom at 19. Overzoom magnifies tiles rather than adding map detail.

## Decisions and assumptions

- One canvas type per map for this release. No in-place Geographic/Static conversion of populated maps and no hybrid georeferenced image overlays.
- Static backgrounds are assigned to a coordinate frame representing a building/floor or outdoors. Frames may have different image dimensions and scales. Local coordinates are normalized x/y in [0,1], measured from the top-left; each node also identifies its frame.
- Existing V4 drafts/manifests remain readable. New saves/publications use schemaVersion 5 with explicit coordinate/frame information. V4 immutable manifests are never rewritten. Web, backend, and mobile readers must be deployed together before V5 authoring is enabled.
- Entrance and stair objects are logical groups of graph nodes and edges, not nodes with two zone/floor memberships. Native survey references retain stable node IDs and fingerprint revisions.
- Regular node creation defaults to indoors. Legacy outdoor authored nodes remain browsable/editable; new outdoor endpoints can be created by outdoor paths or entrance workflows.
- A node's destination visibility is explicit in V5. Existing places and non-generated authored V4 nodes are migrated as visible main nodes; generated points remain hidden unless a place explicitly references one.
- PDF pages are rasterized in the organizer's browser; only validated PNG derivatives are uploaded and published. Visitors do not execute PDFs. The source PDF is not retained in the initial release.
- Upload limits: source PNG/PDF <=20 MiB; PDF <=20 pages; derivative <=4096 pixels on either axis and <=16,000,000 pixels. PNG validation happens server-side as well as in the browser. PDF conversion is cancelable with a 30-second budget per page.
- Scale calibration is optional. Routing uses a positive dimensionless cost independent of optional metres. Uncalibrated maps display instructions, not invented metre totals. Cross-frame entrance/stair distances require explicit metres if physical totals are desired.
- Saving keeps editor history; switching/reloading maps resets session history. History is bounded to 100 completed document edits. Map creation/rename, upload transport, and publication are management/server operations, not undoable canvas edits; assigning/replacing a background in the draft is undoable.
- Static maps can display node-based QR/Wi-Fi/manual positions. Manual and QR positions must be labelled; unknown/stale location must not appear as a live precise dot.
- No map deletion, duplication, collaborative editing, OSM offline tile downloads, or automatic GPS snapping into an indoor routing graph in this release.

## Architecture

Keep a detailed node/edge graph and introduce frame-aware geometry plus a presentation projection. Share pure editing operations across both canvases. Geographic Leaflet uses its normal CRS; Static Leaflet uses CRS.Simple and immutable PNG image overlays. Tool state and selection drive small contextual inspectors. A transaction history owns all document mutations, while incomplete gestures have their own local undo state.

Named map identity remains the existing venue ID. SQLite venue names and drafts are reused. Background assets are venue-scoped and content-addressed. Draft asset access requires authentication; published asset access requires a reference from the requested immutable manifest.

## Safety and compatibility

- Stable node IDs, anchors, surveyed samples, and current-revision publication rules must survive migration and abstraction.
- Moving/resampling a surveyed node invalidates its fingerprint revision. Undo cannot make remotely stale samples current again after a saved geometry change; revisions are monotonic session/server tokens, not ordinary reversible geometry fields.
- Paths must not cut corners, join different frames as a flat segment, or remove shared graph junctions during deletion.
- Cookie-authenticated uploads receive the same origin checks as JSON writes. Asset URLs/IDs are generated by the server; filenames and paths from clients are never used as filesystem paths.
- Publication stages files before making a version visible. A missing/corrupt asset cannot produce a usable published manifest or replace the latest pointer.
- Existing strict parsers require a coordinated update. Unsupported future versions fail explicitly; loading an old offline pack does not trigger broad deletion of existing packs.

## Success criteria

All twelve requirements have automated coverage in the companion plan. Final acceptance includes legacy and new maps, both canvases, cross-floor/indoor-outdoor transitions, undo after save, two-map isolation, desktop/mobile viewports, offline static assets on Android, and positioning permission/staleness states. Physical Wi-Fi and GPS accuracy require real-device verification, separately from simulated tests.
