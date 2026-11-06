'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rpc, msgErro } from '@/lib/rpc';
import ProdutoFoto from '@/components/ProdutoFoto';
import Lotes from '@/components/Lotes';
import { Alerta, Barra, Carregando, Kpi, Modal, Titulo, fmt, useCarregar, useUser } from '@/components/ui';

const CORES = ['#2563eb', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'];

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="card"><h3 className="mb-3 text-sm font-bold text-slate-700">{titulo}</h3><div className="h-64">{children}</div></div>;
}
const Vazio = () => <div className="flex h-full items-center justify-center text-sm text-slate-400">Sem dados ainda</div>;
const seg = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}min ${s % 60}s` : `${s}s`);

function Tratativas({ invId, podeResolver }: { invId: string; podeResolver: boolean }) {
  const { dados, carregando, recarregar } = useCarregar<any[]>(() => rpc('tratativas.listar', { invId }), [invId]);
  const [sel, setSel] = useState<any>(null); const [txt, setTxt] = useState(''); const [erro, setErro] = useState('');
  const salvar = async () => { try { await rpc('tratativas.resolver', { id: sel.ID, tipo: sel.tipo, tratativa: txt }); setSel(null); setTxt(''); setErro(''); recarregar(); } catch (e) { setErro(msgErro(e)); } };
  return (
    <div className="card !p-0">
      <h3 className="px-5 pt-4 text-sm font-bold text-slate-700">Divergências e tratativas</h3>
      {carregando ? <Carregando /> : <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Posição</th><th className="th">Cliente</th><th className="th">SKU</th><th className="th text-right">Sistema</th><th className="th text-right">Final</th><th className="th">Tipo</th><th className="th">Etapa</th><th className="th">Ação da matriz</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
        {dados!.map(d => <tr key={d.ID}><td className="td">{d.POSICAO}</td><td className="td">{d.CLIENTE}</td><td className="td"><div className="flex items-center gap-2"><ProdutoFoto sku={d.SKU} className="h-9 w-9" /><div><div>{d.SKU}</div><div className="text-xs text-slate-500">{d.DESCRICAO}</div><Lotes lotes={d.LOTES} vazio={false} /></div></div></td><td className="td text-right">{fmt(d.SALDO)}</td><td className="td text-right">{fmt(d.QTD_FINAL)}</td>
          <td className="td"><span className={`badge ${d.TIPO === 'FALTA' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{d.TIPO}</span></td><td className="td">{d.ETAPA_FINAL || 'check'}</td><td className="td text-xs">{d.ACAO}</td><td className="td text-xs">{d.STATUS}</td>
          <td className="td text-right"><a className="text-xs font-semibold text-brand-600 underline" href={`/divergencias?inv=${invId}`}>Abrir na tela de Divergências</a></td></tr>)}
        {!dados!.length && <tr><td className="td text-slate-500" colSpan={10}>Nenhuma divergência registrada.</td></tr>}
      </tbody></table></div>}
      {sel && <Modal titulo={`Tratar ${sel.TIPO.toLowerCase()} — ${sel.SKU}`} onClose={() => setSel(null)}>
        <p className="mb-2 text-sm text-slate-600">Posição {sel.POSICAO}. Ação sugerida pela matriz: <b>{sel.ACAO}</b></p>
        <label className="label">Tratativa aplicada (justificativa obrigatória)</label><textarea className="input" rows={4} value={txt} onChange={e => setTxt(e.target.value)} />
        {erro && <div className="mt-2"><Alerta>{erro}</Alerta></div>}
        <div className="mt-4 flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setSel(null)}>Cancelar</button><button className="btn btn-primary" onClick={salvar}>Registrar tratativa</button></div>
      </Modal>}
    </div>
  );
}

