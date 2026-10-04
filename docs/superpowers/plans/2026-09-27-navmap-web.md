# NavMap Web Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one organizer draw and publish the demo venue on desktop, and let connected visitors search and route through its outdoor area and indoor rooms.

**Architecture:** A Vite React client uses the backend's draft and published v1 JSON directly. Leaflet displays live OSM outdoors with a georeferenced author image, and a local image coordinate system indoors; small pure TS helpers manipulate normalized graph coordinates and run shortest-path search.

**Tech Stack:** TypeScript, React, Vite, Leaflet, plain CSS, Vitest, React Testing Library and Playwright for one user-flow smoke test; npm.

**Spec:** `../specs/2026-09-27-navmap-prototype-design.md`; companion contract/setup: `../../navmap-prototype-implementation-plan.md` (paths refer to the parent planning directory).

## Global Constraints

- Separate `navmap-web` Git repo; paths below are relative to that future repo.
- Web owns the geometry editor and an online-only visitor; no web Wi-Fi scan and no offline PWA.
- Exactly one outdoor and one indoor zone. One author image each, outdoor bounds entry, indoor width entry, connected path graph.
- OSM standard tiles are interactive online only: attribution visible, no tile export/prefetch.
- Visitor features: search, route, GPS outdoors when accuracy permits, QR anchor URL, manual start; no visitor login.
- Accessible keyboard operation and explicit loading/empty/error/recovery states; no paid/closed-source dependency.

---

## File map

- `src/api.ts`: typed HTTP calls; `src/contract.ts`: manifest/draft runtime validation; `src/fixtures/demo-v1.json`: copied backend fixture.
- `src/graph.ts`: graph edit operations; `src/route.ts`: shortest path over versioned edges.
- `src/MapCanvas.tsx`: Leaflet mount and zone/image/OSM/path rendering; `src/Organizer.tsx`: draft editor, upload and publish checks; `src/Visitor.tsx`: visitor search/start/destination/route.
- `src/main.tsx`, `src/App.tsx`, `src/styles.css`: shell and navigation.
- `test/graph.test.ts`, `test/route.test.ts`, `test/contract.test.ts`, `test/organizer.test.tsx`, `e2e/venue.spec.ts`: behavioral checks.

### Task 1: Boot, contract validation, and editable organizer geometry

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/api.ts`, `src/contract.ts`, `src/graph.ts`, `src/MapCanvas.tsx`, `src/Organizer.tsx`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/fixtures/demo-v1.json`, `test/contract.test.ts`, `test/graph.test.ts`, `README.md`.

**Interfaces:** `parseManifest(raw: unknown): Manifest`; `connectNodes(draft: Draft, from: string, to: string, meters: number): Draft`; `saveDraft(draft: Draft): Promise<Draft>`; `MapCanvas` receives `{zones,nodes,edges,places,selectedZoneId,onPointClick}`.

- [ ] **Step 1: Scaffold Vite React/TS and write failing pure tests before map UI.** `npm create vite@latest . -- --template react-ts`; install `leaflet`, `zod`; dev-install `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@types/leaflet`, `jsdom`. Add `test: vitest run`, `typecheck: tsc --noEmit`, `build: vite build`. Copy the backend `fixtures/demo-v1.json`. Configure Vite `/api` proxy using `VITE_API_PROXY_TARGET` (default localhost:3000); `.env.example` also exposes `VITE_PUBLIC_WEB_ORIGIN`, `VITE_HTTPS_CERT`, `VITE_HTTPS_KEY` for a phone-reachable trusted HTTPS demo.

```ts
expect(parseManifest(demoFixture).schemaVersion).toBe(1);
expect(() => parseManifest({...demoFixture, schemaVersion:2})).toThrow(/schemaVersion/);
expect(connectNodes(draft,'out-entrance','in-entrance',8).edges).toContainEqual({from:'out-entrance',to:'in-entrance',meters:8});
```

- [ ] **Step 2: Run `npm test -- test/contract.test.ts test/graph.test.ts`.** Expected: FAIL because parser and graph editor functions are absent.
- [ ] **Step 3: Implement parser and a minimal editor.** Match `Manifest`/`Draft` in the companion contract; reject unsupported schema and unknown graph references. The editor has a large map canvas and a compact inspector: upload outdoor/indoor image, enter bounds/width, add named place, click to add node, click two nodes to add an edge and enter metres, move/delete node or place, mark entrance pair, choose AP BSSIDs from Android survey or enter them. Keep local draft in `useReducer`; Save sends `PUT /api/admin/draft`. Login form calls `/api/admin/login` and relies on the HttpOnly cookie. Leaflet renders outdoor OSM tiles + authored image in geographic bounds; indoor uses the image in a separate `L.CRS.Simple` map view. Use normalized x/y inside saved data, never Leaflet pixel coordinates.

```ts
export function connectNodes(draft: Draft, from: string, to: string, meters: number): Draft {
  if (!draft.nodes.some(n => n.id === from) || !draft.nodes.some(n => n.id === to) || meters <= 0) throw new Error('Choose two existing nodes and a positive distance');
  return {...draft, edges:[...draft.edges, {from,to,meters}]};
}
```

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build`.** Expected: all exit 0. Manually add an outdoor and indoor place and see the new edge in the inspector without editing JSON.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: create organizer map and path editor"`.

