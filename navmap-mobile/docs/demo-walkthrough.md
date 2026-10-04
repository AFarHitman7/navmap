# NavMap V3 field walkthrough (Android)

## 1. Setup

- Start the V3 backend and web editor on a laptop reachable on the local LAN.
- Build the Android debug app with `API_BASE_URL=http://<laptop-LAN-IP>:3000`
  and the correct `VENUE_ID`; grant location and Wi-Fi permissions.
- Create and publish a V3 venue with a geographic boundary, indoor zones,
  floors, nodes, explicit edges, and QR anchors as needed.

## 2. Survey and publish

- Register the venue's allowed AP BSSIDs in the V3 editor.
- In the app's node survey, select an outdoor/indoor zone, floor, and node.
- Collect at least three distinct scans with at least two registered APs per
  scan, then save the node survey to the V3 node-samples endpoint.
- Publish the V3 draft from the web editor.

## 3. Download and navigate

- Download the latest V3 pack. It is staged and validated before activation;
  an interrupted download leaves the previous active pack in place.
- Stop the API and verify saved map geometry, destinations, QR/manual starts,
  floor-aware routes, and Wi-Fi node matching remain usable offline. OSM map
  tiles themselves require network access.
- Verify GPS zone hints and confirm GPS does not claim a specific node/floor.
- Verify unsupported stale packs are rejected and removed when the updated app
  loads them.

## 4. Field acceptance

Record predicted node/area, confidence, fix age, and correctness at ten
preselected spots. Confirm QR/manual override and resume-auto behavior, and
test the flow on a physical Android device before release.