function Inclusoes({ invId, podeResolver }: { invId: string; podeResolver: boolean }) {
  const { dados, carregando, recarregar } = useCarregar<any[]>(() => rpc('inclusoes.listar', { invId }), [invId]);
  const [sel, setSel] = useState<any>(null); const [txt, setTxt] = useState(''); const [erro, setErro] = useState('');
  const salvar = async () => { try { await rpc('tratativas.resolver', { id: sel.ID, tipo: 'INCLUSAO', tratativa: txt }); setSel(null); setTxt(''); setErro(''); recarregar(); } catch (e) { setErro(msgErro(e)); } };
  return (
    <div className="card !p-0">
      <h3 className="px-5 pt-4 text-sm font-bold text-slate-700">Inclusões de produtos</h3>
      {carregando ? <Carregando /> : <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Posição encontrada</th><th className="th">Cliente</th><th className="th">SKU</th><th className="th">Descrição</th><th className="th text-right">Qtd</th><th className="th">Cadastrado em</th><th className="th">Ação da matriz</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
        {dados!.map(d => <tr key={d.ID}><td className="td">{d.POSICAO_ENCONTRADA}</td><td className="td">{d.CLIENTE || '—'}</td><td className="td"><div className="flex items-center gap-2"><ProdutoFoto sku={d.SKU} className="h-9 w-9" />{d.SKU}</div></td><td className="td text-xs">{d.DESCRICAO}</td><td className="td text-right">{fmt(d.QTD)}</td>
          <td className="td text-xs">{(() => { try { return JSON.parse(d.OUTRAS_POSICOES).join(', ') || '—'; } catch { return '—'; } })()}</td><td className="td text-xs">{d.ACAO}</td><td className="td text-xs">{d.STATUS}{d.OBS ? ` — ${d.OBS}` : ''}</td>
          <td className="td text-right"><a className="text-xs font-semibold text-brand-600 underline" href={`/divergencias?inv=${invId}`}>Abrir na tela de Divergências</a></td></tr>)}
        {!dados!.length && <tr><td className="td text-slate-500" colSpan={9}>Nenhuma inclusão registrada.</td></tr>}
      </tbody></table></div>}
      {sel && <Modal titulo={`Inclusão — ${sel.SKU}`} onClose={() => setSel(null)}>
        <p className="mb-2 text-sm text-slate-600">Encontrado em {sel.POSICAO_ENCONTRADA}. Ação sugerida: <b>{sel.ACAO}</b></p>
        <label className="label">Tratativa / análise (obrigatória)</label><textarea className="input" rows={4} value={txt} onChange={e => setTxt(e.target.value)} />
        {erro && <div className="mt-2"><Alerta>{erro}</Alerta></div>}
        <div className="mt-4 flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setSel(null)}>Cancelar</button><button className="btn btn-primary" onClick={salvar}>Registrar</button></div>
      </Modal>}
    </div>
  );
}

