'use client';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Titulo, useCarregar, useUser } from '@/components/ui';

export default function Auditoria() {
  const user = useUser(); const adm = user.perfil === 'ADMINISTRADOR';
  const { dados, erro, carregando, recarregar } = useCarregar<any[]>(() => rpc('auditoria.listar'), []);
  const [data, setData] = useState(''); const [msg, setMsg] = useState('');
  const limpar = async () => {
    if (!data) { setMsg('Escolha a data limite.'); return; }
    const t = prompt(`ATENÇÃO: apagar TODOS os registros de auditoria anteriores a ${data.split('-').reverse().join('/')}. Isso não pode ser desfeito.\nDigite EXCLUIR para confirmar:`);
    if (t === null) return;
    try { const r = await rpc<{ removidos: number }>('auditoria.limpar', { antesDe: data, confirmar: t }); setMsg(`${r.removidos} registro(s) apagado(s).`); recarregar(); } catch (e) { setMsg(msgErro(e)); }
  };
  if (carregando) return <Carregando />; if (erro) return <Alerta>{erro}</Alerta>;
  return (
    <div className="space-y-4"><Titulo>Auditoria (últimos 500 registros)</Titulo>
      {adm && <div className="flex flex-wrap items-end gap-3 rounded-xl bg-red-50 p-3 text-sm ring-1 ring-red-200"><div><div className="font-bold text-red-800">Administrador: limpar registros antigos</div><label className="label !mb-0">Apagar tudo anterior a</label><input type="date" className="input" value={data} onChange={e => setData(e.target.value)} /></div>
        <button className="btn btn-secondary" onClick={limpar}>Limpar</button>{msg && <span className="text-red-800">{msg}</span>}</div>}
      <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Data/hora</th><th className="th">Usuário</th><th className="th">Ação</th><th className="th">Entidade</th><th className="th">Detalhe</th></tr></thead><tbody>
        {dados!.map(a => <tr key={a.ID}><td className="td whitespace-nowrap">{a.DATA_HORA}</td><td className="td">{a.USUARIO_NOME}</td><td className="td font-medium">{a.ACAO}</td><td className="td text-xs">{a.ENTIDADE} {a.ENTIDADE_ID}</td><td className="td max-w-md truncate text-xs" title={a.DETALHE}>{a.DETALHE}</td></tr>)}
      </tbody></table></div></div>
  );
}
