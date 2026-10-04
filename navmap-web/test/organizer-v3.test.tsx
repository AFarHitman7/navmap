import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftV3 } from '../src/contract-v3';
import fixture from '../src/fixtures/unified-v3.json';
import { OrganizerV3 } from '../src/OrganizerV3';

vi.mock('../src/MapCanvasV3', () => ({
  MapCanvasV3: ({ onPointClick, onNodeClick, onZoneClick, onPathClick, onEdgeClick }: {
    onPointClick?: (point: { lat: number; lng: number }) => void;
    onNodeClick?: (id: string) => void;
    onZoneClick?: (id: string) => void;
    onPathClick?: (id: string) => void;
    onEdgeClick?: (from: string, to: string) => void;
  }) => (
    <>
    <button type="button" onClick={() => onZoneClick?.('b-a')}>Mock Building A rectangle</button>
    <button type="button" onClick={() => onZoneClick?.('b-b')}>Mock Building B rectangle</button>
    <button type="button" onClick={() => onPointClick?.({ lat: 13.05, lng: 80.245 })}>
      Mock map point inside Building A
    </button>
    <button type="button" onClick={() => onNodeClick?.('n-a0')}>Mock path start</button>
    <button type="button" onClick={() => onPointClick?.({ lat: 13.052, lng: 80.247 })}>Mock path corner</button>
    <button type="button" onClick={() => onNodeClick?.('n-a0b')}>Mock path end</button>
    <button type="button" onClick={() => onNodeClick?.('n-a1')}>Mock upper landing</button>
    <button type="button" onClick={() => onNodeClick?.('n-a1b')}>Mock unconnected upper landing</button>
    <button type="button" onClick={() => onPointClick?.({ lat: 13.056, lng: 80.2485 })}>Mock upper path corner</button>
    <button type="button" onClick={() => onPathClick?.('mock-path')}>Mock select path</button>
    <button type="button" onClick={() => onEdgeClick?.('n-out', 'n-a0')}>Mock select legacy connection</button>
    </>
  ),
}));

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return body;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

const draftUrl = '/api/admin/venues/demo/draft-v3';

function savedRequests() {
  const saved: unknown[] = [];
  mockFetch((url, init) => {
    if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
    if (url === draftUrl && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      saved.push(body);
      return jsonResponse(body);
    }
    return jsonResponse({}, 404);
  });
  return saved;
}

