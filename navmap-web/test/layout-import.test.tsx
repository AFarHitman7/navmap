import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutImportPanel } from '../src/LayoutImportPanel';
import { readLayoutSource, withPageTimeout } from '../src/pdf-import';
import { staticDraft } from '../src/fixtures/map-v5';
import { useEditorDocument } from '../src/editor-v3/useEditorDocument';

// jsdom has no Worker API; pdf.js runs its actual bundled worker module via
// its supported fake-worker adapter while parsing these real fixture files.
GlobalWorkerOptions.workerSrc = pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href;

let nativeCanvases: WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>;
let decodeImage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  nativeCanvases = new WeakMap();
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let canvas = nativeCanvases.get(this);
    if (!canvas) {
      canvas = createCanvas(this.width, this.height);
      nativeCanvases.set(this, canvas);
    }
    return canvas.getContext('2d') as never;
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    const canvas = nativeCanvases.get(this) ?? createCanvas(this.width, this.height);
    callback(new Blob([canvas.toBuffer('image/png')], { type: 'image/png' }));
  });
  decodeImage = vi.fn(async (blob: Blob) => {
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
    Object.assign(image, { close() {} });
    return image;
  });
  vi.stubGlobal('createImageBitmap', decodeImage);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ assetId: 'a'.repeat(64), width: 600, height: 800,
      sha256: 'b'.repeat(64), byteLength: 42 }),
  } as Response)));
  class TestURL extends URL {}
  Object.assign(TestURL, { createObjectURL: vi.fn(() => 'blob:layout-preview'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('URL', TestURL);
});

const fixture = (name: string) => new File([readFileSync(resolve('test/fixtures/layouts', name))], name, { type: 'application/pdf' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded layout source conversion', () => {
  it('reads page count and rasterizes a real two-page PDF into bounded PNGs', async () => {
    const file = fixture('two-page.pdf');
    expect(file.size).toBeGreaterThan(0);
    const source = await readLayoutSource(file, new AbortController().signal);
    try {
      expect(source.pages).toBe(2);
      const page = await source.renderPage(1);
      expect(page.type).toBe('image/png');
      expect(page.size).toBeGreaterThan(0);
      const pageImage = await loadImage(Buffer.from(await page.arrayBuffer()));
      expect([pageImage.width, pageImage.height]).toEqual([600, 800]);
      const second = await source.renderPage(2);
      const secondImage = await loadImage(Buffer.from(await second.arrayBuffer()));
      expect([secondImage.width, secondImage.height]).toEqual([800, 600]);
    } finally {
      await source.close();
    }
  });

  it('reports encrypted PDFs clearly and rejects corrupt PDFs', async () => {
    await expect(readLayoutSource(fixture('encrypted.pdf'), new AbortController().signal))
      .rejects.toThrow(/password-protected/i);
    await expect(readLayoutSource(fixture('corrupt.pdf'), new AbortController().signal))
      .rejects.toThrow(/could not read this PDF/i);
  });

  it('rejects an oversized PDF before parsing it', async () => {
    const file = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'too-large.pdf', { type: 'application/pdf' });
    await expect(readLayoutSource(file, new AbortController().signal)).rejects.toThrow(/20 MiB/i);
  });

  it('rejects PDFs with more than 20 pages before rendering', async () => {
    await expect(readLayoutSource(fixture('twenty-one-pages.pdf'), new AbortController().signal))
      .rejects.toThrow(/more than 20 pages/i);
  });

  it('scales a real oversized PDF page to both output bounds', async () => {
    const source = await readLayoutSource(fixture('oversized-page.pdf'), new AbortController().signal);
    try {
      const derivative = await source.renderPage(1);
      const image = await loadImage(Buffer.from(await derivative.arrayBuffer()));
      expect(image.width).toBeLessThanOrEqual(4096);
      expect(image.height).toBeLessThanOrEqual(4096);
      expect(image.width * image.height).toBeLessThanOrEqual(16_000_000);
    } finally {
      await source.close();
    }
  });

  it('rejects over-dimension PNGs from their header before browser decoding', async () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    new DataView(bytes.buffer).setUint32(16, 4097);
    new DataView(bytes.buffer).setUint32(20, 1);
    const source = await readLayoutSource(new File([bytes], 'too-wide.png', { type: 'image/png' }), new AbortController().signal);
    await expect(source.renderPage(1)).rejects.toThrow(/4096 pixels/i);
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it('enforces the independent 16-megapixel input limit', async () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 4096);
    view.setUint32(20, 4096);
    const source = await readLayoutSource(new File([bytes], 'too-many-pixels.png', { type: 'image/png' }), new AbortController().signal);
    await expect(source.renderPage(1)).rejects.toThrow(/16 million pixels/i);
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it('converts a valid PNG to a fresh PNG derivative', async () => {
    const bytes = createCanvas(3, 2).toBuffer('image/png');
    const source = await readLayoutSource(new File([bytes], 'small.png', { type: 'image/png' }), new AbortController().signal);
    const derivative = await source.renderPage(1);
    expect(derivative.type).toBe('image/png');
    const decoded = await loadImage(Buffer.from(await derivative.arrayBuffer()));
    expect([decoded.width, decoded.height]).toEqual([3, 2]);
  });

  it('stops conversion when the caller cancels', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readLayoutSource(fixture('two-page.pdf'), controller.signal)).rejects.toThrow(/cancel/i);
  });

  it('destroys an opened PDF source on cancellation', async () => {
    const controller = new AbortController();
    const source = await readLayoutSource(fixture('two-page.pdf'), controller.signal);
    controller.abort();
    await expect(source.renderPage(1)).rejects.toThrow(/cancel/i);
  });

  it('enforces the 30-second page render budget and runs destructive cleanup', async () => {
    vi.useFakeTimers();
    try {
      const rendering = new Promise<never>(() => {});
      const cleanup = vi.fn();
      const bounded = withPageTimeout(rendering, 30_000, cleanup);
      const rejection = expect(bounded).rejects.toThrow(/30-second limit/i);
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the page deadline through stalled PNG encoding and ignores late canvas output', async () => {
    const source = await readLayoutSource(fixture('two-page.pdf'), new AbortController().signal);
    let completeEncoding: BlobCallback | undefined;
    let encodeCanvas: HTMLCanvasElement | undefined;
    const holdEncoding = (canvas: HTMLCanvasElement, callback: BlobCallback) => {
      encodeCanvas = canvas;
      completeEncoding = callback;
    };
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (callback) {
      holdEncoding(this, callback);
    });
    const nativeTimeout = globalThis.setTimeout.bind(globalThis);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
      nativeTimeout(callback, delay === 30_000 ? 1_000 : delay, ...args)) as typeof setTimeout);
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    const conversion = source.renderPage(1).then(
      () => { settled = 'resolved'; },
      () => { settled = 'rejected'; },
    );
    try {
      await waitFor(() => expect(completeEncoding).toBeDefined());
      await new Promise((resolve) => nativeTimeout(resolve, 1_200));
      expect(settled).toBe('rejected');
      expect(encodeCanvas?.width).toBe(0);
      expect(encodeCanvas?.height).toBe(0);
      completeEncoding?.(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
      await conversion;
      expect(settled).toBe('rejected');
    } finally {
      await source.close();
    }
  });

  it('aborts a stalled PNG encode, destroys its canvas, and ignores a late callback', async () => {
    const controller = new AbortController();
    const source = await readLayoutSource(fixture('two-page.pdf'), controller.signal);
    let completeEncoding: BlobCallback | undefined;
    let encodeCanvas: HTMLCanvasElement | undefined;
    const holdEncoding = (canvas: HTMLCanvasElement, callback: BlobCallback) => {
      encodeCanvas = canvas;
      completeEncoding = callback;
    };
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (callback) {
      holdEncoding(this, callback);
    });
    const conversion = source.renderPage(1);
    try {
      await waitFor(() => expect(completeEncoding).toBeDefined());
      controller.abort();
      await expect(conversion).rejects.toThrow(/cancel/i);
      expect(encodeCanvas?.width).toBe(0);
      expect(encodeCanvas?.height).toBe(0);
      completeEncoding?.(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
      await source.close();
      expect(encodeCanvas?.width).toBe(0);
    } finally {
      await source.close();
    }
  });

  it('previews a real PDF page, uploads its PNG derivative, and commits assignment to shared history', async () => {
    function EditorHarness() {
      const editor = useEditorDocument(staticDraft());
      return <><LayoutImportPanel venueId={editor.document.venueId} draft={editor.document} commit={editor.commit} />
        <button type="button" onClick={editor.undo}>Undo assignment</button>
        <output>{editor.document.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.background?.assetId ?? 'empty'}</output>
      </>;
    }
    const user = userEvent.setup();
    const { unmount } = render(<EditorHarness />);
    await user.upload(screen.getByLabelText('Choose a PNG or PDF'), fixture('two-page.pdf'));
    expect(await screen.findByRole('img', { name: /page 1/i })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('PDF page'), '2');
    expect(await screen.findByRole('img', { name: /page 2/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Assign page to floor' }));
    await waitFor(() => expect(screen.getByText('a'.repeat(64))).toBeVisible());
    expect(fetch).toHaveBeenCalledWith('/api/admin/venues/demo-v5-static/layout-assets', expect.objectContaining({ method: 'POST' }));
    await user.type(screen.getByLabelText('Point A x'), '0.1');
    await user.type(screen.getByLabelText('Point A y'), '0.2');
    await user.type(screen.getByLabelText('Point B x'), '0.2');
    await user.type(screen.getByLabelText('Point B y'), '0.2');
    await user.type(screen.getByLabelText('Known distance, metres'), '10');
    await user.click(screen.getByRole('button', { name: 'Save floor scale' }));
    expect(await screen.findByText(/Calibrated ·/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo assignment' }));
    expect(screen.getByText('a'.repeat(64))).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo assignment' }));
    expect(screen.getByText('empty')).toBeVisible();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('requires replacement confirmation and leaves the history unchanged when upload fails', async () => {
    const upload = vi.fn(async () => ({ ok: false, status: 413, text: async () => JSON.stringify({ error: 'layout image rejected' }) } as Response));
    vi.stubGlobal('fetch', upload);
    function EditorHarness() {
      const editor = useEditorDocument(staticDraft());
      return <><LayoutImportPanel venueId={editor.document.venueId} draft={editor.document} commit={editor.commit} />
        <output>{editor.document.frames.find((frame) => frame.id === 'frame-b-a-z0')?.background?.assetId}</output>
        <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
      </>;
    }
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.upload(screen.getByLabelText('Choose a PNG or PDF'), fixture('two-page.pdf'));
    await screen.findByRole('img', { name: /page 1/i });
    await user.selectOptions(screen.getByLabelText('Assign to floor'), 'frame-b-a-z0');
    await user.click(screen.getByRole('button', { name: 'Replace floor background' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/placed points keep their normalized positions/i);
    await user.click(screen.getByRole('button', { name: 'Replace background' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/layout image rejected/i);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not commit when an in-flight PNG upload is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    function EditorHarness() {
      const editor = useEditorDocument(staticDraft());
      return <><LayoutImportPanel venueId={editor.document.venueId} draft={editor.document} commit={editor.commit} />
        <output>{editor.document.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.background?.assetId ?? 'empty'}</output>
        <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
      </>;
    }
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.upload(screen.getByLabelText('Choose a PNG or PDF'), fixture('two-page.pdf'));
    await screen.findByRole('img', { name: /page 1/i });
    await user.click(screen.getByRole('button', { name: 'Assign page to floor' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('empty')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('does not assign a late upload into another map after the editor resets', async () => {
    let resolveUpload!: (response: Response) => void;
    const deferredUpload = new Promise<Response>((resolve) => { resolveUpload = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => deferredUpload));
    const mapA = { ...staticDraft(), venueId: 'map-a' };
    const mapB = { ...staticDraft(), venueId: 'map-b' };
    function EditorHarness() {
      const editor = useEditorDocument(mapA);
      return <>
        <LayoutImportPanel venueId={editor.document.venueId} draft={editor.document} commit={editor.commit} />
        <button type="button" onClick={() => editor.reset(mapB)}>Switch map</button>
        <output>{editor.document.venueId}:{editor.document.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.background?.assetId ?? 'empty'}</output>
        <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
      </>;
    }
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.upload(screen.getByLabelText('Choose a PNG or PDF'), fixture('two-page.pdf'));
    await screen.findByRole('img', { name: /page 1/i });
    await user.click(screen.getByRole('button', { name: 'Assign page to floor' }));
    await screen.findByText('Preparing floor plan…');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Switch map' }));
    resolveUpload({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ assetId: 'a'.repeat(64), width: 600, height: 800,
        sha256: 'b'.repeat(64), byteLength: 42 }),
    } as Response);
    await waitFor(() => expect(screen.queryByText('Preparing floor plan…')).not.toBeInTheDocument());
    expect(screen.getByText('map-b:empty')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('rejects an upload when the same map snapshot changed while transport was pending', async () => {
    let resolveUpload!: (response: Response) => void;
    const deferredUpload = new Promise<Response>((resolve) => { resolveUpload = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => deferredUpload));
    const initial = staticDraft();
    const edited = { ...initial, nodes: initial.nodes.map((node, index) => index === 0 ? { ...node, name: 'Edited during upload' } : node) };
    function EditorHarness() {
      const editor = useEditorDocument(initial);
      return <>
        <LayoutImportPanel venueId={editor.document.venueId} draft={editor.document} commit={editor.commit} />
        <button type="button" onClick={() => editor.reset(edited)}>Reload current map</button>
        <output>{editor.document.nodes[0]?.name}:{editor.document.frames.find((frame) => frame.id === 'frame-outdoor-z0')?.background?.assetId ?? 'empty'}</output>
        <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>Undo</button>
      </>;
    }
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.upload(screen.getByLabelText('Choose a PNG or PDF'), fixture('two-page.pdf'));
    await screen.findByRole('img', { name: /page 1/i });
    await user.click(screen.getByRole('button', { name: 'Assign page to floor' }));
    await screen.findByText('Preparing floor plan…');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Reload current map' }));
    resolveUpload({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ assetId: 'a'.repeat(64), width: 600, height: 800,
        sha256: 'b'.repeat(64), byteLength: 42 }),
    } as Response);
    await waitFor(() => expect(screen.queryByText('Preparing floor plan…')).not.toBeInTheDocument());
    expect(screen.getByText('Edited during upload:empty')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/draft changed during upload/i);
  });
});
