const paths = {
  pointer: 'M5 3l14 9-7 1-3 7L5 3z',
  rectangle: 'M4 5h16v14H4z M4 5h0 M20 19h0',
  point: 'M12 8v8 M8 12h8 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  link: 'M7 7l10 10 M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  undo: 'M9 5L4 10l5 5 M4 10h10a6 6 0 0 1 0 12',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z M9 3v15 M15 6v15',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