describe('OrganizerV3', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the sign-in form on 401', async () => {
    mockFetch(() => jsonResponse({ error: 'Unauthorized' }, 401));
    render(<OrganizerV3 />);
    expect(await screen.findByRole('heading', { name: /organizer sign in/i })).toBeVisible();
  });

  it('shows toolbar, zones, and points after loading the draft', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(fixture);
      }
      return jsonResponse({}, 404);
    });
    render(<OrganizerV3 />);
    expect(await screen.findByRole('button', { name: 'Draw boundary' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Add zone' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Add nodes' })).toBeVisible();
    expect(await screen.findByRole('button', { name: /select zone building a/i })).toBeVisible();
    expect(await screen.findByRole('button', { name: /select outdoor entrance n-out/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Draw boundary' }));
    expect(screen.getByRole('button', { name: 'Draw boundary' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('starts from a blank map when the venue has no v3 draft yet', async () => {
    mockFetch(() => jsonResponse({ error: 'no v3 draft for venue demo' }, 404));
    render(<OrganizerV3 />);
    expect((await screen.findAllByRole('button', { name: 'Draw boundary' })).length).toBeGreaterThan(0);
    expect(screen.getByText(/no zones yet/i)).toBeVisible();
  });

  it('adds indoor nodes on the explicitly selected placement floor', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.selectOptions(screen.getByLabelText('Placement floor'), '1');
    await user.click(screen.getByRole('button', { name: 'Add nodes' }));
    // The real rectangle emits a zone click before the map's delayed point click.
    await user.click(screen.getByRole('button', { name: 'Mock Building A rectangle' }));
    await user.click(screen.getByRole('button', { name: 'Mock map point inside Building A' }));

    expect(await screen.findByRole('button', { name: /select node n-1 n-1/i })).toBeVisible();
    expect(screen.getByText(/Lat 13\.05000 Lng 80\.24500 · Floor 1 · b-a/)).toBeVisible();
  });

  it('keeps placement floor independent from the visibility floor filter', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.selectOptions(screen.getByLabelText('Placement floor'), '1');
    await user.selectOptions(screen.getByLabelText('Visible floor — Building A'), '0');
    await user.click(screen.getByRole('button', { name: 'Add nodes' }));
    await user.click(screen.getByRole('button', { name: 'Mock map point inside Building A' }));

    expect(await screen.findByRole('button', { name: /select node n-1 n-1/i })).toBeVisible();
    expect(screen.getByText(/Lat 13\.05000 Lng 80\.24500 · Floor 1 · b-a/)).toBeVisible();
  });

  it('edits the selected node name, coordinates, and zone-constrained floor without changing its id', async () => {
    const user = userEvent.setup();
    const draftWithFreeNode: DraftV3 = {
      ...(fixture as DraftV3),
      nodes: [...(fixture as DraftV3).nodes, { id: 'n-free', name: 'Free point', lat: 13.051, lng: 80.246, z: 0, zoneId: 'b-a', fingerprintRevision: 1 }],
    };
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(draftWithFreeNode);
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select free point n-free/i }));

    await user.clear(screen.getByLabelText('Node display name'));
    await user.type(screen.getByLabelText('Node display name'), 'Main lobby');
    await user.clear(screen.getByLabelText('Node latitude'));
    await user.type(screen.getByLabelText('Node latitude'), '13.052');
    await user.clear(screen.getByLabelText('Node longitude'));
    await user.type(screen.getByLabelText('Node longitude'), '80.246');
    await user.selectOptions(screen.getByLabelText('Node floor'), '1');
    await user.click(screen.getByRole('button', { name: 'Update point' }));

    expect(await screen.findByRole('heading', { name: 'Main lobby' })).toBeVisible();
    expect(screen.getByText('ID: n-free')).toBeVisible();
    expect(screen.getByText(/Lat 13\.05200 Lng 80\.24600 · Floor 1 · b-a/)).toBeVisible();
    expect(screen.getByText('Fingerprint revision 2')).toBeVisible();
    expect(screen.getByRole('button', { name: /select main lobby n-free/i })).toBeVisible();
    expect(screen.getByLabelText('Node floor')).not.toHaveTextContent('Building B');
    expect(screen.getByLabelText('Node floor')).not.toHaveTextContent('Floor 2');
  });

  it('creates, edits, reassigns, and deletes a selected node place through the inspector and Places tab', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select building a ground lobby n-a0/i }));

    await user.clear(screen.getByLabelText('Place name'));
    await user.click(screen.getByRole('button', { name: 'Create place' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Place name is required');
    expect(screen.queryByDisplayValue('Lobby')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Place name'), 'Lobby');
    await user.click(screen.getByRole('button', { name: 'Create place' }));
    expect(await screen.findByText('Place created.')).toBeVisible();
    expect(screen.getByDisplayValue('Lobby')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Places' }));
    await user.click(screen.getByRole('button', { name: /edit place lobby on building a ground lobby n-a0/i }));
    expect(screen.getByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();

    await user.clear(screen.getByLabelText('Place name'));
    await user.type(screen.getByLabelText('Place name'), 'Reception');
    await user.selectOptions(screen.getByLabelText('Place node'), 'n-a0b');
    await user.click(screen.getByRole('button', { name: 'Update place' }));
    expect(await screen.findByText('Place updated.')).toBeVisible();
    expect(screen.getByRole('button', { name: /select building a ground corridor n-a0b/i })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Delete place' }));
    expect(await screen.findByText('Place deleted.')).toBeVisible();
    expect(screen.queryByDisplayValue('Reception')).not.toBeInTheDocument();
  });

  it('keeps the original place node selected when a reassignment edit fails validation', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select building a ground lobby n-a0/i }));
    await user.type(screen.getByLabelText('Place name'), 'Lobby');
    await user.click(screen.getByRole('button', { name: 'Create place' }));
    expect(await screen.findByText('Place created.')).toBeVisible();

    await user.clear(screen.getByLabelText('Place name'));
    await user.selectOptions(screen.getByLabelText('Place node'), 'n-a0b');
    await user.click(screen.getByRole('button', { name: 'Update place' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Place name is required');
    expect(screen.getByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();
    expect(screen.getByText('ID: n-a0')).toBeVisible();
    expect(screen.getByRole('button', { name: /select building a ground lobby n-a0/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Place node')).toHaveValue('n-a0');
  });

  it('draws, saves, selects, and deletes a whole path without deleting destination nodes', async () => {
    const user = userEvent.setup();
    const saved = savedRequests();

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
    await user.click(screen.getByRole('button', { name: 'Mock path end' }));
    await user.click(screen.getByRole('button', { name: 'Finish path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const withRoute = saved[0] as DraftV3;
    expect(withRoute.paths).toHaveLength(1);
    expect(withRoute.paths?.[0]?.controlNodeIds).toHaveLength(3);
    expect(withRoute.edges.filter((edge) => edge.kind === 'path').length).toBeGreaterThan(1);

    await user.click(screen.getByRole('button', { name: 'Mock select path' }));
    expect(screen.getByRole('button', { name: 'Delete path' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saved).toHaveLength(2));
    const afterDelete = saved[1] as DraftV3;
    expect(afterDelete.paths ?? []).toHaveLength(0);
    expect(afterDelete.nodes.some((node) => node.id === 'n-a0')).toBe(true);
    expect(afterDelete.nodes.some((node) => node.id === 'n-a0b')).toBe(true);
  });

  it('cancels path drawing with Cancel and Escape without changing the saved graph', async () => {
    const user = userEvent.setup();
    const saved = savedRequests();

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
    await user.click(screen.getByRole('button', { name: 'Cancel path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ nodes: fixture.nodes, edges: fixture.edges });

    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toMatchObject({ nodes: fixture.nodes, edges: fixture.edges });
  });

  it('requires explicit stairs arming and auto-syncs placement to the linked landing floor', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const draftWithFreeUpperLanding: DraftV3 = {
      ...(fixture as DraftV3),
      nodes: [...(fixture as DraftV3).nodes, { id: 'n-a1b', name: 'Building A free upper landing', lat: 13.052, lng: 80.247, z: 1, zoneId: 'b-a', fingerprintRevision: 1 }],
    };
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(draftWithFreeUpperLanding);
      if (url === draftUrl && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push(body);
        return jsonResponse(body);
      }
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    // A placement-floor switch alone adds no transition vertex.
    await user.selectOptions(screen.getByLabelText('Placement floor'), '1');
    expect(screen.getByText('Pending vertices: 1')).toBeVisible();
    // Arm from the ground floor so the link itself proves explicit arming and auto-sync.
    await user.selectOptions(screen.getByLabelText('Placement floor'), '0');
    await user.click(screen.getByRole('button', { name: 'Link next landing as stairs' }));
    await user.click(screen.getByRole('button', { name: 'Mock unconnected upper landing' }));
    expect(screen.getByLabelText('Placement floor')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Mock upper path corner' }));
    await user.click(screen.getByRole('button', { name: 'Finish path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const withStairs = saved[0] as DraftV3;
    const path = withStairs.paths?.at(-1);
    expect(path).toBeDefined();
    const routeEdges = withStairs.edges.filter((edge) => path?.nodeIds.includes(edge.from) && path.nodeIds.includes(edge.to));
    expect(routeEdges.filter((edge) => edge.kind === 'stairs')).toHaveLength(1);
  });

  it('disables Finish while a stairs link is armed and preserves the draft if clicked indirectly', async () => {
    const user = userEvent.setup();
    const saved = savedRequests();

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
    await user.click(screen.getByRole('button', { name: 'Link next landing as stairs' }));

    expect(screen.getByRole('button', { name: 'Finish path' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ nodes: fixture.nodes, edges: fixture.edges });
  });

  it('lists stairs-only routes for selection and deletion independent of map geometry', async () => {
    const user = userEvent.setup();
    const stairsOnly: DraftV3 = {
      ...(fixture as DraftV3),
      paths: [{ id: 'stairs-only', name: 'North stairs', nodeIds: ['n-a0', 'n-a1'], controlNodeIds: ['n-a0', 'n-a1'] }],
    };
    const saved: unknown[] = [];
    mockFetch((url, init) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(stairsOnly);
      if (url === draftUrl && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push(body);
        return jsonResponse(body);
      }
      return jsonResponse({}, 404);
    });

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select route north stairs/i }));
    expect(screen.getByRole('button', { name: 'Delete path' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const afterDelete = saved[0] as DraftV3;
    expect(afterDelete.paths ?? []).toHaveLength(0);
    expect(afterDelete.nodes.some((node) => node.id === 'n-a0')).toBe(true);
    expect(afterDelete.nodes.some((node) => node.id === 'n-a1')).toBe(true);
  });

  it('keeps the placement floor when zone rectangles bubble clicks while drawing', async () => {
    const user = userEvent.setup();
    const saved = savedRequests();

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: /select zone building a/i }));
    await user.selectOptions(screen.getByLabelText('Placement floor'), '1');
    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock upper landing' }));
    await user.click(screen.getByRole('button', { name: 'Mock Building B rectangle' }));
    await user.click(screen.getByRole('button', { name: 'Mock Building A rectangle' }));
    expect(screen.getByLabelText('Placement floor')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Mock path corner' }));
    await user.click(screen.getByRole('button', { name: 'Finish path' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const withRoute = saved[0] as DraftV3;
    expect(withRoute.paths).toHaveLength(1);
    const corner = withRoute.nodes.find((node) => node.lat === 13.052 && node.lng === 80.247);
    expect(corner?.z).toBe(1);
  });

  it('keeps legacy connection deletion and supports explicit connection kind selection', async () => {
    const user = userEvent.setup();
    const saved = savedRequests();

    render(<OrganizerV3 />);
    await user.click(await screen.findByRole('button', { name: 'Mock select legacy connection' }));
    expect(screen.getByRole('button', { name: 'Delete connection' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete connection' }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DraftV3).edges.some((edge) => edge.kind === 'entrance')).toBe(false);

    expect(screen.getByLabelText('Connection kind')).toBeVisible();
  });
});