### Task 2: Connected visitor search, shortest route, and start fallbacks

**Files:** Create `src/route.ts`, `src/Visitor.tsx`, `test/route.test.ts`, `test/visitor.test.tsx`; modify `src/MapCanvas.tsx`, `src/App.tsx`, `src/styles.css`.

**Interfaces:** `shortestPath(manifest: Manifest, startNodeId: string, goalNodeId: string): string[] | null`; `GET /api/venues/demo/latest` followed by version manifest; `/v/demo/a/:anchorId` initializes visitor start; `Visitor` receives a published manifest, not an editable draft.

- [ ] **Step 1: Write a failing route test.** The fixture must contain an outdoor node, entrance edge and an indoor room; shortest route uses total metres and returns `null` if disconnected.

```ts
expect(shortestPath(demoFixture,'out-gate','room-a')).toEqual(['out-gate','out-entrance','in-entrance','room-a']);
expect(shortestPath({...demoFixture,edges:[]},'out-gate','room-a')).toBeNull();
```

- [ ] **Step 2: Run `npm test -- test/route.test.ts`.** Expected: FAIL because `shortestPath` does not exist.
- [ ] **Step 3: Implement Dijkstra on the undirected small graph.** Use edge `meters` as the only cost; build adjacency once when manifest changes. Load latest then versioned manifest, validate before display, search published places case-insensitively, choose destination and manually select a start. If `navigator.geolocation` succeeds with `accuracy <= 30` metres and the coordinates fall within outdoor bounds, transform lon/lat into `[0,1]` and start from nearest outdoor node; otherwise show QR/manual choices. A QR web URL `/v/demo/a/:anchorId` starts at the known anchor node. Render the route as a polyline on each zone; indicate the entrance transition in a step list, with a zone switch control. Show invalid anchor/unsupported manifest/network failure explicitly.

```ts
const x = (longitude - bounds.west) / (bounds.east - bounds.west);
const y = (bounds.north - latitude) / (bounds.north - bounds.south);
// Only use this outdoor point if 0 <= x,y <= 1 and reported GPS accuracy <= 30 m.
```

- [ ] **Step 4: Run `npm test -- test/route.test.ts test/visitor.test.tsx`, `npm run typecheck`, `npm run build`.** Expected: all exit 0; test a missing anchor and denied GPS to see the manual-start control.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: let web visitors search and route"`.

### Task 3: Organizer publish flow, QR cards, and interface finish

**Files:** Create `test/organizer.test.tsx`, `e2e/venue.spec.ts`; modify `src/Organizer.tsx`, `src/App.tsx`, `src/styles.css`, `README.md`, `package.json`.

**Interfaces:** `POST /api/admin/publish` returns the immutable `Manifest`; QR pair uses `navmap://anchor/demo/:version/:anchorId` and `https://<LAN-host>/v/demo/a/:anchorId` for each anchor.

- [ ] **Step 1: Write failing publish UI test.** A rejected disconnected draft displays the server message next to Publish; a successful publish shows version number and both QR payloads for each anchor.

```tsx
await user.click(screen.getByRole('button',{name:'Publish'}));
expect(await screen.findByText(/disconnected from the entrance/)).toBeVisible();
// In the success case, expect visible 'Published version 1' and both QR URL labels.
```

- [ ] **Step 2: Run `npm test -- test/organizer.test.tsx`.** Expected: FAIL because publish feedback and QR card are missing.
- [ ] **Step 3: Add Publish and printable anchor cards.** Install open-source `qrcode` plus type definitions. On success, render version, download link and two distinct QR images with their readable payload and a short printed anchor code. Use the configured trusted LAN origin for web codes; label Android and browser QR distinctly. Keep a utilitarian editor: map first, place/path inspector second, publish errors inline; controls have explicit labels, focus indicators, 44 px touch targets, body text >=16 px on small viewports, and sufficient contrast. Cover loading, empty, offline/network error, selected node, invalid form and success states; no decorative dashboard panels or animation framework.

```ts
const androidPayload = `navmap://anchor/demo/${manifest.version}/${anchor.id}`;
const browserPayload = `${import.meta.env.VITE_PUBLIC_WEB_ORIGIN}/v/demo/a/${anchor.id}`;
```

- [ ] **Step 4: Run `npm test`, `npm run typecheck`, `npm run build` and a Playwright flow against a live local API.** Expected: build/tests exit 0; at 390 px and 1280 px widths, login → save → publish → visitor route has no clipped controls; photograph/screenshot the two layouts and check labels, state text, map attribution and keyboard focus. The E2E fixture is seeded via backend API, not by mocking an ideal screenshot. Verify printed browser QR resolves from a different device; refuse to print a `localhost` URL. On a phone, test geolocation only under trusted HTTPS.
- [ ] **Step 5: Commit** `git add . && git commit -m "feat: publish venue and print anchor QR cards"`.
