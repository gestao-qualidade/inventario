'use client';
import { useEffect, useMemo, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Kpi, Modal, Titulo, fmt, useCarregar, useUser } from '@/components/ui';
import ProdutoFoto from '@/components/ProdutoFoto';

type Item = { id: string; origem: 'DIVERGENCIA' | 'INCLUSAO'; invId: string; inventario: string; cliente: string; sku: string; posicao: string; rua: string; tipo: string; saldo: number | ''; final: number | '';
  diferenca: number | ''; valor: number | ''; status: string; acao: string; decisao: string; responsavel: string; prazo: string; criadoEm: string; decididoEm: string };
type Lista = { itens: Item[]; decisoes: { id: string; rotulo: string }[]; aprovacaoMin: number };

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  PENDENTE_TRATATIVA: { rotulo: 'Pendente', cor: 'bg-red-100 text-red-700' }, EM_ANALISE: { rotulo: 'Em análise', cor: 'bg-amber-100 text-amber-800' },
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', cor: 'bg-violet-100 text-violet-800' }, DECIDIDA: { rotulo: 'Decidida', cor: 'bg-blue-100 text-blue-800' },
  EXECUTADA: { rotulo: 'Executada', cor: 'bg-cyan-100 text-cyan-800' }, FECHADA: { rotulo: 'Fechada', cor: 'bg-emerald-100 text-emerald-800' }
};
const TIPO: Record<string, string> = { FALTA: 'Falta', SOBRA: 'Sobra', INCLUSAO: 'Inclusão' };
const ABERTAS = ['PENDENTE_TRATATIVA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO'];
const brl = (v: number | '') => (v === '' ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dtBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');
const PAG = 40;

export default function Divergencias() {
  const user = useUser();
  const { dados, erro, carregando, recarregar } = useCarregar<Lista>(() => rpc('diverg.listar'), []);
  const [fStatus, setFStatus] = useState('ABERTAS'); const [fInv, setFInv] = useState(''); const [fTipo, setFTipo] = useState(''); const [fCli, setFCli] = useState(''); const [busca, setBusca] = useState('');
  const [pag, setPag] = useState(0); const [aberto, setAberto] = useState<Item | null>(null);
  useEffect(() => { const q = new URLSearchParams(location.search).get('inv'); if (q) setFInv(q); }, []);
  useEffect(() => { setPag(0); }, [fStatus, fInv, fTipo, fCli, busca]);

  const itens = dados?.itens || [];
  const invs = useMemo(() => { const m = new Map<string, string>(); itens.forEach(i => m.set(i.invId, i.inventario)); return [...m.entries()]; }, [itens]);
  const clientes = useMemo(() => [...new Set(itens.map(i => i.cliente).filter(Boolean))].sort(), [itens]);
  const filtrados = useMemo(() => itens.filter(i =>
    (fStatus === 'TODOS' || (fStatus === 'ABERTAS' ? ABERTAS.includes(i.status) : i.status === fStatus)) && (!fInv || i.invId === fInv) && (!fTipo || i.tipo === fTipo) && (!fCli || i.cliente === fCli) &&
    (!busca.trim() || (i.sku + ' ' + i.posicao).toUpperCase().includes(busca.trim().toUpperCase()))), [itens, fStatus, fInv, fTipo, fCli, busca]);

  const hoje = new Date().toLocaleDateString('pt-BR');
  const cont = (s: string) => itens.filter(i => i.status === s).length;
  const abertas = itens.filter(i => ABERTAS.includes(i.status));
  const soma = (f: (v: number) => boolean) => abertas.reduce((s, i) => (typeof i.valor === 'number' && f(i.valor) ? s + i.valor : s), 0);
  const decididasHoje = itens.filter(i => i.decididoEm.startsWith(hoje)).length;

  const exportar = async () => {
    const XLSX = await import('xlsx');
    const linhas = filtrados.map(i => ({ Status: STATUS[i.status]?.rotulo || i.status, Tipo: TIPO[i.tipo] || i.tipo, Inventário: i.inventario, Cliente: i.cliente, SKU: i.sku, Posição: i.posicao,
      'Saldo sistema': i.saldo, 'Qtd contada': i.final, Diferença: i.diferenca, 'Valor (R$)': i.valor, 'Ação sugerida pela matriz': i.acao, Decisão: dados?.decisoes.find(d => d.id === i.decisao)?.rotulo || '', Responsável: i.responsavel, Prazo: dtBR(i.prazo), 'Criada em': i.criadoEm, 'Decidida em': i.decididoEm }));
    const ws = XLSX.utils.json_to_sheet(linhas); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Divergências');
    XLSX.writeFile(wb, `divergencias_${hoje.replace(/\//g, '-')}.xlsx`);
  };

  if (carregando) return <Carregando texto="Carregando divergências…" />;
  if (erro || !dados) return <Alerta>{erro}</Alerta>;
  const total = filtrados.length, pags = Math.max(1, Math.ceil(total / PAG)), vis = filtrados.slice(pag * PAG, pag * PAG + PAG);
  return (
    <div className="space-y-4">
      <Titulo acao={<div className="flex gap-2"><button className="btn btn-secondary" onClick={exportar}>Exportar Excel</button><button className="btn btn-secondary" onClick={recarregar}>Atualizar</button></div>}>Divergências</Titulo>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Pendentes" valor={fmt(cont('PENDENTE_TRATATIVA'))} cor="text-red-600" />
        <Kpi rotulo="Em análise" valor={fmt(cont('EM_ANALISE'))} cor="text-amber-600" />
        <Kpi rotulo="Aguardando aprovação" valor={fmt(cont('AGUARDANDO_APROVACAO'))} cor="text-violet-600" />
        <Kpi rotulo="Decididas hoje" valor={fmt(decididasHoje)} cor="text-blue-600" />
        <Kpi rotulo="Faltas em aberto" valor={brl(soma(v => v < 0))} cor="text-red-600" />
        <Kpi rotulo="Sobras em aberto" valor={brl(soma(v => v > 0))} cor="text-amber-600" />
      </div>
      <div className="card !p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {[['ABERTAS', 'Em aberto'], ['PENDENTE_TRATATIVA', 'Pendentes'], ['EM_ANALISE', 'Em análise'], ['AGUARDANDO_APROVACAO', 'Aguardando aprovação'], ['DECIDIDA', 'Decididas'], ['EXECUTADA', 'Executadas'], ['FECHADA', 'Fechadas'], ['TODOS', 'Todas']].map(([k, t]) =>
            <button key={k} className={`chip ${fStatus === k ? 'chip-on' : 'chip-off'}`} onClick={() => setFStatus(k)}>{t}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Inventário</div><select className="input !w-auto" value={fInv} onChange={e => setFInv(e.target.value)}><option value="">Todos</option>{invs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Tipo</div><select className="input !w-auto" value={fTipo} onChange={e => setFTipo(e.target.value)}><option value="">Todos</option><option value="FALTA">Falta</option><option value="SOBRA">Sobra</option><option value="INCLUSAO">Inclusão</option></select></div>
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Cliente</div><select className="input !w-auto" value={fCli} onChange={e => setFCli(e.target.value)}><option value="">Todos</option>{clientes.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Código ou posição</div><input className="input !w-52" placeholder="ex.: HYPMMK0120 ou A.01.1" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          <div className="ml-auto text-sm text-slate-500">{fmt(total)} resultado(s)</div>
        </div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Status</th><th className="th">Tipo</th><th className="th">Produto</th><th className="th">Posição</th><th className="th text-right">Sistema</th><th className="th text-right">Contado</th><th className="th text-right">Dif.</th><th className="th text-right">Valor</th><th className="th">Ação sugerida</th><th className="th">Decisão / responsável</th><th className="th" /></tr></thead><tbody>
          {vis.map(i => (
            <tr key={i.origem + i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setAberto(i)}>
              <td className="td"><span className={`badge ${STATUS[i.status]?.cor || ''}`}>{STATUS[i.status]?.rotulo || i.status}</span></td>
              <td className="td font-semibold">{TIPO[i.tipo] || i.tipo}</td>
              <td className="td"><div className="flex items-center gap-2"><ProdutoFoto sku={i.sku} className="h-9 w-9" /><div><div className="font-semibold">{i.sku}</div><div className="text-xs text-slate-500">{i.cliente} · {i.inventario}</div></div></div></td>
              <td className="td">{i.posicao}</td><td className="td text-right">{i.saldo === '' ? '—' : fmt(i.saldo)}</td><td className="td text-right">{i.final === '' ? '—' : fmt(i.final)}</td>
              <td className={`td text-right font-bold ${typeof i.diferenca === 'number' && i.diferenca < 0 ? 'text-red-600' : 'text-amber-600'}`}>{i.diferenca === '' ? '—' : (i.diferenca > 0 ? '+' : '') + fmt(i.diferenca)}</td>
              <td className="td text-right">{brl(i.valor)}</td><td className="td max-w-[14rem] text-xs text-slate-600">{i.acao || '—'}</td>
              <td className="td text-xs">{i.decisao ? <><div className="font-semibold">{dados.decisoes.find(d => d.id === i.decisao)?.rotulo}</div><div className="text-slate-500">{i.responsavel}{i.prazo ? ` · até ${dtBR(i.prazo)}` : ''}</div></> : '—'}</td>
              <td className="td text-right"><button className="text-xs font-semibold text-brand-600 underline">Abrir</button></td></tr>))}
          {!vis.length && <tr><td className="td text-slate-500" colSpan={11}>Nenhuma divergência com esses filtros. 🎉</td></tr>}
        </tbody></table></div>
        {pags > 1 && <div className="flex items-center justify-end gap-2 text-sm"><button className="btn btn-secondary" disabled={pag === 0} onClick={() => setPag(pag - 1)}>← Anterior</button><span>Página {pag + 1} de {pags}</span><button className="btn btn-secondary" disabled={pag >= pags - 1} onClick={() => setPag(pag + 1)}>Próxima →</button></div>}
      </div>
      {aberto && <Detalhe item={aberto} lista={dados} perfil={user.perfil} nome={user.nome} onClose={() => setAberto(null)} onMudou={() => { setAberto(null); recarregar(); }} />}
    </div>
  );
}

function Detalhe({ item, lista, perfil, nome, onClose, onMudou }: { item: Item; lista: Lista; perfil: string; nome: string; onClose: () => void; onMudou: () => void }) {
  const { dados: d, erro, carregando, recarregar } = useCarregar<any>(() => rpc('diverg.detalhe', { id: item.id, origem: item.origem }), [item.id]);
  const [decisao, setDecisao] = useState(''); const [just, setJust] = useState(''); const [resp, setResp] = useState(nome); const [prazo, setPrazo] = useState('');
  const [ref, setRef] = useState(''); const [obs, setObs] = useState(''); const [msg, setMsg] = useState(''); const [env, setEnv] = useState(false);
  const podeDecidir = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'ANALISTA'].includes(perfil), podeAprovar = ['ADMINISTRADOR', 'GESTOR'].includes(perfil);
  const chamar = async (acao: string, payload: any, fecha = true) => {
    setMsg(''); setEnv(true);
    try { await rpc(acao, { id: item.id, origem: item.origem, ...payload }); fecha ? onMudou() : recarregar(); } catch (e) { setMsg(msgErro(e)); } finally { setEnv(false); }
  };
  if (carregando) return <Modal titulo="Divergência" onClose={onClose} largo><Carregando /></Modal>;
  if (erro || !d) return <Modal titulo="Divergência" onClose={onClose} largo><Alerta>{erro}</Alerta></Modal>;
  const st = d.status as string; const decisoes = lista.decisoes.filter(x => x.id !== 'RECONTAR' || d.podeRecontar);
  const nomeDecisao = (id: string) => lista.decisoes.find(x => x.id === id)?.rotulo || id;
  const sim = (v: string) => v === 'SIM';
  return (
    <Modal titulo={`${TIPO[d.tipo] || d.tipo} — ${d.sku}`} onClose={onClose} largo>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start gap-4">
          <ProdutoFoto sku={d.sku} className="h-24 w-24" />
          <div className="min-w-[14rem] flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className={`badge ${STATUS[st]?.cor || ''}`}>{STATUS[st]?.rotulo || st}</span><span className="text-xs text-slate-500">{d.inventario}</span></div>
            <div className="mt-1 text-lg font-extrabold">{d.sku} <span className="text-sm font-semibold text-slate-500">· {d.cliente}</span></div>
            <div className="text-sm text-slate-600">{d.produto?.descricao}</div>
            <div className="mt-1 text-sm">Posição <b>{d.posicao}</b>{d.produto?.galpao ? ` · ${d.produto.galpao}` : ''}{d.produto?.curva ? ` · curva ${d.produto.curva}` : ''}{d.produto?.familia ? ` · ${d.produto.familia}` : ''}</div>
            {d.produto?.lotes?.length > 0 && <div className="text-xs text-slate-500">Lote/validade: {d.produto.lotes.map((l: any) => `${l.lote || 's/ lote'}${l.validade ? ' · ' + l.validade : ''}`).join(' | ')}</div>}
          </div>
          {d.origem === 'DIVERGENCIA' ? (
            <div className="grid grid-cols-4 gap-3 text-center">
              {[['Sistema', fmt(d.saldo)], ['Contado', fmt(d.final)], ['Diferença', (d.diferenca > 0 ? '+' : '') + fmt(d.diferenca)], ['Valor', brl(d.valor)]].map(([r, v]) => <div key={r} className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-[10px] font-bold uppercase text-slate-500">{r}</div><div className={`text-lg font-extrabold ${r === 'Diferença' ? (d.diferenca < 0 ? 'text-red-600' : 'text-amber-600') : ''}`}>{v}</div></div>)}
            </div>) : <div className="rounded-xl bg-slate-50 px-4 py-2 text-center"><div className="text-[10px] font-bold uppercase text-slate-500">Quantidade encontrada</div><div className="text-2xl font-extrabold">{fmt(d.final)}</div></div>}
        </div>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm"><div className="text-[11px] font-bold uppercase text-indigo-700">Ação sugerida pela matriz de regras</div>
          <div className="font-semibold">{d.acao || '—'}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{['CLIENTE', 'FISCAL', 'FISICO', 'PROMOCIONAL', 'PRODUTO', 'BRINDE', 'FALTA_BASE'].map(k => <span key={k} className={`chip ${sim(d.flags?.[k]) ? 'chip-on' : 'chip-off'} !py-0.5 text-[11px]`}>{k.replace('_', ' ')}: {sim(d.flags?.[k]) ? 'Sim' : 'Não'}</span>)}</div></div>

        {d.origem === 'INCLUSAO' && d.outrasPosicoes?.length > 0 && <div className="text-sm"><b>Outras posições onde este código existe:</b> {d.outrasPosicoes.join(', ')}</div>}
        {d.contagens?.length > 0 && <div><h3 className="mb-1 text-sm font-bold">Histórico das contagens</h3><table className="w-full"><thead><tr><th className="th">Etapa</th><th className="th">Operador</th><th className="th text-right">Quantidade</th><th className="th">Quando</th></tr></thead><tbody>
          {d.contagens.map((c: any, n: number) => <tr key={n}><td className="td">{c.etapa}ª</td><td className="td">{c.operador}</td><td className="td text-right font-semibold">{fmt(c.qtd)}</td><td className="td text-xs">{c.data} {c.hora}</td></tr>)}</tbody></table></div>}
        {d.outras?.length > 0 && <div><h3 className="mb-1 text-sm font-bold">Mesmo código em outras ocorrências</h3><ul className="space-y-1 text-sm">{d.outras.map((o: any) => <li key={o.id} className="rounded-lg bg-slate-50 px-3 py-1.5">{o.inventario} · {o.posicao} · {TIPO[o.tipo] || o.tipo} {o.diferenca > 0 ? '+' : ''}{o.diferenca} · {STATUS[o.status]?.rotulo || o.status}</li>)}</ul></div>}

        {d.decisao && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><div className="text-[11px] font-bold uppercase text-blue-700">Decisão do analista</div>
          <div className="font-semibold">{nomeDecisao(d.decisao)}</div><div>{d.justificativa}</div>
          <div className="text-xs text-slate-600">Responsável: {d.responsavel || '—'}{d.prazo ? ` · prazo ${dtBR(d.prazo)}` : ''}{d.refAjuste ? ` · ref. do ajuste: ${d.refAjuste}` : ''} · decidido por {d.decididoPor} em {d.decididoEm}</div></div>}

        {msg && <Alerta>{msg}</Alerta>}
        {podeDecidir && ['PENDENTE_TRATATIVA', 'EM_ANALISE'].includes(st) && (
          <div className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">O que será feito?</h3>
              {st === 'PENDENTE_TRATATIVA' && <button className="btn btn-secondary" disabled={env} onClick={() => chamar('diverg.avancar', { para: 'EM_ANALISE' }, false)}>Assumir análise</button>}</div>
            <div className="grid gap-2 md:grid-cols-2">{decisoes.map(x => <button key={x.id} type="button" onClick={() => setDecisao(x.id)} className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${decisao === x.id ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 hover:bg-slate-50'}`}>{x.rotulo}</button>)}</div>
            <div><label className="label">Justificativa (obrigatória)</label><textarea className="input" rows={3} value={just} onChange={e => setJust(e.target.value)} placeholder="Explique o motivo da decisão" /></div>
            <div className="grid gap-3 md:grid-cols-2"><div><label className="label">Responsável pela execução</label><input className="input" value={resp} onChange={e => setResp(e.target.value)} /></div><div><label className="label">Prazo</label><input type="date" className="input" value={prazo} onChange={e => setPrazo(e.target.value)} /></div></div>
            {lista.aprovacaoMin > 0 && <div className="text-xs text-violet-700">Decisões com valor a partir de {brl(lista.aprovacaoMin)} precisam da aprovação do Gestor.</div>}
            <div className="flex justify-end"><button className="btn btn-primary" disabled={env || !decisao || just.trim().length < 5} onClick={() => chamar('diverg.decidir', { decisao, justificativa: just, responsavel: resp, prazo })}>{env ? 'Gravando…' : 'Registrar decisão'}</button></div>
          </div>)}
        {st === 'AGUARDANDO_APROVACAO' && (podeAprovar ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2"><h3 className="text-sm font-bold">Esta decisão precisa da sua aprovação</h3>
            <textarea className="input" rows={2} placeholder="Observação (obrigatória para recusar)" value={obs} onChange={e => setObs(e.target.value)} />
            <div className="flex justify-end gap-2"><button className="btn btn-secondary" disabled={env} onClick={() => chamar('diverg.aprovar', { aprovar: false, obs })}>Recusar</button><button className="btn btn-primary" disabled={env} onClick={() => chamar('diverg.aprovar', { aprovar: true, obs })}>Aprovar</button></div></div>
        ) : <Alerta tipo="info">Aguardando a aprovação do Gestor.</Alerta>)}
        {podeDecidir && st === 'DECIDIDA' && (
          <div className="rounded-xl border border-slate-200 p-3 space-y-2"><h3 className="text-sm font-bold">Execução</h3>
            <input className="input" placeholder={d.decisao === 'AJUSTAR_WMS' ? 'Nº / referência do ajuste feito no WMS (obrigatório)' : 'Referência (opcional)'} value={ref} onChange={e => setRef(e.target.value)} />
            <div className="flex justify-end"><button className="btn btn-primary" disabled={env} onClick={() => chamar('diverg.avancar', { para: 'EXECUTADA', refAjuste: ref })}>Marcar como executada</button></div></div>)}
        {podeDecidir && st === 'EXECUTADA' && <div className="flex justify-end"><button className="btn btn-primary" disabled={env} onClick={() => chamar('diverg.avancar', { para: 'FECHADA' })}>Fechar divergência</button></div>}

        {d.historico?.length > 0 && <div><h3 className="mb-1 text-sm font-bold">Histórico</h3><ol className="space-y-1.5 border-l-2 border-slate-200 pl-3">{d.historico.map((h: any, n: number) => <li key={n} className="text-sm"><span className="text-xs text-slate-500">{h.quando} · {h.quem}</span><div>{h.texto}</div></li>)}</ol></div>}
      </div>
    </Modal>
  );
}