export default function PainelInventario() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { dados: d, erro, carregando, recarregar } = useCarregar<any>(() => rpc('inventario.dashboard', { id }), [id], 30000);
  if (carregando) return <Carregando texto="Calculando indicadores a partir da planilha…" />;
  if (erro || !d) return <Alerta>{erro}</Alerta>;
  const k = d.kpis, inv = d.inventario;
  const podeResolver = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR'].includes(user.perfil);
  return (
    <div className="space-y-6">
      <Titulo acao={<div className="flex gap-2"><Link href="/inventarios" className="btn btn-secondary">← Inventários</Link><button className="btn btn-secondary" onClick={recarregar}>Atualizar</button></div>}>{inv.nome}</Titulo>
      <div className="card"><div className="mb-2 flex justify-between text-sm"><span>Conclusão por posição: <b>{k.percentualConclusao}%</b> ({fmt(k.posicoesInventariadas)} de {fmt(k.posicoesPlanejadas)})</span><span className="text-slate-500">{inv.tipo} · base {inv.versaoBase} · {inv.status}</span></div><Barra pct={k.percentualConclusao} /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi rotulo="Posições planejadas" valor={fmt(k.posicoesPlanejadas)} /><Kpi rotulo="Inventariadas" valor={fmt(k.posicoesInventariadas)} cor="text-emerald-600" /><Kpi rotulo="Pendentes" valor={fmt(k.posicoesPendentes)} />
        <Kpi rotulo="Total de SKUs (unidades)" valor={fmt(k.totalSkus)} sub={`${k.percentualUnidades}% finalizadas`} /><Kpi rotulo="1ª contagens" valor={fmt(k.primeiras)} /><Kpi rotulo="2ª contagens" valor={fmt(k.segundas)} />
        <Kpi rotulo="3ª contagens" valor={fmt(k.terceiras)} /><Kpi rotulo="Sem divergência" valor={fmt(k.semDivergencia)} cor="text-emerald-600" /><Kpi rotulo="Faltas" valor={fmt(k.faltas)} cor="text-red-600" />
        <Kpi rotulo="Sobras" valor={fmt(k.sobras)} cor="text-amber-600" /><Kpi rotulo="Inclusões" valor={fmt(k.inclusoes)} /><Kpi rotulo="Pend. de tratativa" valor={fmt(k.pendenciasTratativa)} cor="text-red-600" />
        <Kpi rotulo="Acuracidade 1ª contagem" valor={`${k.acuracidadePrimeira}%`} /><Kpi rotulo="Acuracidade final" valor={`${k.acuracidadeFinal}%`} /><Kpi rotulo="Tempo médio / contagem" valor={seg(k.tempoMedioSeg)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Grafico titulo="Evolução do inventário (contagens por dia)">{d.evolucao.length ? <ResponsiveContainer><LineChart data={d.evolucao}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="data" /><YAxis allowDecimals={false} /><Tooltip /><Line dataKey="contagens" stroke="#2563eb" strokeWidth={2} /></LineChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Produção por operador">{d.produtividade.length ? <ResponsiveContainer><BarChart data={d.produtividade}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="operador" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="contagens" fill="#2563eb" /></BarChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Divergências por cliente">{d.divergenciasPorCliente.length ? <ResponsiveContainer><BarChart data={d.divergenciasPorCliente}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="valor" fill="#ef4444" /></BarChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Divergências por posição (top 15)">{d.divergenciasPorPosicao.length ? <ResponsiveContainer><BarChart data={d.divergenciasPorPosicao}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="valor" fill="#f59e0b" /></BarChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Distribuição das contagens">{d.distribuicao.some((x: any) => x.valor) ? <ResponsiveContainer><PieChart><Pie data={d.distribuicao} dataKey="valor" nameKey="nome" outerRadius={90} label>{d.distribuicao.map((_: any, i: number) => <Cell key={i} fill={CORES[i]} />)}</Pie><Legend /><Tooltip /></PieChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Resultados por área (rua)">{d.resultadosPorArea.length ? <ResponsiveContainer><BarChart data={d.resultadosPorArea}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="area" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="finalizadas" name="Finalizadas" fill="#10b981" /><Bar dataKey="divergentes" name="Com divergência" fill="#ef4444" /></BarChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <Grafico titulo="Resultados por Curva ABC">{d.resultadosPorCurva.length ? <ResponsiveContainer><BarChart data={d.resultadosPorCurva}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="curva" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="unidades" name="Unidades" fill="#94a3b8" /><Bar dataKey="finalizadas" name="Finalizadas" fill="#10b981" /><Bar dataKey="divergentes" name="Com divergência" fill="#ef4444" /></BarChart></ResponsiveContainer> : <Vazio />}</Grafico>
        <div className="card"><h3 className="mb-3 text-sm font-bold text-slate-700">Produtividade por operador</h3><table className="w-full"><thead><tr><th className="th">Operador</th><th className="th text-right">Contagens</th><th className="th text-right">Tempo médio</th></tr></thead><tbody>
          {d.produtividade.map((p: any) => <tr key={p.operador}><td className="td">{p.operador}</td><td className="td text-right">{fmt(p.contagens)}</td><td className="td text-right">{seg(p.tempoMedioSeg)}</td></tr>)}
          {!d.produtividade.length && <tr><td className="td text-slate-400" colSpan={3}>Sem dados ainda</td></tr>}</tbody></table></div>
      </div>
      <Tratativas invId={id} podeResolver={podeResolver} />
      <Inclusoes invId={id} podeResolver={podeResolver} />
    </div>
  );
}
