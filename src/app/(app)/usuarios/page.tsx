'use client';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Modal, Titulo, useCarregar } from '@/components/ui';

const TIPOS = [['GERAL', 'Geral'], ['CICLICO', 'Cíclico'], ['CHECK', 'Check de posição'], ['ESPECIAL', 'Especial']];
const PERFIS = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'OPERADOR', 'AUDITOR', 'ANALISTA'];

export default function Usuarios() {
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(() => rpc('usuarios.listar'), []);
  const [novo, setNovo] = useState(false); const [reset, setReset] = useState<any>(null); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ nome: '', login: '', email: '', perfil: 'OPERADOR', senha: '' }); const [e2, setE2] = useState(''); const [senha, setSenha] = useState('');
  const criar = async (e: React.FormEvent) => { e.preventDefault(); try { await rpc('usuarios.criar', f); setNovo(false); setF({ nome: '', login: '', email: '', perfil: 'OPERADOR', senha: '' }); setE2(''); recarregar(); } catch (x) { setE2(msgErro(x)); } };
  const mudar = async (id: string, patch: object) => { try { await rpc('usuarios.atualizar', { id, ...patch }); recarregar(); } catch (x) { setMsg(msgErro(x)); } };
  const redefinir = async (e: React.FormEvent) => { e.preventDefault(); try { await rpc('usuarios.redefinirSenha', { id: reset.id, senha }); setReset(null); setSenha(''); setE2(''); setMsg('Senha redefinida. O usuário deverá trocá-la no próximo acesso.'); } catch (x) { setE2(msgErro(x)); } };
  if (carregando) return <Carregando />; if (erro) return <Alerta>{erro}</Alerta>;
  return (
    <div>
      <Titulo acao={<button className="btn btn-primary" onClick={() => setNovo(true)}>+ Novo usuário</button>}>Usuários e permissões</Titulo>
      {msg && <div className="mb-3"><Alerta tipo="info">{msg}</Alerta></div>}
      <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Nome</th><th className="th">Login</th><th className="th">Perfil</th><th className="th">Tipos de inventário</th><th className="th">Status</th><th className="th">Último acesso</th><th className="th" /></tr></thead><tbody>
        {dados!.map(u => <tr key={u.id}><td className="td font-semibold">{u.nome}</td><td className="td">{u.login}</td>
          <td className="td"><select className="input !py-1" value={u.perfil} onChange={e => mudar(u.id, { perfil: e.target.value })}>{PERFIS.map(p => <option key={p}>{p}</option>)}</select></td>
          <td className="td">{u.perfil === 'OPERADOR' ? <div><div className="flex flex-wrap gap-1">{TIPOS.map(([k, n]) => { const on = (u.tiposInv || []).includes(k); return <button key={k} type="button" className={`badge border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600'}`} onClick={() => mudar(u.id, { tiposInv: on ? u.tiposInv.filter((x: string) => x !== k) : [...(u.tiposInv || []), k] })}>{n}</button>; })}</div>{!(u.tiposInv || []).length && <div className="mt-1 text-[11px] text-slate-500">Nenhum marcado = pode fazer todos</div>}</div> : <span className="text-xs text-slate-400">—</span>}</td>
          <td className="td"><span className={`badge ${u.status === 'ATIVO' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{u.status}</span></td><td className="td text-xs">{u.ultimoAcesso || '—'}</td>
          <td className="td whitespace-nowrap text-right text-xs font-semibold text-brand-600"><button className="mr-3 underline" onClick={() => { setReset(u); setE2(''); }}>Redefinir senha</button><button className="underline" onClick={() => mudar(u.id, { status: u.status === 'ATIVO' ? 'BLOQUEADO' : 'ATIVO' })}>{u.status === 'ATIVO' ? 'Bloquear' : 'Desbloquear'}</button></td></tr>)}
      </tbody></table></div>
      {novo && <Modal titulo="Novo usuário" onClose={() => setNovo(false)}><form onSubmit={criar} className="space-y-3">
        <div><label className="label">Nome completo</label><input className="input" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} required /></div>
        <div className="grid grid-cols-2 gap-3"><div><label className="label">Login</label><input className="input" value={f.login} onChange={e => setF({ ...f, login: e.target.value })} autoCapitalize="none" required /></div>
          <div><label className="label">Perfil</label><select className="input" value={f.perfil} onChange={e => setF({ ...f, perfil: e.target.value })}>{PERFIS.map(p => <option key={p}>{p}</option>)}</select></div></div>
        <div><label className="label">E-mail</label><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Senha provisória (mín. 8)</label><input className="input" type="text" value={f.senha} onChange={e => setF({ ...f, senha: e.target.value })} minLength={8} required /></div>
        {e2 && <Alerta>{e2}</Alerta>}<button className="btn btn-primary w-full">Criar usuário</button></form></Modal>}
      {reset && <Modal titulo={`Redefinir senha — ${reset.nome}`} onClose={() => setReset(null)}><form onSubmit={redefinir} className="space-y-3">
        <div><label className="label">Nova senha provisória</label><input className="input" value={senha} onChange={e => setSenha(e.target.value)} minLength={8} required /></div>
        {e2 && <Alerta>{e2}</Alerta>}<button className="btn btn-primary w-full">Redefinir</button></form></Modal>}
    </div>
  );
}
