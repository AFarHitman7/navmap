import { Link, NavLink, Outlet, RouterProvider, createBrowserRouter, useParams } from 'react-router-dom';
import { Icon } from './editor/Icon';
import { OrganizerV3 } from './OrganizerV3';
import { VisitorV3 } from './VisitorV3';

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
  return <OrganizerV3 key={`v3:${venueId}`} venueId={venueId} />;
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
      { index: true, element: <OrganizerV3 key="v3:demo" venueId="demo" /> },
      { path: 'editor/:venueId', element: <VenueEditorRoute /> },
      { path: 'v/:venueId', element: <VenueVisitorRoute /> },
      { path: '*', element: <p>Unknown page. Open the V3 editor.</p> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
