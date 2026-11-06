'use client';
import { useEffect, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Titulo, fmt, useCarregar } from '@/components/ui';
import ProdutoFoto from '@/components/ProdutoFoto';
import Lotes, { mascaraData } from '@/components/Lotes';

type Item = { sku: string; descricao: string; cliente: string; codigoBarras: string; lotes?: { lote: string; validade: string }[]; encontrado: boolean; qtd: string };

export default function Check() {
  const invs = useCarregar<{ id: string; nome: string; modo: string }[]>(() => rpc('check.inventarios'), []);
  const [invId, setInvId] = useState(''); const [posicao, setPosicao] = useState(''); const [itens, setItens] = useState<Item[] | null>(null);
  const [incl, setIncl] = useState<{ sku: string; qtd: string; lote: string; validade: string }[]>([]); const [erro, setErro] = useState(''); const [ok, setOk] = useState(''); const [env, setEnv] = useState(false);
  const [modo, setModo] = useState('CONTAGEM'); const presenca = modo === 'PRESENCA';
  const [alvo, setAlvo] = useState(''); const [filtro, setFiltro] = useState('');
  const lista = useCarregar<{ posicoes: { posicao: string; itens: number }[]; pendentes: number; total: number; feitas: number }>(
    () => (invId ? rpc('check.posicoes', { invId }) : Promise.resolve({ posicoes: [], pendentes: 0, total: 0, feitas: 0 })), [invId, itens === null], 15000);
  useEffect(() => { if (invs.dados?.length === 1 && !invId) setInvId(invs.dados[0].id); }, [invs.dados, invId]);
  useEffect(() => { setAlvo(''); setPosicao(''); }, [invId]);

  const abrir = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setOk(''); setEnv(true);
    try { const r = await rpc<{ posicao: string; modo: string; itens: Omit<Item, 'encontrado' | 'qtd'>[] }>('check.esperados', { invId, posicao: alvo || posicao, leitura: posicao }); setPosicao(r.posicao); setAlvo(''); setModo(r.modo); setItens(r.itens.map(i => ({ ...i, encontrado: false, qtd: '' }))); setIncl([]); }
    catch (x) { setErro(msgErro(x)); } finally { setEnv(false); }
  };
  const registrar = async () => {
    setErro(''); setEnv(true);
    try {
      const r = await rpc<{ mensagem: string }>('check.registrar', { invId, posicao, itens: itens!.map(i => ({ sku: i.sku, encontrado: i.encontrado, qtd: i.encontrado ? i.qtd : 0 })), inclusoes: incl.filter(i => i.sku && (presenca || i.qtd)) });
      setOk(r.mensagem); setItens(null); setPosicao('');
    } catch (x) { setErro(msgErro(x)); } finally { setEnv(false); }
  };
  if (invs.carregando) return <Carregando />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Titulo>Check de posição</Titulo>
      {ok && <Alerta tipo="ok">{ok}</Alerta>}
      {!itens ? (<>
        <form onSubmit={abrir} className="card space-y-3">
          <div><label className="label">Inventário (check)</label><select className="input" value={invId} onChange={e => setInvId(e.target.value)} required><option value="">Selecione…</option>{invs.dados?.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}</select></div>
          <div><label className="label">{alvo ? <>Posição escolhida: <b className="text-brand-700">{alvo}</b> — bipe ou digite a posição para confirmar</> : 'Posição (bipe)'}</label><input className="input !py-3 !text-lg" value={posicao} onChange={e => setPosicao(e.target.value)} required autoComplete="off" /></div>
          {erro && <Alerta>{erro}</Alerta>}
          <button className="btn btn-primary btn-lg w-full" disabled={env}>Abrir posição</button>
          {!invs.dados?.length && <Alerta tipo="info">Nenhum inventário do tipo check ativo.</Alerta>}
        </form>
        {invId && <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Posições para conferir</h3>
            {lista.dados && <span className="text-sm text-slate-500"><b className="text-red-600">{fmt(lista.dados.pendentes)}</b> pendentes · {fmt(lista.dados.feitas)} de {fmt(lista.dados.total)} conferidas</span>}</div>
          {lista.dados && lista.dados.total > 0 && <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500" style={{ width: `${(lista.dados.feitas / lista.dados.total) * 100}%` }} /></div>}
          <input className="input max-w-xs" placeholder="Filtrar posição…" value={filtro} onChange={e => setFiltro(e.target.value)} />
          {lista.carregando ? <Carregando /> : lista.erro ? <Alerta>{lista.erro}</Alerta> : !lista.dados?.posicoes.length ? <Alerta tipo="ok">Todas as posições deste check já foram conferidas.</Alerta> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {lista.dados.posicoes.filter(x => x.posicao.toLowerCase().includes(filtro.toLowerCase())).map(x => (
                <button key={x.posicao} type="button" onClick={() => { setAlvo(x.posicao); setPosicao(''); setErro(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className={`rounded-xl border p-3 text-left transition hover:border-brand-500 ${alvo === x.posicao ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500' : 'border-slate-200 bg-white'}`}>
                  <div className="text-lg font-extrabold">{x.posicao}</div><div className="text-xs text-slate-500">{x.itens} item(ns)</div></button>))}
            </div>)}
          {lista.dados && lista.dados.pendentes > 400 && <div className="text-xs text-slate-500">Mostrando as primeiras 400. Conferidas saem da lista.</div>}
        </div>}
      </>) : (
        <div className="space-y-3">
          <div className="card"><div className="label !mb-0">Posição {presenca && '· só presença (sem quantidade)'}</div><div className="text-3xl font-extrabold text-brand-700">{posicao}</div></div>
          {itens.map((it, n) => (
            <div key={it.sku} className="card space-y-2"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><ProdutoFoto sku={it.sku} className="h-20 w-20" /><div><div className="font-bold">{it.sku}</div><div className="text-xs text-slate-500">{it.descricao} · {it.cliente}{it.codigoBarras ? ` · cód. ${it.codigoBarras}` : ''}</div><div className="mt-1"><Lotes lotes={it.lotes} grande /></div></div></div>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={it.encontrado} onChange={e => setItens(itens.map((x, j) => j === n ? { ...x, encontrado: e.target.checked } : x))} />Encontrado</label></div>
              {it.encontrado && !presenca && <input className="input" inputMode="numeric" placeholder="Quantidade física" value={it.qtd} onChange={e => setItens(itens.map((x, j) => j === n ? { ...x, qtd: e.target.value.replace(/\D/g, '') } : x))} />}</div>
          ))}
          <div className="card space-y-2"><div className="flex items-center justify-between"><h3 className="font-bold">Produtos que não pertencem à posição</h3><button className="btn btn-secondary" onClick={() => setIncl([...incl, { sku: '', qtd: '', lote: '', validade: '' }])}>+ Adicionar</button></div>
            {incl.map((x, n) => <div key={n} className="space-y-2 rounded-xl border border-slate-200 p-2"><div className="flex items-center gap-2">{x.sku.trim().length >= 4 && <ProdutoFoto key={x.sku} sku={x.sku} className="h-12 w-12" />}<input className="input min-w-0 flex-1" placeholder="SKU" value={x.sku} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, sku: e.target.value } : y))} />{!presenca && <input className="input max-w-[8rem]" inputMode="numeric" placeholder="Qtd" value={x.qtd} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, qtd: e.target.value.replace(/\D/g, '') } : y))} />}<button className="text-red-600" onClick={() => setIncl(incl.filter((_, j) => j !== n))}>✕</button></div>
              <div className="grid grid-cols-2 gap-2"><input className="input w-full" placeholder="Lote" value={x.lote} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, lote: e.target.value } : y))} />
              <input className="input w-full" inputMode="numeric" placeholder="Validade DD/MM/AAAA" value={x.validade} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, validade: mascaraData(e.target.value) } : y))} /></div></div>)}</div>
          {erro && <Alerta>{erro}</Alerta>}
          <div className="grid grid-cols-2 gap-3"><button className="btn btn-secondary btn-lg" onClick={() => setItens(null)}>Cancelar</button><button className="btn btn-primary btn-lg" disabled={env || (!presenca && itens.some(i => i.encontrado && i.qtd === ''))} onClick={registrar}>{env ? 'Gravando…' : 'Registrar check'}</button></div>
        </div>
      )}
    </div>
  );
}
