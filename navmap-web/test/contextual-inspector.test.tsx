import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { geographicDraft, staticDraft } from '../src/fixtures/map-v5';
import { getDraftV5, publishV5, saveDraftV5 } from '../src/api-v3';
import { OrganizerV5 } from '../src/OrganizerV5';
import { Inspector } from '../src/editor-v3/inspectors/Inspector';
import { ToolMenu } from '../src/editor-v3/ToolMenu';
import type { Selection, Tool } from '../src/editor-v3/tool-state';
import type { Endpoint } from '../src/editor-v3/objects';

function mountV5Editor() {
  const router = createMemoryRouter([{ path: '/', element: <OrganizerV5 venueId="demo-v5-static" /> }]);
  return render(<RouterProvider router={router} />);
}

vi.mock('../src/api-v3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api-v3')>();
  return { ...actual, getDraftV5: vi.fn(), isV5AuthoringEnabled: vi.fn().mockResolvedValue(true), saveDraftV5: vi.fn(), publishV5: vi.fn() };
});
vi.mock('../src/map/CanvasHost', () => ({ CanvasHost: ({ callbacks }: { callbacks: {
  onPointClick: (position: { kind: 'local'; x: number; y: number }, frameId: string) => void;
  onNodeClick: (id: string) => void;
} }) => <div><button type="button" onClick={() => callbacks.onPointClick({ kind: 'local', x: 0.3, y: 0.4 }, 'frame-b-a-z0')}>Map point one</button>
  <button type="button" onClick={() => callbacks.onPointClick({ kind: 'local', x: 0.7, y: 0.6 }, 'frame-b-a-z0')}>Map point two</button>
  <button type="button" onClick={() => callbacks.onNodeClick('s-a0b')}>Select lower landing</button>
  <button type="button" onClick={() => callbacks.onNodeClick('s-a1b')}>Select upper landing</button>
  <button type="button" onClick={() => callbacks.onNodeClick('n-out')}>Select outdoor node</button>
  <button type="button" onClick={() => callbacks.onNodeClick('n-a0')}>Select indoor lobby</button>
  <button type="button" onClick={() => callbacks.onNodeClick('n-a0g')}>Select indoor survey node</button></div> }));

function mountInspector(tool: Tool = { kind: 'select' }, selection: Selection = { kind: 'none' }, kind: 'static' | 'geographic' = 'static') {
  const document = { ...staticDraft(), canvas: { kind } } as ReturnType<typeof staticDraft>;
  return render(<Inspector document={document} tool={tool} selection={selection} activeFrameId={document.frames[0]!.id}
    commit={vi.fn(() => true)} onSelectionChange={vi.fn()} onToolChange={vi.fn()} view="build" onViewChange={vi.fn()}
    onPublish={vi.fn()} busy={false} />);
}

function mountInspectorWith(document: ReturnType<typeof staticDraft>, tool: Tool, selection: Selection) {
  return render(<Inspector document={document} tool={tool} selection={selection} activeFrameId={document.frames[0]!.id}
    commit={vi.fn(() => true)} onSelectionChange={vi.fn()} onToolChange={vi.fn()} view="build" onViewChange={vi.fn()}
    onPublish={vi.fn()} busy={false} />);
}

