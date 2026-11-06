'use client';
import { useEffect, useRef, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Modal, Titulo, fmt, useCarregar } from './ui';
import ProdutoFoto from './ProdutoFoto';
import Lotes from './Lotes';

type Pos = { posicao: string; unidades: number; minha: boolean };
type Tarefa = { tarefaId: string; posicao: string; pendentes: number };

function Tela({ invId, tarefa, onSair }: { invId: string; tarefa: Tarefa; onSair: () => void }) {
  const [sku, setSku] = useState(''); const [qtd, setQtd] = useState(''); const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState<any>(null); const [erro, setErro] = useState(''); const [restantes, setRestantes] = useState(tarefa.pendentes);
  const [confZero, setConfZero] = useState<number | null>(null);
  const [prod, setProd] = useState<any>(null);
  const skuRef = useRef<HTMLInputElement>(null); const qtdRef = useRef<HTMLInputElement>(null);
  useEffect(() => { skuRef.current?.focus(); }, []);

  const consultar = async () => {
    if (!sku.trim()) return;
    setProd(null); setRes(null); setErro('');
    try { setProd(await rpc<any>('contagem.produto', { tarefaId: tarefa.tarefaId, sku })); } catch (e) { setErro(msgErro(e)); }
    qtdRef.current?.focus();
  };
  const lancar = async () => {
    if (!sku.trim() || qtd === '') { setErro('Bipe o SKU e informe a quantidade.'); return; }
    setErro(''); setRes(null); setOcupado(true);
    try {
      const r = await rpc<any>('contagem.lancar', { tarefaId: tarefa.tarefaId, sku, qtd });
      setRes(r); setRestantes(r.restantes); setSku(''); setQtd(''); setProd(null);
    } catch (e) { setErro(msgErro(e)); } finally { setOcupado(false); setTimeout(() => skuRef.current?.focus(), 50); }
  };
  const concluir = async (confirmar = false) => {
    setErro(''); setOcupado(true);
    try {
      const r = await rpc<any>('contagem.concluir', { tarefaId: tarefa.tarefaId, confirmarZero: confirmar });
      if (r.exigeConfirmacao) setConfZero(r.pendentes); else onSair();
    } catch (e) { setErro(msgErro(e)); } finally { setOcupado(false); }
  };
  const liberar = async () => { if (!confirm('Liberar esta posição para outro operador? O que já foi lançado fica registrado.')) return; try { await rpc('contagem.liberar', { tarefaId: tarefa.tarefaId }); onSair(); } catch (e) { setErro(msgErro(e)); } };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="card flex items-center justify-between"><div><div className="label !mb-0">Posição</div><div className="grad-text text-4xl font-extrabold">{tarefa.posicao}</div></div>
        <div className="text-right"><div className="label !mb-0">Itens a lançar</div><div className="text-3xl font-extrabold">{restantes}</div></div></div>
      <div className="card space-y-4">
        <div><label className="label" htmlFor="sku">SKU (bipe o código)</label>
          <input id="sku" ref={skuRef} className="input !py-4 !text-xl" value={sku} onChange={e => { setSku(e.target.value); setProd(null); }} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), consultar())} autoComplete="off" autoCapitalize="characters" inputMode="text" /></div>
        {prod && (
          <div className={`flex gap-4 rounded-2xl p-3 ring-1 ${prod.pertence ? 'bg-emerald-50/70 ring-emerald-200' : 'bg-amber-50 ring-amber-300'}`}>
            <ProdutoFoto sku={prod.sku} className="h-28 w-28" />
            <div className="min-w-0 space-y-1 text-sm">
              <div className="text-lg font-extrabold leading-tight">{prod.sku}</div><div className="text-slate-700">{prod.descricao || 'Produto sem cadastro na base'}</div>
              {prod.cliente && <div className="text-xs text-slate-500">Cliente {prod.cliente}{prod.codigoBarras ? ` · cód. ${prod.codigoBarras}` : ''}</div>}
              <Lotes lotes={prod.lotes} grande />
              {!prod.pertence && <div className="font-bold text-amber-800">Produto não cadastrado nesta posição. Inclusão identificada.</div>}
            </div>
          </div>
        )}
        <div><label className="label" htmlFor="qtd">Quantidade física</label>
          <input id="qtd" ref={qtdRef} className="input !py-4 !text-xl" value={qtd} onChange={e => setQtd(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), lancar())} inputMode="numeric" autoComplete="off" /></div>
        <button className="btn btn-primary btn-lg w-full" disabled={ocupado} onClick={lancar}>{ocupado ? 'Gravando…' : 'Confirmar lançamento'}</button>
      </div>
      {erro && <Alerta>{erro}</Alerta>}
      {res?.tipo === 'CONTAGEM' && <Alerta tipo="ok">{res.mensagem}</Alerta>}
      {res?.tipo === 'INCLUSAO' && (
        <div className="card space-y-1 border-amber-300 bg-amber-50"><div className="font-bold text-amber-900">{res.mensagem}</div>
          <dl className="grid grid-cols-2 gap-1 text-sm"><dt className="text-slate-500">SKU</dt><dd className="font-semibold">{res.detalhe.sku}</dd><dt className="text-slate-500">Descrição</dt><dd>{res.detalhe.descricao || '—'}</dd>
            <dt className="text-slate-500">Código de barras</dt><dd>{res.detalhe.codigoBarras || '—'}</dd><dt className="text-slate-500">Quantidade física</dt><dd>{fmt(res.detalhe.qtd)}</dd>
            <dt className="text-slate-500">Posição encontrada</dt><dd>{res.detalhe.posicao}</dd><dt className="text-slate-500">Cliente</dt><dd>{res.detalhe.cliente || '—'}</dd>
            <dt className="text-slate-500">Cadastrado também em</dt><dd>{res.detalhe.outrasPosicoes.join(', ') || 'nenhuma posição'}</dd></dl></div>)}
      <div className="grid grid-cols-2 gap-3"><button className="btn btn-secondary btn-lg" disabled={ocupado} onClick={liberar}>Liberar posição</button><button className="btn btn-primary btn-lg" disabled={ocupado} onClick={() => concluir(false)}>Concluir posição</button></div>
      {confZero !== null && <Modal titulo="Concluir posição" onClose={() => setConfZero(null)}>
        <p className="mb-4 text-sm">Ainda há <b>{confZero}</b> item(ns) não lido(s). Ao concluir, eles serão lançados com <b>quantidade 0</b> (não encontrados). Confirma?</p>
        <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setConfZero(null)}>Voltar e continuar</button><button className="btn btn-danger" onClick={() => concluir(true)}>Confirmar zeros e concluir</button></div></Modal>}
    </div>
  );
}

