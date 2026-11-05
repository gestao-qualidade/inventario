'use client';
import { rpc } from '@/lib/rpc';
import { Alerta, Carregando, Titulo, useCarregar } from '@/components/ui';

export default function Auditoria() {
  const { dados, erro, carregando } = useCarregar<any[]>(() => rpc('auditoria.listar'), []);
  if (carregando) return <Carregando />; if (erro) return <Alerta>{erro}</Alerta>;
  return (
    <div><Titulo>Auditoria (últimos 500 registros)</Titulo>
      <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Data/hora</th><th className="th">Usuário</th><th className="th">Ação</th><th className="th">Entidade</th><th className="th">Detalhe</th></tr></thead><tbody>
        {dados!.map(a => <tr key={a.ID}><td className="td whitespace-nowrap">{a.DATA_HORA}</td><td className="td">{a.USUARIO_NOME}</td><td className="td font-medium">{a.ACAO}</td><td className="td text-xs">{a.ENTIDADE} {a.ENTIDADE_ID}</td><td className="td max-w-md truncate text-xs" title={a.DETALHE}>{a.DETALHE}</td></tr>)}
      </tbody></table></div></div>
  );
}