describe('contextual V5 inspector', () => {
  it('shows only the active drawing form and its selected subtype', () => {
    mountInspector({ kind: 'node', subtype: 'regular' });
    expect(screen.getByRole('heading', { name: 'Regular node' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Boundary' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Building' })).toBeNull();
    expect(screen.queryByLabelText('Entrance name')).toBeNull();
  });

  it('shows concise guidance with no selection and supports focused Places and Publish views', () => {
    const { rerender } = mountInspector();
    expect(screen.getByText('Select an object or choose a map tool.')).toBeTruthy();
    const document = staticDraft();
    const common = { document, tool: { kind: 'select' } as Tool, selection: { kind: 'none' } as Selection,
      activeFrameId: document.frames[0]!.id, commit: vi.fn(() => true), onSelectionChange: vi.fn(), onToolChange: vi.fn(),
      onViewChange: vi.fn(), onPublish: vi.fn(), busy: false };
    rerender(<Inspector {...common} view="places" />);
    expect(screen.getByRole('heading', { name: 'Places' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Boundary' })).toBeNull();
    rerender(<Inspector {...common} view="publish" />);
    expect(screen.getByRole('heading', { name: 'Publish map' })).toBeTruthy();
  });

  it('names the floor label instead of the raw floor number for a selected node', () => {
    mountInspector({ kind: 'select' }, { kind: 'node', id: 's-a0' });
    expect(screen.getByText(/Selected node · Building A · Ground/)).toBeTruthy();
    expect(screen.queryByText(/Selected node · Building A · 0$/)).toBeNull();
  });

  it('offers only indoor nodes without a place when adding a destination', () => {
    const doc = staticDraft();
    const common = { document: doc, tool: { kind: 'select' } as Tool, selection: { kind: 'none' } as Selection,
      activeFrameId: doc.frames[0]!.id, commit: vi.fn(() => true), onSelectionChange: vi.fn(), onToolChange: vi.fn(),
      onViewChange: vi.fn(), onPublish: vi.fn(), busy: false };
    render(<Inspector {...common} view="places" />);
    const values = Array.from((screen.getByLabelText('Indoor node') as HTMLSelectElement).options).map((option) => option.textContent);
    expect(values).not.toContain('Ground lobby');
    expect(values).toContain('Ground corridor');
  });

  it('exposes image and frame controls for static maps, not geographic boundary prompts', () => {
    const { rerender } = mountInspector({ kind: 'boundary' });
    expect(screen.getAllByText(/static map/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Geographic coordinates/i)).toBeNull();
    const document = { ...staticDraft(), canvas: { kind: 'geographic' as const } };
    rerender(<Inspector document={document} tool={{ kind: 'boundary' }} selection={{ kind: 'none' }} activeFrameId={document.frames[0]!.id}
      commit={vi.fn(() => true)} onSelectionChange={vi.fn()} onToolChange={vi.fn()} view="build" onViewChange={vi.fn()}
      onPublish={vi.fn()} busy={false} />);
    expect(screen.getByText(/background tiles/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add a floor plan' })).toBeNull();
  });

  it('provides Escape-dismissible Node subtype menu with the current subtype visible', () => {
    render(<ToolMenu label="Node" active="Stair" disabled={false} items={[
      { label: 'Regular', subtype: 'regular', value: { kind: 'node', subtype: 'regular' } },
      { label: 'Entrance', subtype: 'entrance', value: { kind: 'node', subtype: 'entrance' } },
      { label: 'Stair', subtype: 'stair', value: { kind: 'node', subtype: 'stair' } },
    ]} onChoose={vi.fn()} />);
    const menuButton = screen.getByRole('button', { name: /Node · Stair/ });
    fireEvent.click(menuButton);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(menuButton, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the boundary form editable while typing a coordinate', () => {
    mountInspectorWith(geographicDraft(), { kind: 'boundary' }, { kind: 'none' });
    const north = screen.getByLabelText('North');
    // Two keystrokes in one batch: the second update is applied during render,
    // where the released synthetic event's currentTarget is null.
    act(() => {
      fireEvent.change(north, { target: { value: '1' } });
      fireEvent.change(north, { target: { value: '12.5' } });
    });
    expect(north).toHaveValue(12.5);
  });

  it('keeps the building bounds and floor labels editable while typing', () => {
    mountInspectorWith(geographicDraft(), { kind: 'building' }, { kind: 'none' });
    const west = screen.getByLabelText('West');
    act(() => {
      fireEvent.change(west, { target: { value: '80' } });
      fireEvent.change(west, { target: { value: '80.25' } });
    });
    expect(west).toHaveValue(80.25);
    mountInspector({ kind: 'select' }, { kind: 'building', id: 'b-a' });
    const floorLabel = screen.getByLabelText('Floor 0 label');
    act(() => {
      fireEvent.change(floorLabel, { target: { value: 'Rece' } });
      fireEvent.change(floorLabel, { target: { value: 'Reception' } });
    });
    expect(floorLabel).toHaveValue('Reception');
  });

  it('confirms before publishing and saves unsaved changes first', async () => {
    vi.mocked(getDraftV5).mockResolvedValue(staticDraft());
    vi.mocked(saveDraftV5).mockImplementation(async (draft) => draft);
    vi.mocked(publishV5).mockResolvedValue({ manifest: { version: 9 } } as never);
    const { container } = mountV5Editor();
    await screen.findByRole('heading', { name: 'demo-v5-static' });
    fireEvent.click(screen.getByRole('button', { name: 'Node' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map point one' }));
    fireEvent.click(within(container.querySelector('.v5-publish-bar')! as HTMLElement).getByRole('button', { name: 'Publish' }));
    expect(vi.mocked(publishV5)).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish map' }));
    await vi.waitFor(() => expect(vi.mocked(publishV5)).toHaveBeenCalled());
    expect(vi.mocked(saveDraftV5)).toHaveBeenCalled();
  });

  it('labels entrance steps by the point actually chosen, not by click order', () => {
    const doc = geographicDraft();
    const mount = (endpoints: Endpoint[]) => render(<Inspector document={doc} tool={{ kind: 'node', subtype: 'entrance' }} selection={{ kind: 'none' }} activeFrameId={doc.frames[0]!.id}
      commit={vi.fn(() => true)} onSelectionChange={vi.fn()} onToolChange={vi.fn()} view="build" onViewChange={vi.fn()}
      onPublish={vi.fn()} busy={false} gesture={{ kind: 'entrance', endpoints, name: '' }} onGestureChange={vi.fn()} />);
    const outdoorFirst = mount([{ nodeId: 'n-out' }]);
    expect(document.querySelector('.v5-endpoint-steps li')!.textContent).toContain('Outdoor landing');
    outdoorFirst.unmount();
    mount([{ nodeId: 'n-out' }, { nodeId: 'n-a0' }]);
    const steps = document.querySelectorAll('.v5-endpoint-steps li');
    expect(steps[0]!.textContent).toContain('Outdoor landing');
    expect(steps[1]!.textContent).toContain('Indoor landing');
  });

  it('creates an entrance regardless of click order and reports a specific error otherwise', async () => {
    vi.mocked(getDraftV5).mockResolvedValue(geographicDraft());
    vi.mocked(saveDraftV5).mockImplementation(async (draft) => draft);
    mountV5Editor();
    await screen.findByRole('heading', { name: 'demo-v5-geo' });
    fireEvent.click(screen.getByRole('button', { name: 'Node' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Entrance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select outdoor node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select indoor survey node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish entrance' }));
    await vi.waitFor(() => expect(document.querySelector('.v5-status')).toHaveTextContent('Entrance added'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(vi.mocked(saveDraftV5)).toHaveBeenCalled());
    const saved = vi.mocked(saveDraftV5).mock.calls.at(-1)?.[0];
    if (!saved) throw new Error('draft was not saved');
    const entrance = saved.transitions.at(-1)!;
    expect(entrance.kind).toBe('entrance');
    expect(entrance.nodeIds).toContain('n-out');
    expect(entrance.nodeIds).toContain('n-a0g');
  });

  it('explains a same-kind entrance instead of failing generically', async () => {
    vi.mocked(getDraftV5).mockResolvedValue(geographicDraft());
    mountV5Editor();
    await screen.findByRole('heading', { name: 'demo-v5-geo' });
    fireEvent.click(screen.getByRole('button', { name: 'Node' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Entrance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select indoor lobby' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select indoor survey node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish entrance' }));
    await vi.waitFor(() => expect(document.querySelector('.v5-status')).toHaveTextContent(/one indoor landing and one outdoor point/));
  });

  it('creates a stair transition from existing survey landings as one undoable operation', async () => {
    vi.mocked(getDraftV5).mockResolvedValue(staticDraft());
    vi.mocked(saveDraftV5).mockImplementation(async (draft) => draft);
    mountV5Editor();
    await screen.findByRole('heading', { name: 'demo-v5-static' });
    fireEvent.click(screen.getByRole('button', { name: 'Node' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Stair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select lower landing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select upper landing' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish stair' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Stairs added');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(vi.mocked(saveDraftV5)).toHaveBeenCalled());
    const saved = vi.mocked(saveDraftV5).mock.calls.at(-1)?.[0];
    expect(saved?.transitions.at(-1)).toMatchObject({ kind: 'stair', nodeIds: ['s-a0b', 's-a1b'] });
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });

  it('draws and finishes a regular path through the actual toolbar subtype menu', async () => {
    vi.mocked(getDraftV5).mockResolvedValue(staticDraft());
    vi.mocked(saveDraftV5).mockImplementation(async (draft) => draft);
    mountV5Editor();
    await screen.findByRole('heading', { name: 'demo-v5-static' });
    fireEvent.click(screen.getByRole('button', { name: 'Path' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Regular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map point one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map point two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish path' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Path added');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(vi.mocked(saveDraftV5)).toHaveBeenCalled());
    expect(vi.mocked(saveDraftV5).mock.calls.at(-1)?.[0].paths?.at(-1)?.kind).toBe('regular');
  });
});
