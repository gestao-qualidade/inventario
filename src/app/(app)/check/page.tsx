'use client';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Titulo, useCarregar } from '@/components/ui';

type Item = { sku: string; descricao: string; cliente: string; codigoBarras: string; encontrado: boolean; qtd: string };

export default function Check() {
  const invs = useCarregar<{ id: string; nome: string; modo: string }[]>(() => rpc('check.inventarios'), []);
  const [invId, setInvId] = useState(''); const [posicao, setPosicao] = useState(''); const [itens, setItens] = useState<Item[] | null>(null);
  const [incl, setIncl] = useState<{ sku: string; qtd: string }[]>([]); const [erro, setErro] = useState(''); const [ok, setOk] = useState(''); const [env, setEnv] = useState(false);
  const [modo, setModo] = useState('CONTAGEM'); const presenca = modo === 'PRESENCA';

  const abrir = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setOk(''); setEnv(true);
    try { const r = await rpc<{ posicao: string; modo: string; itens: Omit<Item, 'encontrado' | 'qtd'>[] }>('check.esperados', { invId, posicao, leitura: posicao }); setPosicao(r.posicao); setModo(r.modo); setItens(r.itens.map(i => ({ ...i, encontrado: false, qtd: '' }))); setIncl([]); }
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
      {!itens ? (
        <form onSubmit={abrir} className="card space-y-3">
          <div><label className="label">Inventário (check)</label><select className="input" value={invId} onChange={e => setInvId(e.target.value)} required><option value="">Selecione…</option>{invs.dados?.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}</select></div>
          <div><label className="label">Posição (bipe)</label><input className="input !py-3 !text-lg" value={posicao} onChange={e => setPosicao(e.target.value)} required autoComplete="off" /></div>
          {erro && <Alerta>{erro}</Alerta>}
          <button className="btn btn-primary btn-lg w-full" disabled={env}>Abrir posição</button>
          {!invs.dados?.length && <Alerta tipo="info">Nenhum inventário do tipo check ativo.</Alerta>}
        </form>
      ) : (
        <div className="space-y-3">
          <div className="card"><div className="label !mb-0">Posição {presenca && '· só presença (sem quantidade)'}</div><div className="text-3xl font-extrabold text-brand-700">{posicao}</div></div>
          {itens.map((it, n) => (
            <div key={it.sku} className="card space-y-2"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{it.sku}</div><div className="text-xs text-slate-500">{it.descricao} · {it.cliente}{it.codigoBarras ? ` · cód. ${it.codigoBarras}` : ''}</div></div>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={it.encontrado} onChange={e => setItens(itens.map((x, j) => j === n ? { ...x, encontrado: e.target.checked } : x))} />Encontrado</label></div>
              {it.encontrado && !presenca && <input className="input" inputMode="numeric" placeholder="Quantidade física" value={it.qtd} onChange={e => setItens(itens.map((x, j) => j === n ? { ...x, qtd: e.target.value.replace(/\D/g, '') } : x))} />}</div>
          ))}
          <div className="card space-y-2"><div className="flex items-center justify-between"><h3 className="font-bold">Produtos que não pertencem à posição</h3><button className="btn btn-secondary" onClick={() => setIncl([...incl, { sku: '', qtd: '' }])}>+ Adicionar</button></div>
            {incl.map((x, n) => <div key={n} className="flex gap-2"><input className="input" placeholder="SKU" value={x.sku} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, sku: e.target.value } : y))} />{!presenca && <input className="input max-w-[8rem]" inputMode="numeric" placeholder="Qtd" value={x.qtd} onChange={e => setIncl(incl.map((y, j) => j === n ? { ...y, qtd: e.target.value.replace(/\D/g, '') } : y))} />}<button className="text-red-600" onClick={() => setIncl(incl.filter((_, j) => j !== n))}>✕</button></div>)}</div>
          {erro && <Alerta>{erro}</Alerta>}
          <div className="grid grid-cols-2 gap-3"><button className="btn btn-secondary btn-lg" onClick={() => setItens(null)}>Cancelar</button><button className="btn btn-primary btn-lg" disabled={env || (!presenca && itens.some(i => i.encontrado && i.qtd === ''))} onClick={registrar}>{env ? 'Gravando…' : 'Registrar check'}</button></div>
        </div>
      )}
    </div>
  );
}
