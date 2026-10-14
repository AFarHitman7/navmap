import type { Position } from '../map-contract';

/** Local map positions are top-left-origin and normalized to the source image. */
export const toLeaflet = (p: { x: number; y: number }, width: number, height: number): [number, number] => [height * (1 - p.y), width * p.x];
export const fromLeaflet = (lat: number, lng: number, width: number, height: number): Extract<Position, { kind: 'local' }> => ({ kind: 'local', x: lng / width, y: 1 - lat / height });
