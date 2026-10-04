# Navigable paths

## Approved behavior

Paths are editable, deletable routes made of straight segments, with Wi-Fi reference points along their length. Drawing behaves like a straight-segment pen tool: click an existing point to start, click the map to add corners, and finish at an existing point or a new endpoint. Provide explicit Finish and Cancel actions. Cancel leaves the saved graph untouched.

Reference-point spacing defaults to 3 metres through a named code constant, not a user-facing setting. Preserve endpoints, corners, and junctions even when they are closer than that spacing; subdivide each remaining segment so gaps do not exceed the constant.

Staircase routes contain segments on individual floors and explicit stairs connections between landings. Each point has an integer floor and a zone. Do not interpolate fractional floors or automatically connect overlapping geometry on different floors. Existing entrance and elevator connections retain their meanings.

## Architecture

Reuse the existing node/edge routing and node fingerprint system. Persist a drawn path's identity and ordered point sequence so its generated segments can be selected and deleted as one route. Distinguish generated path points from manually placed destination nodes. Extend the contracts consistently in backend, web, and mobile, accepting existing maps without path metadata.

An alternative is a separate positioning graph assembled only at publication, but that would duplicate node lifecycle and survey logic. Another alternative is ungrouped edges, but that cannot reliably support whole-path deletion. Persistent path grouping over the existing graph is preferred.

Keep graph generation and intersection geometry outside the organizer component, as focused testable functions. The backend validates the resulting topology before publication; published maps contain the same navigable nodes and edges consumed by mobile and web visitors.

## Intersections and lifecycle

At geometric crossings of ordinary path segments in the same zone and floor, insert a shared junction and split both paths' graph edges. Handle endpoint-on-segment joins as well. Reuse coincident points rather than create zero-length edges. Reject ambiguous overlapping segments with a clear error instead of silently creating duplicate topology. Stairs, entrances, and elevators do not acquire automatic geometric intersections.

Deleting a path removes its grouping and edges that no remaining route needs. Remove generated points only when they are no longer referenced by another path, connection, destination, or anchor. Never delete manually placed nodes as a side effect. Shared junctions must remain usable by surviving routes. Legacy ungrouped connections must remain individually selectable and deletable.

Changing geometry must not associate old Wi-Fi measurements with a new location. Preserve unchanged point identities and revisions where feasible, increment revisions for relocated points, and give new points new identities. Deleting and recreating generated points must not recycle identities with old survey samples.

## Survey and navigation

Expose generated reference points in the mobile survey flow with their path, order, zone, and floor so an organizer can physically visit and scan each point. Reuse the current fresh-scan, allowlisted-AP, minimum-scan, and revision checks. Do not invent or interpolate Wi-Fi fingerprints from drawing geometry.

Published reference-point profiles participate in the existing Wi-Fi matcher. Routes can start from a matched path point, follow bends, turn at shared junctions, and cross floors through explicit staircase links. Unsurveyed reference points still provide routing topology, but cannot provide fingerprint-based positioning.

## Editor interaction

Keep the existing organizer layout and map conventions. Add path drawing, an in-progress preview, finish/cancel controls, and selected-path details with a Delete action. Support floor switching while constructing an explicit stair route by linking the selected landing on one floor to a landing on another floor in the same building. Clearly indicate staircase transitions rather than render them as ordinary same-floor paths.

Reject invalid points, nonpositive connections, zone/floor mismatches, and incomplete stair links without partially changing the draft. Preserve existing save, publish, and unsaved-change behavior.

## Verification

Cover spacing, preserved corners, cancellation, whole-path deletion, shared-point retention, same-floor intersections, endpoint joins, different-floor isolation, explicit staircase traversal, stable survey revisions, legacy-map parsing, publication, and positioning/routing from a surveyed path point. Run backend, web, and mobile tests and type checks, plus editor interaction tests where available.
