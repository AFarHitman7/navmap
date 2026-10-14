// Task 3 RED: useEditorDocument hook plus live OrganizerV3 undo/redo wiring.
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../src/fixtures/unified-v3.json';
import { OrganizerV3 } from '../src/OrganizerV3';
import { UnsavedChangesDialog } from '../src/editor/UnsavedChangesDialog';
import { useEditorDocument } from '../src/editor-v3/useEditorDocument';
import type { DraftV3 } from '../src/contract-v3';

vi.mock('../src/MapCanvasV3', () => ({
  MapCanvasV3: ({ onPointClick, onNodeClick }: {
    onPointClick?: (point: { lat: number; lng: number }) => void;
    onNodeClick?: (id: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onPointClick?.({ lat: 13.05, lng: 80.245 })}>
        Mock map point inside Building A
      </button>
      <button type="button" onClick={() => onNodeClick?.('n-a0')}>Mock path start</button>
      <button type="button" onClick={() => onNodeClick?.('n-a0b')}>Mock path end</button>
    </>
  ),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

const draftUrl = '/api/admin/venues/demo/draft-v3';

function mockGetDraft() {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
    return jsonResponse({}, 404);
  });
}

describe('useEditorDocument', () => {
  it('commits edits, undoes, redoes, and tracks dirty against the last save', () => {
    const first = structuredClone(fixture) as DraftV3;
    const { result } = renderHook(() => useEditorDocument(first));
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);

    let committed = false;
    act(() => {
      committed = result.current.commit('Rename node', (prev) => ({
        ...prev,
        nodes: prev.nodes.map((n, i) => (i ? n : { ...n, name: 'Lab' })),
      }));
    });
    expect(committed).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.document.nodes[0]!.name).toBe('Lab');

    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.document.nodes[0]!.name).toBe(first.nodes[0]!.name);
    expect(result.current.dirty).toBe(false);

    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(result.current.document.nodes[0]!.name).toBe('Lab');
    expect(result.current.dirty).toBe(true);
  });

  it('creates no history for no-op or failed edits', () => {
    const first = structuredClone(fixture) as DraftV3;
    const { result } = renderHook(() => useEditorDocument(first));
    act(() => {
      result.current.commit('No-op', (prev) => ({ ...prev }));
    });
    expect(result.current.canUndo).toBe(false);
    act(() => {
      expect(
        result.current.commit('Broken', () => {
          throw new Error('nope');
        }),
      ).toBe(false);
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.document).toEqual(first);
  });

  it('marks saved without erasing history or the local snapshot', () => {
    const first = structuredClone(fixture) as DraftV3;
    const { result } = renderHook(() => useEditorDocument(first));
    act(() => {
      result.current.commit('Rename node', (prev) => ({
        ...prev,
        nodes: prev.nodes.map((n, i) => (i ? n : { ...n, name: 'Lab' })),
      }));
    });
    const local = result.current.document;
    act(() => {
      result.current.markSaved(structuredClone(local));
    });
    expect(result.current.dirty).toBe(false);
    // History survives the save acknowledgement.
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo();
    });
    expect(result.current.document.nodes[0]!.name).toBe(first.nodes[0]!.name);
    expect(result.current.dirty).toBe(true);
  });

  it('resets session history when switching maps', () => {
    const first = structuredClone(fixture) as DraftV3;
    const { result } = renderHook(() => useEditorDocument(first));
    act(() => {
      result.current.commit('Rename node', (prev) => ({
        ...prev,
        nodes: prev.nodes.map((n, i) => (i ? n : { ...n, name: 'Lab' })),
      }));
    });
    act(() => {
      result.current.reset(structuredClone(first));
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.dirty).toBe(false);
  });
});

