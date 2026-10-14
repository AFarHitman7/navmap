import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export const LAYOUT_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const LAYOUT_MAX_DIMENSION = 4096;
export const LAYOUT_MAX_PIXELS = 16_000_000;
export const PDF_MAX_PAGES = 20;
export const PDF_PAGE_TIMEOUT_MS = 30_000;

// Vite emits this worker as a same-origin asset; do not use a CDN or inline worker.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface LayoutSource {
  pages: number;
  renderPage(page: number): Promise<Blob>;
  close(): Promise<void>;
}

/** Run one render under a bounded budget and invoke destructive cleanup on expiry. */
export function withPageTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        // A failed cancel signal must not prevent the bounded rejection.
      }
      reject(new Error('PDF page conversion exceeded the 30-second limit'));
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function aborted(signal: AbortSignal): Error | undefined {
  return signal.aborted ? new DOMException('Layout import cancelled', 'AbortError') : undefined;
}

function checkSize(file: File): void {
  if (file.size > LAYOUT_SOURCE_MAX_BYTES) throw new Error('Layout source exceeds the 20 MiB limit');
  if (file.size === 0) throw new Error('Choose a non-empty PNG or PDF file');
}

function checkDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > LAYOUT_MAX_DIMENSION || height > LAYOUT_MAX_DIMENSION || width * height > LAYOUT_MAX_PIXELS) {
    throw new Error('Layout image exceeds 4096 pixels per axis or 16 million pixels');
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export the layout as PNG')), 'image/png');
  });
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function pngSource(file: File, signal: AbortSignal): LayoutSource {
  if (file.type !== 'image/png') throw new Error('Choose a PNG image or PDF document');
  return {
    pages: 1,
    async renderPage(page) {
      if (page !== 1) throw new Error('PNG images have one page');
      const cancelled = aborted(signal);
      if (cancelled) throw cancelled;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
        throw new Error('Could not read this PNG image');
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      checkDimensions(width, height);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (signal.aborted) {
        bitmap.close();
        throw aborted(signal)!;
      }
      const canvas = newCanvas(width, height);
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG conversion is not supported in this browser');
        context.drawImage(bitmap, 0, 0);
        const derivative = await canvasPng(canvas);
        if (signal.aborted) throw aborted(signal)!;
        return derivative;
      } finally {
        bitmap.close();
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    async close() {},
  };
}

function pdfError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'PasswordException' || /password/i.test(error.message))) {
    return new Error('This PDF is encrypted or password-protected. Remove its password and try again.');
  }
  if (error instanceof Error && error.name === 'AbortError') return error;
  return new Error('Could not read this PDF. Check that it is a valid, unencrypted PDF.');
}

export async function readLayoutSource(file: File, signal: AbortSignal): Promise<LayoutSource> {
  checkSize(file);
  const cancelled = aborted(signal);
  if (cancelled) throw cancelled;
  if (file.type === 'image/png') return pngSource(file, signal);
  if (file.type !== 'application/pdf') throw new Error('Choose a PNG image or PDF document');

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (aborted(signal)) throw aborted(signal)!;
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('Could not read this PDF. Check that it is a valid, unencrypted PDF.');
  }
  let task: PDFDocumentLoadingTask | undefined;
  let activeRender: RenderTask | undefined;
  let canvases = new Set<HTMLCanvasElement>();
  let closed = false;
  let rendering = false;
  let destroyPromise: Promise<void> | undefined;
  const destroy = (): Promise<void> => {
    if (destroyPromise) return destroyPromise;
    closed = true;
    try {
      activeRender?.cancel();
    } catch {
      // Continue releasing the worker and canvases even if a render already ended.
    }
    activeRender = undefined;
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
    canvases.clear();
    destroyPromise = task ? task.destroy().catch(() => undefined) : Promise.resolve();
    return destroyPromise;
  };
  const onAbort = () => { void destroy(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    task = getDocument({ data: bytes });
    const pdf = await task.promise;
    if (signal.aborted) throw aborted(signal)!;
    if (pdf.numPages > PDF_MAX_PAGES) throw new Error('PDF has more than 20 pages');
    if (pdf.numPages < 1) throw new Error('PDF has no pages');
    const renderPage = async (pageNumber: number): Promise<Blob> => {
      if (closed || signal.aborted) throw aborted(signal) ?? new DOMException('Layout import closed', 'AbortError');
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('Choose a page in this PDF');
      if (rendering) throw new Error('Wait for the current PDF page conversion to finish');
      rendering = true;
      let canvas: HTMLCanvasElement | undefined;
      try {
        const page: PDFPageProxy = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1, LAYOUT_MAX_DIMENSION / base.width, LAYOUT_MAX_DIMENSION / base.height,
          Math.sqrt(LAYOUT_MAX_PIXELS / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        checkDimensions(width, height);
        canvas = newCanvas(width, height);
        canvases.add(canvas);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('PDF conversion is not supported in this browser');
        const render = page.render({ canvas, canvasContext: context, viewport });
        activeRender = render;
        await withPageTimeout(render.promise, PDF_PAGE_TIMEOUT_MS, () => {
          render.cancel();
          void destroy();
        });
        if (signal.aborted) throw aborted(signal)!;
        return await canvasPng(canvas);
      } catch (error) {
        if (signal.aborted) throw aborted(signal)!;
        if (error instanceof Error && /30-second/.test(error.message)) throw error;
        throw pdfError(error);
      } finally {
        activeRender = undefined;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
          canvases.delete(canvas);
        }
        rendering = false;
      }
    };
    return {
      pages: pdf.numPages,
      renderPage,
      async close() {
        signal.removeEventListener('abort', onAbort);
        await destroy();
      },
    };
  } catch (error) {
    signal.removeEventListener('abort', onAbort);
    await destroy();
    if (signal.aborted) throw aborted(signal)!;
    if (error instanceof Error && /PDF has more than 20 pages|PDF has no pages|Layout image exceeds/.test(error.message)) throw error;
    throw pdfError(error);
  }
}
