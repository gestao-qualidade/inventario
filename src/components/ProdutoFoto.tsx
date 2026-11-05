'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/** Foto do produto: sempre puxada de https://sil.pslogistica.com.br/imagens/CODIGO.JPG */
export const urlFoto = (sku: string) => `https://sil.pslogistica.com.br/imagens/${encodeURIComponent(sku.trim().toUpperCase())}.JPG`;

/** Foto em tela cheia com zoom: roda do mouse, pinça no celular, botões + − e arrastar para mover. */
function Ampliada({ sku, onClose }: { sku: string; onClose: () => void }) {
  const [z, setZ] = useState(1); const [p, setP] = useState({ x: 0, y: 0 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>()); const dist0 = useRef(0); const z0 = useRef(1);
  const ajustar = (nz: number) => { const v = Math.min(8, Math.max(1, nz)); setZ(v); if (v === 1) setP({ x: 0, y: 0 }); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === '+' || e.key === '=') setZ(v => Math.min(8, v * 1.4)); if (e.key === '-') ajustar(z / 1.4); };
    window.addEventListener('keydown', k); const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = o; };
  });
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; dist0.current = Math.hypot(a.x - b.x, a.y - b.y); z0.current = z; } };
  const move = (e: React.PointerEvent) => {
    const ant = ptrs.current.get(e.pointerId); if (!ant) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; ajustar(z0.current * Math.hypot(a.x - b.x, a.y - b.y) / (dist0.current || 1)); }
    else if (z > 1) setP(q => ({ x: q.x + e.clientX - ant.x, y: q.y + e.clientY - ant.y }));
  };
  const up = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); };
  const btn = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl font-bold text-white backdrop-blur hover:bg-white/30';
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90" onClick={e => { e.stopPropagation(); }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 truncate text-sm font-bold">{sku}</div>
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => ajustar(z / 1.5)} aria-label="Diminuir">−</button>
          <button type="button" className="h-11 rounded-full bg-white/15 px-4 text-sm font-bold hover:bg-white/30" onClick={() => ajustar(1)}>{Math.round(z * 100)}%</button>
          <button type="button" className={btn} onClick={() => ajustar(z * 1.5)} aria-label="Aumentar">+</button>
          <button type="button" className={btn} onClick={onClose} aria-label="Fechar">✕</button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ touchAction: 'none', cursor: z > 1 ? 'grab' : 'zoom-in' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        onWheel={e => ajustar(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => ajustar(z > 1 ? 1 : 2.5)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urlFoto(sku)} alt={sku} draggable={false} referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${z})`, transition: ptrs.current.size ? 'none' : 'transform .12s' }} />
      </div>
      <div className="px-4 pb-3 text-center text-xs text-white/70">Dê dois toques para aproximar · use a pinça ou a roda do mouse para o zoom · arraste para mover</div>
    </div>, document.body);
}

export default function ProdutoFoto({ sku, className = 'h-24 w-24', ampliar = true }: { sku: string; className?: string; ampliar?: boolean }) {
  const [falhou, setFalhou] = useState(false); const [aberta, setAberta] = useState(false);
  if (!sku || falhou) return <div className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400`}><Icon nome="box" className="h-1/2 w-1/2" /></div>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urlFoto(sku)} alt={sku} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)}
        onClick={ampliar ? e => { e.stopPropagation(); e.preventDefault(); setAberta(true); } : undefined} title={ampliar ? 'Clique para ampliar' : undefined}
        className={`${className} shrink-0 rounded-xl bg-white object-contain ring-1 ring-slate-200 ${ampliar ? 'cursor-zoom-in transition hover:ring-2 hover:ring-brand-500' : ''}`} />
      {aberta && <Ampliada sku={sku} onClose={() => setAberta(false)} />}
    </>
  );
}
