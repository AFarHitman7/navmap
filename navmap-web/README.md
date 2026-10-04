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

## Checks

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run lint
npm run build
```