export const NOME_TIPO: Record<string, string> = { GERAL: 'Inventário geral', CICLICO: 'Inventário cíclico', ESPECIAL: 'Inventário especial', CHECK: 'Check de posição' };

export default function Contagem({ tipo }: { tipo?: string }) {
  const invs = useCarregar<{ id: string; nome: string; tipo: string }[]>(() => rpc<{ id: string; nome: string; tipo: string }[]>('contagem.inventarios').then(l => (tipo ? l.filter(i => i.tipo === tipo) : l)), [tipo]);
  const [invId, setInvId] = useState(''); const [tarefa, setTarefa] = useState<Tarefa | null>(null);
  const [alvo, setAlvo] = useState<Pos | null>(null); const [leitura, setLeitura] = useState(''); const [erro, setErro] = useState(''); const [env, setEnv] = useState(false);
  const [filtro, setFiltro] = useState('');
  useEffect(() => { if (invs.dados?.length === 1 && !invId) setInvId(invs.dados[0].id); }, [invs.dados, invId]);
  const pos = useCarregar<{ posicoes: Pos[]; total: number; minhaTarefa: { tarefaId: string; posicao: string } | null }>(
    () => (invId && !tarefa ? rpc('contagem.posicoes', { invId }) : Promise.resolve({ posicoes: [], total: 0, minhaTarefa: null })), [invId, tarefa], 10000);

  if (invs.carregando) return <Carregando />;
  if (invs.erro) return <Alerta>{invs.erro}</Alerta>;
  if (tarefa) return <Tela invId={invId} tarefa={tarefa} onSair={() => { setTarefa(null); pos.recarregar(); }} />;

  const assumir = async (e: React.FormEvent) => {
    e.preventDefault(); if (!alvo) return; setErro(''); setEnv(true);
    try { const t = await rpc<Tarefa>('contagem.assumir', { invId, posicao: alvo.posicao, leitura }); setTarefa(t); setAlvo(null); setLeitura(''); }
    catch (x) { setErro(msgErro(x)); pos.recarregar(); } finally { setEnv(false); }
  };
  const lista = (pos.dados?.posicoes || []).filter(p => p.posicao.toLowerCase().includes(filtro.toLowerCase()));
  const retomar = pos.dados?.minhaTarefa;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Titulo>{tipo ? NOME_TIPO[tipo] || 'Contagem' : 'Contagem'}</Titulo>
      {!invs.dados?.length ? <Alerta tipo="info">{tipo ? 'Nenhum inventário ativo deste tipo para você no momento.' : 'Nenhum inventário ativo disponível para você no momento. Use os tipos no menu ao lado.'}</Alerta> : (
        <div><label className="label">Inventário</label><select className="input" value={invId} onChange={e => setInvId(e.target.value)}><option value="">Selecione…</option>{invs.dados.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}</select></div>
      )}
      {retomar && <div className="card flex items-center justify-between border-brand-500"><div><div className="font-bold">Você tem uma posição em andamento: {retomar.posicao}</div></div>
        <button className="btn btn-primary" onClick={() => setTarefa({ tarefaId: retomar.tarefaId, posicao: retomar.posicao, pendentes: (pos.dados?.posicoes.find(p => p.posicao === retomar.posicao)?.unidades) || 0 })}>Continuar</button></div>}
      {invId && (pos.carregando ? <Carregando /> : pos.erro ? <Alerta>{pos.erro}</Alerta> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3"><input className="input max-w-xs" placeholder="Filtrar posição…" value={filtro} onChange={e => setFiltro(e.target.value)} /><span className="text-sm text-slate-500">{fmt(pos.dados!.total)} posições disponíveis</span></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {lista.map(p => <button key={p.posicao} onClick={() => { setAlvo(p); setErro(''); }} className={`rounded-xl border p-4 text-left shadow-sm hover:border-brand-500 ${p.minha ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'}`}>
              <div className="text-xl font-extrabold">{p.posicao}</div><div className="text-xs text-slate-500">{p.unidades} item(ns){p.minha ? ' · sua reserva' : ''}</div></button>)}
          </div>
          {!lista.length && <Alerta tipo="info">Nenhuma posição disponível. A lista atualiza sozinha a cada 10 segundos.</Alerta>}
        </div>
      ))}
      {alvo && <Modal titulo={`Posição ${alvo.posicao}`} onClose={() => setAlvo(null)}>
        <form onSubmit={assumir} className="space-y-3"><p className="text-sm text-slate-600">Vá até a posição e <b>bipe o código</b> para assumir a tarefa. Ela ficará reservada para você.</p>
          <input className="input !py-4 !text-xl" autoFocus value={leitura} onChange={e => setLeitura(e.target.value)} placeholder="Bipe a posição" autoComplete="off" />
          {erro && <Alerta>{erro}</Alerta>}
          <button className="btn btn-primary btn-lg w-full" disabled={env || !leitura}>{env ? 'Reservando…' : 'Assumir posição'}</button></form></Modal>}
    </div>
  );
}
