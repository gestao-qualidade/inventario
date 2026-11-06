'use client';
import { useMemo, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Barra, Carregando, Modal, fmt, useCarregar, useUser } from './ui';
import ProdutoFoto from './ProdutoFoto';

type Catalogo = { versao: string; total: number; dims: Record<'clientes' | 'galpoes' | 'ruas' | 'colunas' | 'alturas' | 'curvas' | 'skus', string[]>; linhas: number[][] };
type Dim = 'clientes' | 'galpoes' | 'ruas' | 'colunas' | 'alturas' | 'curvas';
// índice da dimensão dentro de cada linha do catálogo: [cliente, galpão, rua, coluna, altura, curva, sku]
const COL: Record<Dim | 'skus', number> = { clientes: 0, galpoes: 1, ruas: 2, colunas: 3, alturas: 4, curvas: 5, skus: 6 };
const DIMS: { k: Dim; t: string; fmt?: (v: string) => string }[] = [
  { k: 'clientes', t: 'Cliente' }, { k: 'galpoes', t: 'Galpão' }, { k: 'ruas', t: 'Prateleira (rua)' },
  { k: 'colunas', t: 'Coluna' }, { k: 'alturas', t: 'Altura (nível)' }, { k: 'curvas', t: 'Curva ABC', fmt: v => `Curva ${v}` }
];
const TIPOS = [['GERAL', 'Inventário geral do cliente'], ['CICLICO', 'Cíclico (Curva ABC)'], ['CHECK', 'Check de posições'], ['ESPECIAL', 'Especial / auditoria']];

