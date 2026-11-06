'use client';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Modal, Titulo, useCarregar, useUser } from '@/components/ui';

const CAMPOS = [['CLIENTE', 'Saldo Cliente'], ['FISCAL', 'Saldo Fiscal'], ['FISICO', 'Saldo Físico'], ['PROMOCIONAL', 'É promocional?'], ['PRODUTO', 'É produto?'], ['BRINDE', 'Brinde?'], ['FALTA_BASE', 'Falta base?']];
const SN = (v: string) => (v === 'SIM' ? 'Sim' : 'Não');

function Simulador() {
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(CAMPOS.map(([k]) => [k, 'SIM']))); const [r, setR] = useState<any>(null); const [erro, setErro] = useState('');
  const rodar = async () => { try { setR(await rpc('regras.simular', f)); setErro(''); } catch (e) { setErro(msgErro(e)); } };
  return (
    <div className="card space-y-3"><h2 className="font-bold">Simulador</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{CAMPOS.map(([k, t]) => <div key={k}><label className="label">{t}</label><select className="input" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}><option value="SIM">Sim</option><option value="NAO">Não</option></select></div>)}</div>
      <button className="btn btn-secondary" onClick={rodar}>Simular</button>
      {erro && <Alerta>{erro}</Alerta>}{r && <Alerta tipo={r.encontrada ? 'ok' : 'aviso'}>Resultado: <b>{r.acao}</b>{r.mensagem ? ` — ${r.mensagem}` : ''}</Alerta>}</div>
  );
}

function Formulario({ regra, invs, onClose, onSalvo }: { regra: any | null; invs: any[]; onClose: () => void; onSalvo: () => void }) {
  const [v, setV] = useState<any>(regra ? { ...regra } : { ...Object.fromEntries(CAMPOS.map(([k]) => [k, 'NAO'])), ACAO: '', MENSAGEM: '' });
  const [sel, setSel] = useState<string[]>(regra ? (() => { try { return JSON.parse(regra.INVENTARIOS || '[]'); } catch { return []; } })() : []);
  const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState('');
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (regra) await rpc('regras.editar', { id: regra.ID, ...Object.fromEntries(CAMPOS.map(([k]) => [k, v[k]])), ACAO: v.ACAO, MENSAGEM: v.MENSAGEM, INVENTARIOS: sel, motivo });
      else await rpc('regras.criar', { ...Object.fromEntries(CAMPOS.map(([k]) => [k, v[k]])), ACAO: v.ACAO, MENSAGEM: v.MENSAGEM, INVENTARIOS: sel });
      onSalvo(); onClose();
    } catch (x) { setErro(msgErro(x)); }
  };
  return (
    <Modal titulo={regra ? 'Editar regra' : 'Nova regra'} onClose={onClose} largo>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{CAMPOS.map(([k, t]) => <div key={k}><label className="label">{t}</label><select className="input" value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })}><option value="SIM">Sim</option><option value="NAO">Não</option></select></div>)}</div>
        <div><label className="label">Ação</label><input className="input" value={v.ACAO} onChange={e => setV({ ...v, ACAO: e.target.value })} required /></div>
        <div><label className="label">Mensagem (opcional)</label><input className="input" value={v.MENSAGEM} onChange={e => setV({ ...v, MENSAGEM: e.target.value })} /></div>
        <div><label className="label">Aplica-se a inventários ({sel.length ? sel.length : 'todos'})</label><div className="flex flex-wrap gap-1.5">{invs.map(i => { const on = sel.includes(i.id); return <button type="button" key={i.id} onClick={() => setSel(on ? sel.filter(x => x !== i.id) : [...sel, i.id])} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>{i.nome}</button>; })}</div></div>
        {regra && <div><label className="label">Motivo da alteração (obrigatório)</label><input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} required /></div>}
        {erro && <Alerta>{erro}</Alerta>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
      </form>
    </Modal>
  );
}

export default function Regras() {
  const user = useUser(); const admin = user.perfil === 'ADMINISTRADOR';
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(() => rpc('regras.listar'), []);
  const invs = useCarregar<any[]>(() => (admin ? rpc('inventario.listar') : Promise.resolve([])), []);
  const [edit, setEdit] = useState<any>(undefined); const [hist, setHist] = useState<any[] | null>(null); const [msg, setMsg] = useState(''); const [filtro, setFiltro] = useState('');
  const excluir = async (r: any) => { const t = prompt(`ATENÇÃO: excluir esta regra (${r.ACAO}) e o histórico dela não pode ser desfeito.\nDigite EXCLUIR para confirmar:`); if (t === null) return; try { await rpc('regras.excluir', { id: r.ID, confirmar: t }); setMsg('Regra excluída.'); recarregar(); } catch (e) { setMsg(msgErro(e)); } };
  const alternar = async (r: any) => { try { await rpc('regras.ativar', { id: r.ID, ativa: r.ATIVA !== 'S' }); recarregar(); } catch (e) { setMsg(msgErro(e)); } };
  const historico = async (r: any) => { try { setHist(await rpc('regras.historico', { id: r.ID })); } catch (e) { setMsg(msgErro(e)); } };
  if (carregando) return <Carregando />;
  if (erro) return <Alerta>{erro}</Alerta>;
  const lista = dados!.filter(r => !filtro || r.ACAO.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <div className="space-y-5">
      <Titulo acao={admin && <button className="btn btn-primary" onClick={() => setEdit(null)}>+ Nova regra</button>}>Regras fiscais e do cliente</Titulo>
      {msg && <Alerta>{msg}</Alerta>}
      <Simulador />
      <div className="card !p-0"><div className="p-4"><input className="input max-w-sm" placeholder="Filtrar por ação…" value={filtro} onChange={e => setFiltro(e.target.value)} /></div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr>{CAMPOS.map(([k, t]) => <th key={k} className="th">{t}</th>)}<th className="th">Ação</th><th className="th">Ver.</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
          {lista.map(r => <tr key={r.ID} className={r.ATIVA !== 'S' ? 'opacity-50' : ''}>{CAMPOS.map(([k]) => <td key={k} className="td">{SN(r[k])}</td>)}<td className="td font-medium">{r.ACAO}</td><td className="td">{r.VERSAO}</td><td className="td">{r.ATIVA === 'S' ? 'Ativa' : 'Inativa'}</td>
            <td className="td whitespace-nowrap text-right text-xs font-semibold text-brand-600"><button className="mr-3 underline" onClick={() => historico(r)}>Versões</button>
              {admin && <><button className="mr-3 underline" onClick={() => setEdit(r)}>Editar</button><button className="underline" onClick={() => alternar(r)}>{r.ATIVA === 'S' ? 'Desativar' : 'Ativar'}</button><button className="ml-3 text-red-600 underline" onClick={() => excluir(r)}>Excluir</button></>}</td></tr>)}
        </tbody></table></div></div>
      {edit !== undefined && <Formulario regra={edit} invs={invs.dados || []} onClose={() => setEdit(undefined)} onSalvo={recarregar} />}
      {hist && <Modal titulo="Versões da regra" onClose={() => setHist(null)} largo><table className="w-full"><thead><tr><th className="th">Versão</th><th className="th">Quando</th><th className="th">Quem</th><th className="th">Motivo</th></tr></thead><tbody>
        {hist.map(h => <tr key={h.ID}><td className="td">{h.VERSAO}</td><td className="td">{h.ALTERADO_EM}</td><td className="td">{h.ALTERADO_POR}</td><td className="td">{h.MOTIVO}</td></tr>)}</tbody></table></Modal>}
    </div>
  );
}
