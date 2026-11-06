'use client';

/** Máscara de digitação DD/MM/AAAA (aceita só números). */
export const mascaraData = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

export type LoteVal = { lote?: string; validade?: string };

/** Validade DD/MM/AAAA → dias até vencer (negativo = vencido). null se não for data. */
function dias(v?: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v || '').trim()); if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); const h = new Date(); h.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - h.getTime()) / 86400000);
}

/** Lote e validade do material. Vencido = vermelho, vence em até 30 dias = amarelo. */
export default function Lotes({ lotes, grande = false, vazio = true }: { lotes?: LoteVal[]; grande?: boolean; vazio?: boolean }) {
  if (!lotes?.length) return vazio ? <div className="text-xs text-slate-400">Lote/validade: sem informação</div> : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lotes.map((l, i) => {
        const d = dias(l.validade);
        const cor = d === null ? 'bg-slate-100 text-slate-700 ring-slate-200' : d < 0 ? 'bg-red-100 text-red-800 ring-red-300' : d <= 30 ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-emerald-50 text-emerald-900 ring-emerald-200';
        return <span key={i} className={`rounded-lg px-2 py-1 font-semibold ring-1 ${cor} ${grande ? 'text-sm' : 'text-xs'}`}>
          <span className="opacity-70">Lote</span> {l.lote || 's/ lote'}<span className="mx-1 opacity-40">·</span><span className="opacity-70">Val.</span> {l.validade || 's/ validade'}{d !== null && d < 0 ? ' · VENCIDO' : d !== null && d <= 30 ? ` · vence em ${d}d` : ''}</span>;
      })}
    </div>
  );
}