export default function NovoInventario({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const cat = useCarregar<Catalogo>(() => rpc('inventario.catalogo'), []);
  const ops = useCarregar<{ id: string; nome: string }[]>(() => rpc('usuarios.operadores'), []);
  const user = useUser(); const [modoCheck, setModoCheck] = useState<'CONTAGEM' | 'PRESENCA'>('CONTAGEM'); const [modo, setModo] = useState<'agora' | 'agendar'>('agora'); const [inicio, setInicio] = useState(''); const [fim, setFim] = useState('');
  const [nome, setNome] = useState(''); const [tipo, setTipo] = useState('GERAL'); const [period, setPeriod] = useState('');
  const [sel, setSel] = useState<Record<Dim, Set<number>>>({ clientes: new Set(), galpoes: new Set(), ruas: new Set(), colunas: new Set(), alturas: new Set(), curvas: new Set() });
  const [skus, setSkus] = useState<Set<number>>(new Set()); const [codigos, setCodigos] = useState(''); const [busca, setBusca] = useState('');
  const [resp, setResp] = useState<string[]>([]); const [prog, setProg] = useState<number | null>(null); const [erro, setErro] = useState('');

  const c = cat.dados;
  const skuIdx = useMemo(() => { const m = new Map<string, number>(); c?.dims.skus.forEach((s, i) => m.set(s, i)); return m; }, [c]);

  // Códigos colados/digitados → índices; os não encontrados são avisados
  const colados = useMemo(() => {
    const lista = codigos.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    const ok: number[] = [], faltam: string[] = [];
    lista.forEach(x => { const i = skuIdx.get(x); i === undefined ? faltam.push(x) : ok.push(i); });
    return { ok, faltam };
  }, [codigos, skuIdx]);
  const todosSkus = useMemo(() => new Set<number>([...skus, ...colados.ok]), [skus, colados]);

  // Filtragem em cascata: cada grupo mostra só o que existe dado TODO o resto já escolhido
  const calc = useMemo(() => {
    if (!c) return null;
    const ativos = (ignorar: string) => {
      const f: [number, Set<number>][] = [];
      (Object.keys(sel) as Dim[]).forEach(k => { if (k !== ignorar && sel[k].size) f.push([COL[k], sel[k]]); });
      if (ignorar !== 'skus' && todosSkus.size) f.push([COL.skus, todosSkus]);
      return f;
    };
    const passa = (l: number[], f: [number, Set<number>][]) => { for (const [i, s] of f) if (!s.has(l[i])) return false; return true; };
    const cont: Record<string, Map<number, number>> = {};
    (Object.keys(sel) as Dim[]).forEach(k => {
      const f = ativos(k), m = new Map<number, number>();
      for (const l of c.linhas) if (passa(l, f)) m.set(l[COL[k]], (m.get(l[COL[k]]) || 0) + 1);
      cont[k] = m;
    });
    const fAll = ativos(''), pos = new Set<string>(); let unidades = 0; const skusDisp = new Map<number, number>();
    for (const l of c.linhas) if (passa(l, fAll)) { unidades++; pos.add(l[1] + '|' + l[2] + '|' + l[3] + '|' + l[4]); }
    const fSku = ativos('skus'); for (const l of c.linhas) if (passa(l, fSku)) skusDisp.set(l[6], (skusDisp.get(l[6]) || 0) + 1);
    return { cont, unidades, posicoes: pos.size, skusDisp };
  }, [c, sel, todosSkus]);

  const alternar = (k: Dim, i: number) => setSel(s => { const n = new Set(s[k]); n.has(i) ? n.delete(i) : n.add(i); return { ...s, [k]: n }; });
  const limpar = () => { setSel({ clientes: new Set(), galpoes: new Set(), ruas: new Set(), colunas: new Set(), alturas: new Set(), curvas: new Set() }); setSkus(new Set()); setCodigos(''); };
  const resultados = useMemo(() => {
    if (!c || !calc || busca.trim().length < 2) return [];
    const q = busca.trim().toUpperCase();
    return [...calc.skusDisp.keys()].filter(i => c.dims.skus[i].includes(q) && !todosSkus.has(i)).slice(0, 8);
  }, [c, calc, busca, todosSkus]);
  const algumFiltro = Object.values(sel).some(s => s.size) || todosSkus.size > 0;

  const criar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!c || !calc) return; setErro('');
    if (modo === 'agendar' && !inicio) { setErro('Escolha a data e hora de início do agendamento.'); return; } setProg(0);
    const v = (k: Dim) => [...sel[k]].map(i => c.dims[k][i]);
    try {
      const r = await rpc<{ id: string }>('inventario.criar', { nome, tipo, clientes: v('clientes'), galpoes: v('galpoes'), ruas: v('ruas'), colunas: v('colunas'), alturas: v('alturas'),
        curvas: v('curvas'), skus: [...todosSkus].map(i => c.dims.skus[i]), responsaveis: resp, periodicidade: period,
        inicio: modo === 'agendar' ? inicio : '', fim, modoCheck: tipo === 'CHECK' ? modoCheck : undefined });
      let off = 0;
      for (;;) {
        const x = await rpc<{ proximo: number; total: number; fim: boolean }>('inventario.prepararLote', { id: r.id, offset: off, limite: 3000 });
        off = x.proximo; setProg(Math.round((off / Math.max(x.total, 1)) * 100)); if (x.fim) break;
      }
      await rpc('inventario.publicar', { id: r.id });
      onCriado(); onClose();
    } catch (x) { setErro(msgErro(x)); setProg(null); }
  };

  return (
    <Modal titulo="Novo inventário" onClose={prog === null ? onClose : () => {}} largo>
      {cat.carregando ? <Carregando texto="Carregando a base ativa…" /> : cat.erro || !c || !calc ? <Alerta>{cat.erro}</Alerta> : (
        <form onSubmit={criar} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><label className="label">Nome do inventário</label><input className="input" value={nome} onChange={e => setNome(e.target.value)} required placeholder="ex.: Geral COT — Nov/2026" /></div>
            <div><label className="label">Tipo</label><select className="input" value={tipo} onChange={e => setTipo(e.target.value)}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
          </div>

          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 px-4 py-3 text-white shadow-lg">
            <div><div className="text-[11px] font-bold uppercase tracking-wider text-white/80">O que será inventariado (base {c.versao})</div>
              <div className="text-xl font-extrabold">{fmt(calc.unidades)} unidades · {fmt(calc.posicoes)} posições</div></div>
            {algumFiltro && <button type="button" className="btn bg-white/20 text-white hover:bg-white/30" onClick={limpar}>Limpar filtros</button>}
          </div>
          <p className="-mt-2 text-xs text-slate-500">Clique para escolher. Cada grupo mostra <b>somente o que existe</b> dentro do que você já escolheu, com a quantidade de unidades. Sem seleção = todos.</p>

          {DIMS.map(({ k, t, fmt: f }) => {
            const contagem = calc.cont[k]; const lista = c.dims[k].map((v, i) => ({ v, i, n: contagem.get(i) || 0 })).filter(o => o.n > 0 || sel[k].has(o.i));
            return (
              <div key={k}><label className="label">{t} {sel[k].size ? `· ${sel[k].size} selecionado(s)` : `· ${lista.length} disponíveis`}</label>
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
                  {lista.map(o => <button type="button" key={o.i} onClick={() => alternar(k, o.i)} className={`chip ${sel[k].has(o.i) ? (o.n ? 'chip-on' : 'chip-warn') : 'chip-off'}`}>{f ? f(o.v) : (o.v || '—')}<span className="opacity-70">{fmt(o.n)}</span></button>)}
                  {!lista.length && <span className="text-xs text-slate-400">Nada disponível com a combinação atual.</span>}
                </div></div>
            );
          })}

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="label">Código (SKU) — para inventariar somente estes</label>
            <div className="grid gap-3 md:grid-cols-2">
              <div><input className="input" placeholder="Buscar código… (mín. 2 letras)" value={busca} onChange={e => setBusca(e.target.value)} />
                {resultados.length > 0 && <div className="mt-2 space-y-1">{resultados.map(i => <button type="button" key={i} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"
                  onClick={() => { setSkus(s => new Set(s).add(i)); setBusca(''); }}><ProdutoFoto sku={c.dims.skus[i]} className="h-10 w-10" ampliar={false} /><span className="text-sm font-semibold">{c.dims.skus[i]}</span><span className="ml-auto text-xs text-slate-500">{fmt(calc.skusDisp.get(i) || 0)} un.</span></button>)}</div>}</div>
              <div><textarea className="input" rows={3} placeholder="Ou cole vários códigos (um por linha, ou separados por vírgula/espaço)" value={codigos} onChange={e => setCodigos(e.target.value)} />
                {colados.faltam.length > 0 && <div className="mt-1 text-xs font-semibold text-red-600">Não existem na base: {colados.faltam.slice(0, 6).join(', ')}{colados.faltam.length > 6 ? ` e mais ${colados.faltam.length - 6}` : ''}</div>}</div>
            </div>
            {todosSkus.size > 0 && <div className="mt-3 flex flex-wrap gap-2">{[...todosSkus].slice(0, 12).map(i => <span key={i} className="chip chip-on !pl-1">
              <ProdutoFoto sku={c.dims.skus[i]} className="h-6 w-6" ampliar={false} />{c.dims.skus[i]}{skus.has(i) && <button type="button" onClick={() => setSkus(s => { const n = new Set(s); n.delete(i); return n; })} aria-label="Remover">✕</button>}</span>)}
              {todosSkus.size > 12 && <span className="text-xs text-slate-500">+{todosSkus.size - 12} códigos</span>}</div>}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {tipo === 'CICLICO' && <div><label className="label">Periodicidade</label><input className="input" placeholder="ex.: A mensal, B trimestral, C semestral" value={period} onChange={e => setPeriod(e.target.value)} /></div>}
            {ops.dados && ops.dados.length > 0 && <div><label className="label">Operadores autorizados {resp.length ? `(${resp.length})` : '(todos)'}</label>
              <div className="flex flex-wrap gap-1.5">{ops.dados.map(o => { const on = resp.includes(o.id); return <button type="button" key={o.id} className={`chip ${on ? 'chip-on' : 'chip-off'}`} onClick={() => setResp(on ? resp.filter(x => x !== o.id) : [...resp, o.id])}>{o.nome}</button>; })}</div></div>}
          </div>

          {tipo === 'CHECK' && (user.perfil === 'ADMINISTRADOR' ? (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label className="label">Como será o check de posição?</label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`chip ${modoCheck === 'CONTAGEM' ? 'chip-on' : 'chip-off'}`} onClick={() => setModoCheck('CONTAGEM')}>Com contagem (código + quantidade)</button>
                <button type="button" className={`chip ${modoCheck === 'PRESENCA' ? 'chip-on' : 'chip-off'}`} onClick={() => setModoCheck('PRESENCA')}>Só ver se o código está lá</button>
              </div>
              <div className="text-xs text-slate-500">{modoCheck === 'PRESENCA' ? 'O operador só marca se encontrou cada código. Não digita quantidade. Código que não estava na posição vira inclusão.' : 'O operador marca se encontrou e digita a quantidade. Diferença de saldo gera divergência.'}</div>
            </div>
          ) : <div className="text-xs text-slate-500">Check com contagem (código + quantidade). Só o administrador pode criar check somente de presença.</div>)}

          <div className="rounded-xl border border-slate-200 p-3 space-y-3">
            <label className="label">Quando começa?</label>
            <div className="flex gap-2">
              <button type="button" className={`chip ${modo === 'agora' ? 'chip-on' : 'chip-off'}`} onClick={() => setModo('agora')}>Começar agora</button>
              <button type="button" className={`chip ${modo === 'agendar' ? 'chip-on' : 'chip-off'}`} onClick={() => setModo('agendar')}>Agendar para depois</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {modo === 'agendar' && <div><label className="label">Início (liga sozinho nessa hora)</label><input type="datetime-local" className="input" value={inicio} onChange={e => setInicio(e.target.value)} /></div>}
              <div><label className="label">Prazo / término previsto (opcional)</label><input type="datetime-local" className="input" value={fim} onChange={e => setFim(e.target.value)} /></div>
            </div>
          </div>

          {prog !== null && <div className="space-y-1"><div className="text-sm text-slate-600">Gravando a fotografia da base no Google Planilhas… {prog}%</div><Barra pct={prog} /></div>}
          {erro && <Alerta>{erro}</Alerta>}
          {calc.unidades === 0 && <Alerta tipo="aviso">Nenhuma unidade com essa combinação. Remova algum filtro marcado em vermelho.</Alerta>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={prog !== null}>Cancelar</button>
            <button className="btn btn-primary" disabled={prog !== null || calc.unidades === 0}>{modo === 'agendar' ? 'Agendar' : 'Criar e publicar'} ({fmt(calc.unidades)} un.)</button></div>
        </form>
      )}
    </Modal>
  );
}