describe('UnsavedChangesDialog', () => {
  it('surfaces the save error and locks actions while busy', () => {
    const noop = () => {};
    const { rerender } = render(
      <UnsavedChangesDialog open busy={false} saveError="Save conflict on n-a0." onSave={noop} onDiscard={noop} onCancel={noop} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/save conflict on n-a0/i);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    rerender(<UnsavedChangesDialog open busy saveError={null} onSave={noop} onDiscard={noop} onCancel={noop} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
describe('OrganizerV3 undo/redo wiring', () => {
  beforeEach(() => vi.restoreAllMocks());

  async function renameLobby(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /select building a ground lobby n-a0/i }));
    await user.clear(screen.getByLabelText('Node display name'));
    await user.type(screen.getByLabelText('Node display name'), 'Main lobby');
    await user.click(screen.getByRole('button', { name: 'Update point' }));
    expect(await screen.findByRole('heading', { name: 'Main lobby' })).toBeVisible();
  }

  it('shows disabled Undo/Redo buttons until an edit commits', async () => {
    mockGetDraft();
    render(<OrganizerV3 />);
    const undo = await screen.findByRole('button', { name: 'Undo' });
    const redo = await screen.findByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
  });

  it('undoes and redoes a rename through buttons and shortcuts', async () => {
    const user = userEvent.setup();
    mockGetDraft();
    render(<OrganizerV3 />);
    await renameLobby(user);

    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(await screen.findByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    // Redo via Ctrl+Y, then undo via Ctrl+Z.
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(await screen.findByRole('heading', { name: 'Main lobby' })).toBeVisible();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(await screen.findByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('heading', { name: 'Main lobby' })).toBeVisible();
  });

  it('removes the latest pending corner before committed edits', async () => {
    const user = userEvent.setup();
    mockGetDraft();
    render(<OrganizerV3 />);
    await renameLobby(user);
    await user.click(screen.getByRole('button', { name: 'Draw path' }));
    await user.click(screen.getByRole('button', { name: 'Mock path start' }));
    await user.click(screen.getByRole('button', { name: 'Mock path end' }));
    expect(screen.getByText('Pending vertices: 2')).toBeVisible();

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(screen.getByText('Pending vertices: 1')).toBeVisible();
    // The committed rename is untouched while pending corners remain.
    expect(screen.getByRole('button', { name: /select main lobby n-a0/i })).toBeVisible();

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(screen.getByText('Pending vertices: 0')).toBeVisible();
    expect(screen.getByRole('button', { name: /select main lobby n-a0/i })).toBeVisible();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(await screen.findByRole('button', { name: /select building a ground lobby n-a0/i })).toBeVisible();
  });

  it('respects empty, plaintext-only, nested, and inherited editable targets', async () => {
    const user = userEvent.setup();
    mockGetDraft();
    render(<OrganizerV3 />);
    await renameLobby(user);

    const host = document.createElement('div');
    host.innerHTML =
      '<div id="ce-empty" contenteditable=""><span id="ce-nested">edit me</span></div>' +
      '<div id="ce-plain" contenteditable="plaintext-only">plain</div>';
    document.body.appendChild(host);
    try {
      // Nested child inherits editability from the empty-attribute ancestor.
      fireEvent.keyDown(host.querySelector('#ce-nested')!, { key: 'z', ctrlKey: true });
      expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
      fireEvent.keyDown(host.querySelector('#ce-empty')!, { key: 'z', ctrlKey: true });
      expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
      fireEvent.keyDown(host.querySelector('#ce-plain')!, { key: 'z', ctrlKey: true });
      expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
      // A platform isContentEditable=true (absent in jsdom) also keeps native undo.
      const simulated = document.createElement('div');
      Object.defineProperty(simulated, 'isContentEditable', { value: true });
      host.appendChild(simulated);
      fireEvent.keyDown(simulated, { key: 'z', ctrlKey: true });
      expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
    } finally {
      host.remove();
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('still undoes from an explicitly non-editable island', async () => {
    const user = userEvent.setup();
    mockGetDraft();
    render(<OrganizerV3 />);
    await renameLobby(user);

    const host = document.createElement('div');
    host.innerHTML = '<div contenteditable=""><div id="ce-off" contenteditable="false">locked</div></div>';
    document.body.appendChild(host);
    try {
      fireEvent.keyDown(host.querySelector('#ce-off')!, { key: 'z', ctrlKey: true });
      expect(await screen.findByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();
    } finally {
      host.remove();
    }
  });
  it('leaves native input undo alone', async () => {
    const user = userEvent.setup();
    mockGetDraft();
    render(<OrganizerV3 />);
    await renameLobby(user);
    await user.click(await screen.findByRole('button', { name: /select main lobby n-a0/i }));
    const input = screen.getByLabelText('Node display name');
    await user.clear(input);
    await user.type(input, 'Draft name');
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    // Document undo must not fire from inside a text input.
    expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
    editable.remove();
  });

  it('locks undo shortcuts and history buttons while saving', async () => {
    const user = userEvent.setup();
    let resolvePut!: (value: Response) => void;
    let putBody: unknown = null;
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      if (url === draftUrl && init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body));
        return new Promise<Response>((resolve) => {
          resolvePut = resolve;
        });
      }
      return jsonResponse({}, 404);
    });
    render(<OrganizerV3 />);
    await renameLobby(user);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByTestId('save-state')).toHaveTextContent(/saving/i);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    // Still renamed: the shortcut was locked during the save.
    expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
    await act(async () => {
      resolvePut(jsonResponse(putBody));
    });
    expect(await screen.findByTestId('save-state')).toHaveTextContent(/all changes saved/i);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('retains the document and history when the server reports a revision conflict', async () => {
    const user = userEvent.setup();
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      if (url === draftUrl && init?.method === 'PUT') {
        return jsonResponse(
          { error: 'stale fingerprint revision for nodes: n-a0', code: 'revision_conflict', nodeIds: ['n-a0'], currentRevisions: { 'n-a0': 5 } },
          409,
        );
      }
      return jsonResponse({}, 404);
    });
    render(<OrganizerV3 />);
    await renameLobby(user);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/conflict.*n-a0/i);
    // The local document is retained: no server snapshot overwrote it.
    expect(screen.getByRole('heading', { name: 'Main lobby' })).toBeVisible();
    expect(screen.getByTestId('save-state')).toHaveTextContent(/unsaved changes/i);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('keeps history across a successful save without resurrecting stale geometry', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === draftUrl && (!init || !init.method || init.method === 'GET')) return jsonResponse(fixture);
      if (url === draftUrl && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push(body);
        return jsonResponse(body);
      }
      return jsonResponse({}, 404);
    });
    render(<OrganizerV3 />);
    await renameLobby(user);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.getByTestId('save-state')).toHaveTextContent(/all changes saved/i);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: 'Building A ground lobby' })).toBeVisible();
    expect(screen.getByTestId('save-state')).toHaveTextContent(/unsaved changes/i);
  });
});
