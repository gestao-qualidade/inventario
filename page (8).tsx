'use client';
import Link from 'next/link';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Modal, Titulo, fmt, useCarregar, useUser } from '@/components/ui';
import NovoInventario from '@/components/NovoInventario';

const COR: Record<string, string> = { ATIVO: 'bg-emerald-100 text-emerald-800', AGENDADO: 'bg-violet-100 text-violet-800', PREPARANDO: 'bg-amber-100 text-amber-800', ENCERRADO: 'bg-slate-200 text-slate-700', CANCELADO: 'bg-red-100 text-red-700' };
const ROTULO: Record<string, string> = { ATIVO: 'Em andamento', AGENDADO: 'Agendado', ENCERRADO: 'Encerrado', CANCELADO: 'Cancelado', PREPARANDO: 'Preparando' };
const quando = (s: string) => { if (!s) return '—'; const [d, h] = s.split('T'); const [a, m, di] = d.split('-'); return `${di}/${m}/${a} ${h || ''}`.trim(); };

export default function Inventarios() {
  const user = useUser();
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(() => rpc('inventario.listar'), []);
  const [novo, setNovo] = useState(false); const [msg, setMsg] = useState(''); const [filtro, setFiltro] = useState('TODOS'); const [ocupado, setOcupado] = useState('');
  const [edit, setEdit] = useState<any>(null); const [ei, setEi] = useState(''); const [ef, setEf] = useState('');
  const pode = ['ADMINISTRADOR', 'GESTOR'].includes(user.perfil); const adm = user.perfil === 'ADMINISTRADOR';
  const agir = async (id: string, acao: string, payload: any, texto: string) => { setMsg(''); setOcupado(id); try { await rpc(acao, { id, ...payload }); recarregar(); } catch (e) { setMsg(msgErro(e) || texto); } finally { setOcupado(''); } };
  const encerrar = (i: any) => confirm(`Encerrar "${i.nome}"? Não será possível novas contagens.`) && agir(i.id, 'inventario.encerrar', {}, '');
  const cancelar = (i: any) => confirm(`Cancelar o agendamento de "${i.nome}"?`) && agir(i.id, 'inventario.cancelar', {}, '');
  const iniciar = (i: any) => confirm(`Iniciar "${i.nome}" agora? Os operadores já poderão contar.`) && agir(i.id, 'inventario.reagendar', { iniciarAgora: true }, '');
  const excluir = (i: any) => {
    const comDados = ['ATIVO', 'ENCERRADO'].includes(i.status);
    if (!comDados) { if (confirm(`Excluir "${i.nome}"? Isso não pode ser desfeito.`)) agir(i.id, 'inventario.excluir', {}, ''); return; }
    const t = prompt(`ATENÇÃO: "${i.nome}" já tem contagens. Para excluir, digite o nome exato do inventário:`);
    if (t !== null) agir(i.id, 'inventario.excluir', { confirmar: t }, '');
  };
  const abrirEdicao = (i: any) => { setEdit(i); setEi(i.inicioPrevisto || ''); setEf(i.fimPrevisto || ''); };
  const salvarEdicao = async () => { try { await rpc('inventario.reagendar', { id: edit.id, inicio: ei, fim: ef }); setEdit(null); recarregar(); } catch (e) { setMsg(msgErro(e)); setEdit(null); } };

  const lista = dados || [];
  const cont = (s: string) => s === 'TODOS' ? lista.length : lista.filter(i => i.status === s).length;
  const vis = filtro === 'TODOS' ? lista : lista.filter(i => i.status === filtro);
  return (
    <div>
      <Titulo acao={pode && <button className="btn btn-primary" onClick={() => setNovo(true)}>+ Novo inventário</button>}>Inventários</Titulo>
      {msg && <Alerta>{msg}</Alerta>}
      <div className="mb-3 flex flex-wrap gap-2">
        {['TODOS', 'ATIVO', 'AGENDADO', 'ENCERRADO', 'CANCELADO'].map(s => (
          <button key={s} className={`chip ${filtro === s ? 'chip-on' : 'chip-off'}`} onClick={() => setFiltro(s)}>{s === 'TODOS' ? 'Todos' : ROTULO[s]} · {cont(s)}</button>
        ))}
      </div>
      {carregando ? <Carregando /> : erro ? <Alerta>{erro}</Alerta> : (
        <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Nome</th><th className="th">Tipo</th><th className="th">Status</th><th className="th text-right">Unidades</th><th className="th text-right">Posições</th><th className="th">Início</th><th className="th">Término previsto</th><th className="th">Base</th><th className="th" /></tr></thead><tbody>
          {vis.map(i => (
            <tr key={i.id}><td className="td font-semibold"><Link className="text-brand-600 hover:underline" href={`/inventarios/${i.id}`}>{i.nome}</Link><div className="text-xs font-normal text-slate-500">criado {i.criadoEm}</div></td><td className="td">{i.tipo}</td>
              <td className="td"><span className={`badge ${COR[i.status] || ''}`}>{ROTULO[i.status] || i.status}</span></td><td className="td text-right">{fmt(i.totalUnidades)}</td><td className="td text-right">{fmt(i.totalPosicoes)}</td>
              <td className="td">{i.status === 'AGENDADO' ? quando(i.inicioPrevisto) : (i.publicadoEm || '—')}</td><td className="td">{quando(i.fimPrevisto)}</td>
              <td className="td">{i.versaoBase}</td>
              <td className="td whitespace-nowrap text-right space-x-3">
                {pode && i.status === 'AGENDADO' && <><button className="text-xs font-semibold text-emerald-700 underline" disabled={ocupado === i.id} onClick={() => iniciar(i)}>Iniciar agora</button><button className="text-xs font-semibold text-brand-600 underline" onClick={() => abrirEdicao(i)}>Reagendar</button><button className="text-xs font-semibold text-amber-700 underline" onClick={() => cancelar(i)}>Cancelar</button></>}
                {pode && i.status === 'ATIVO' && <><button className="text-xs font-semibold text-brand-600 underline" onClick={() => abrirEdicao(i)}>Prazo</button><button className="text-xs font-semibold text-amber-700 underline" onClick={() => encerrar(i)}>Encerrar</button></>}
                {pode && (adm || !['ATIVO', 'ENCERRADO'].includes(i.status)) && <button className="text-xs font-semibold text-red-600 underline" disabled={ocupado === i.id} onClick={() => excluir(i)}>Excluir</button>}
              </td></tr>
          ))}
          {!vis.length && <tr><td className="td text-slate-500" colSpan={9}>Nenhum inventário aqui.</td></tr>}
        </tbody></table></div>
      )}
      {novo && <NovoInventario onClose={() => setNovo(false)} onCriado={recarregar} />}
      {edit && <Modal titulo={edit.status === 'AGENDADO' ? 'Reagendar inventário' : 'Prazo do inventário'} onClose={() => setEdit(null)}>
        <div className="space-y-3">
          <div className="font-semibold">{edit.nome}</div>
          {edit.status === 'AGENDADO' && <div><label className="label">Início</label><input type="datetime-local" className="input" value={ei} onChange={e => setEi(e.target.value)} /></div>}
          <div><label className="label">Término previsto</label><input type="datetime-local" className="input" value={ef} onChange={e => setEf(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><button className="btn btn-secondary" onClick={() => setEdit(null)}>Voltar</button><button className="btn btn-primary" onClick={salvarEdicao}>Salvar</button></div>
        </div>
      </Modal>}
    </div>
  );
}
