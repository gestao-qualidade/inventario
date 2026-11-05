'use client';
import { createContext, useContext, useEffect, useState } from 'react';

export type Usuario = { id: string; nome: string; login: string; perfil: string; trocarSenha: boolean; extras: string[] };
export const UserCtx = createContext<Usuario | null>(null);
export const useUser = () => useContext(UserCtx)!;

export function Modal({ titulo, onClose, children, largo }: { titulo: string; onClose: () => void; children: React.ReactNode; largo?: boolean }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`max-h-[92vh] w-full overflow-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200 ${largo ? 'max-w-4xl' : 'max-w-lg'}`} role="dialog" aria-modal="true">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{titulo}</h2>
          <button className="text-2xl leading-none text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Fechar">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function Alerta({ tipo = 'erro', children }: { tipo?: 'erro' | 'ok' | 'info' | 'aviso'; children: React.ReactNode }) {
  const c = { erro: 'bg-red-50 text-red-800 border-red-200', ok: 'bg-emerald-50 text-emerald-800 border-emerald-200', info: 'bg-blue-50 text-blue-800 border-blue-200', aviso: 'bg-amber-50 text-amber-900 border-amber-200' }[tipo];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${c}`} role={tipo === 'erro' ? 'alert' : 'status'}>{children}</div>;
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />{texto}</div>;
}

export function Kpi({ rotulo, valor, sub, cor }: { rotulo: string; valor: React.ReactNode; sub?: string; cor?: string }) {
  return <div className="card relative overflow-hidden !p-4"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{rotulo}</div>
    <div className={`mt-1 text-2xl font-extrabold ${cor || 'text-slate-900'}`}>{valor}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>;
}

export function Titulo({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-extrabold tracking-tight text-slate-900 lg:text-3xl">{children}</h1>{acao}</div>;
}

export function Barra({ pct, cor = 'bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400' }: { pct: number; cor?: string }) {
  return <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80"><div className={`h-full rounded-full transition-all ${cor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

/** Carrega dados e expõe recarregar; opcional repetição periódica (filas atualizadas para todos os operadores). */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = [], intervaloMs = 0) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const run = () => fn().then(d => { if (vivo) { setDados(d); setErro(''); } }).catch(e => { if (vivo) setErro(e.message); }).finally(() => vivo && setCarregando(false));
    run();
    const t = intervaloMs ? setInterval(run, intervaloMs) : null;
    return () => { vivo = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { dados, erro, carregando, recarregar: () => setN(x => x + 1), setDados };
}

export const fmt = (n: number | string) => Number(n).toLocaleString('pt-BR');
export const dt = (s: string) => s || '—';
