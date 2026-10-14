import { Link, NavLink, Outlet, RouterProvider, createBrowserRouter, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from './editor/Icon';
import { OrganizerV3 } from './OrganizerV3';
import { OrganizerV5 } from './OrganizerV5';
import { VisitorV3 } from './VisitorV3';
import { getDraftV5 } from './api-v3';

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
    void getDraftV5(venueId).then(() => {
      // The V5 editor performs its own capability check and remains read-only
      // when writes are disabled; the route never feeds V5 data to V4.
      if (live) setRoute('v5');
    }, () => {
      // A V4 draft is not accepted by the V5 parser and stays on the live V4 editor.
      if (live) setRoute('legacy');
    });
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
