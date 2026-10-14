import { Link, NavLink, Outlet, RouterProvider, createBrowserRouter, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from './editor/Icon';
import { OrganizerV3 } from './OrganizerV3';
import { OrganizerV5 } from './OrganizerV5';
import { VisitorV3 } from './VisitorV3';
import { getCapabilities, getDraftVersion } from './api-v3';
import { MapPicker } from './maps/MapPicker';

function Layout() {
  const { venueId = 'demo' } = useParams();
  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" to="/" aria-label="NavMap home">
          <span className="brand-mark">
            <Icon name="map" />
          </span>
          <span>
            navmap<span className="brand-dot">.</span>
          </span>
        </Link>
        <nav aria-label="App navigation">
          <NavLink to={venueId === 'demo' ? '/' : `/editor/${encodeURIComponent(venueId)}`} end>Editor</NavLink>
          <NavLink to={`/v/${encodeURIComponent(venueId)}`}>Visitor</NavLink>
        </nav>
        <MapPicker currentId={venueId} />
        <span className="header-caption">VENUE WAYFINDING</span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function VenueEditorRoute() {
  const { venueId = 'demo' } = useParams();
  const [route, setRoute] = useState<'loading' | 'legacy' | 'v5'>('loading');
  useEffect(() => {
    let live = true;
    void Promise.all([getDraftVersion(venueId), getCapabilities().catch(() => ({ mapV5AuthoringEnabled: false }))]).then(([version, capabilities]) => {
      if (live) setRoute(version === 5 || capabilities.mapV5AuthoringEnabled ? 'v5' : 'legacy');
    }, () => { if (live) setRoute('legacy'); });
    return () => { live = false; };
  }, [venueId]);
  if (route === 'loading') return <section className="page-state" role="status"><h1>Opening map</h1><span className="loading-dot" /></section>;
  return route === 'v5'
    ? <OrganizerV5 key={`v5:${venueId}`} venueId={venueId} />
    : <OrganizerV3 key={`v3:${venueId}`} venueId={venueId} />;
}

function VenueVisitorRoute() {
  const { venueId = 'demo' } = useParams();
  return <VisitorV3 key={`visitor:${venueId}`} venueId={venueId} />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <VenueEditorRoute /> },
      { path: 'editor/:venueId', element: <VenueEditorRoute /> },
      { path: 'v/:venueId', element: <VenueVisitorRoute /> },
      { path: '*', element: <p>Unknown page. Open the V3 editor.</p> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
