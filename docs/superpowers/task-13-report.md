# Task 13 — Compact layers and higher editor zoom

## Outcome

- Replaced the V5 editor's always-visible frame button strip with a compact current-frame row and a `Layers` disclosure. The selected building/floor remains visible while the menu is closed. The popover has a viewport-bounded, scrollable frame list, closes on Escape, returns focus to its toggle, and uses native summary/button keyboard behavior.
- Static maps still select exactly one active image frame; each frame keeps its own image-coordinate fit. Geographic V5 frame navigation remains available in the same popover. Legacy floor visibility controls are now collapsed by default and label the outdoor layer `Outdoor`.
- Raised geographic zoom limits to 24 in both `GeographicCanvas` and legacy `MapCanvasV3`. OSM layers allow overzoom to 24 while `maxNativeZoom: 19` keeps raster requests at or below z19. Existing screen-sized markers/snap tolerances are unchanged.
- Static images now fit first and set the maximum to four zoom levels above that frame's fit (16× magnification).
- V5 geographic tile failures now show a transient, non-blocking notice; node/path editing remains interactive. Frame-switch/pending-path guard behavior is covered by existing unit/E2E tests updated to the new labels.

## Interfaces and files

- `LayerPicker` keeps the legacy zone/floor visibility props and adds V5 frame props: `canvasKind`, `frames`, `activeFrameId`, `onFrameChange`, and zones for human-readable floor names.
- Implementation: `navmap-web/src/LayerPicker.tsx`, `src/OrganizerV5.tsx`, `src/styles.css`, `src/MapCanvasV3.tsx`, `src/map/GeographicCanvas.tsx`, and `src/map/StaticCanvas.tsx`.
- Tests: `test/layer-picker.test.tsx`, `test/map-canvas-v3.test.tsx`, `test/static-canvas.test.tsx`, `e2e/task13-layers-zoom.spec.ts`, and updated floor/frame selectors in Task 10/12 E2E guard tests.
- No native files changed; the mobile Leaflet renderer remains capped at native zoom 19. No visitor rewrite was attempted.

## Evidence

- Unit suite: `npm test` — **34 files, 269 tests passed**.
- Focused real-browser checks: Task 13 and floor/visitor E2E across desktop and mobile — **6 passed**. Verified the default layer row is <=56px, long frame lists scroll inside the popover, Escape/Enter work, geographic zoom reaches 24, intercepted OSM tile URLs never exceed z19, and a pending path click still works during an OSM tile failure.
- Task 10 real-canvas E2E — **4 passed** across desktop and mobile. Unified-tool E2E/Task 12 pending gesture guards — **10 passed** across desktop and mobile.
- Full web E2E: **26 passed, 10 failed**. All 10 failures are in legacy V4 venue-creation specs (`navigable-paths.spec.ts`, `unified-map.spec.ts`): their API setup receives `403 {"error":"cross-origin write rejected"}` because the request-context writes omit an `Origin` header. Confirmed against the disposable E2E server; no backend/auth changes were made because this is outside Task 13. The Task 10/12 selector failures from the first run were corrected and those suites pass independently and in the full run.
- Desktop screenshot (1280×800): `navmap-web/test-results/task13-layers-zoom-V5-laye-05913-erzoom-clamps-to-native-z19-desktop/task13-v5-layers.png`
- Mobile screenshot (390×844): `navmap-web/test-results/task13-layers-zoom-V5-laye-05913-erzoom-clamps-to-native-z19-mobile/task13-v5-layers.png`
- `npm run typecheck`, `npm run lint`, and `npm run build` completed successfully. Build reports a large-chunk advisory (not a build failure).

## Inputs and limits

- Applied the requested `frontend-design`, `ui-design`, `anti-ui-slop`, `better-typography`, `vercel-react-best-practices`, `webapp-testing`, and `verification-before-completion` guidance: extended the editor's existing visual language, kept the layer control product-specific and keyboard-native, retained its type scale, and verified the responsive UI in Chromium rather than relying on markup-only checks.
- Read the redesign spec and Task 13 plan from `docs/superpowers`. The requested `task-13-brief` and separate protocol/skills/global/rulings files were not present in `.superpowers/sdd/2026-10-14-map-authoring-redesign` (that directory contained only Task 10 screenshots); the explicit Task 13 requirements in the session were followed.
- Physical native/browser/device acceptance was not run; no native code was changed. Browser screenshots and automated viewport checks are simulated Chromium evidence.
- Tile attribution remains Leaflet/OSM-controlled; no additional zoom banner or permanent map-blocking panel was added.
