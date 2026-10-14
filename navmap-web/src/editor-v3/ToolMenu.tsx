import { useEffect, useRef, useState } from 'react';
import type { Tool } from './tool-state';

type MenuItem<T extends string> = { label: string; subtype: T; value: Tool };
export function ToolMenu<T extends string>({ label, active, items, disabled, onChoose }: {
  label: 'Node' | 'Path'; active: string | null; items: MenuItem<T>[]; disabled: boolean; onChoose: (tool: Tool) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { if (open) itemsRef.current[0]?.focus(); }, [open]);
  return <div className="v5-tool-menu-wrap" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={active ? `${label} · ${active}` : label}
      disabled={disabled} onClick={() => setOpen((value) => !value)}>{active ? `${label} · ${active}` : label} ▾</button>
    {open && <div className="v5-tool-menu" role="menu" aria-label={`${label} type`} onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const index = itemsRef.current.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      itemsRef.current[(index + delta + items.length) % items.length]?.focus();
      event.preventDefault();
    }}>
      {items.map((item, index) => <button key={item.subtype} ref={(button) => { itemsRef.current[index] = button; }} type="button" role="menuitemradio" aria-checked={active === item.subtype}
        onClick={() => { onChoose(item.value); setOpen(false); }}>{item.label}</button>)}
    </div>}
  </div>;
}
