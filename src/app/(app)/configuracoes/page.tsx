'use client';
import { useEffect, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Carregando, Titulo, useCarregar } from '@/components/ui';

const ARQ: [string, string][] = [['ARM', 'Saldo Armazenado'], ['CF', 'Saldo Cliente e Fiscal'], ['BASE', 'Saldo Divergência Base']];

export default function Configuracoes() {
  const cfg = useCarregar<Record<string, string>>(() => rpc('config.obter'), []);
  const msgs = useCarregar<{ chave: string; texto: string }[]>(() => rpc('mensagens.listar'), []);
  const [v, setV] = useState<Record<string, string>>({}); const [m, setM] = useState<Record<string, string>>({}); const [ok, setOk] = useState(''); const [erro, setErro] = useState('');
  useEffect(() => { if (cfg.dados) setV(cfg.dados); }, [cfg.dados]);
  useEffect(() => { if (msgs.dados) setM(Object.fromEntries(msgs.dados.map(x => [x.chave, x.texto]))); }, [msgs.dados]);
  const salvar = async () => {
    setOk(''); setErro('');
    try {
      const out: Record<string, string> = { ...v };
      for (const [t] of ARQ) { // layout: lista separada por vírgula → JSON
        const txt = v['LAYOUT_TXT_' + t]; if (txt !== undefined) out['LAYOUT_' + t] = JSON.stringify(txt.split(',').map(s => s.trim()).filter(Boolean));
      }
      await rpc('config.salvar', out);
      for (const k of Object.keys(m)) if (msgs.dados?.find(x => x.chave === k)?.texto !== m[k]) await rpc('mensagens.salvar', { chave: k, texto: m[k] });
      setOk('Configurações salvas.'); cfg.recarregar(); msgs.recarregar();
    } catch (e) { setErro(msgErro(e)); }
  };
  if (cfg.carregando || msgs.carregando) return <Carregando />;
  if (cfg.erro) return <Alerta>{cfg.erro}</Alerta>;
  const layoutTxt = (t: string) => v['LAYOUT_TXT_' + t] ?? (() => { try { return JSON.parse(v['LAYOUT_' + t] || '[]').join(', '); } catch { return ''; } })();
  return (
    <div className="space-y-6">
      <Titulo acao={<button className="btn btn-primary" onClick={salvar}>Salvar tudo</button>}>Configurações</Titulo>
      {ok && <Alerta tipo="ok">{ok}</Alerta>}{erro && <Alerta>{erro}</Alerta>}
      <div className="card space-y-4"><h2 className="font-bold">Arquivos oficiais da Central de Atualização</h2>
        <p className="text-sm text-slate-500">O nome completo (com extensão), a aba e as colunas obrigatórias precisam bater exatamente com o relatório exportado.</p>
        {ARQ.map(([t, tit]) => <div key={t} className="grid gap-3 md:grid-cols-4"><div className="md:col-span-4 text-sm font-semibold">{tit}</div>
          <div><label className="label">Nome do arquivo</label><input className="input" value={v['ARQUIVO_' + t] || ''} onChange={e => setV({ ...v, ['ARQUIVO_' + t]: e.target.value })} /></div>
          <div><label className="label">Nome da aba</label><input className="input" value={v['ABA_' + t] || ''} onChange={e => setV({ ...v, ['ABA_' + t]: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label">Colunas obrigatórias (separadas por vírgula)</label><input className="input" value={layoutTxt(t)} onChange={e => setV({ ...v, ['LAYOUT_TXT_' + t]: e.target.value })} /></div></div>)}</div>
      <div className="card grid gap-3 md:grid-cols-3"><h2 className="font-bold md:col-span-3">Operação</h2>
        <div><label className="label">Reserva de tarefa (minutos)</label><input className="input" type="number" min={5} value={v.RESERVA_MINUTOS || ''} onChange={e => setV({ ...v, RESERVA_MINUTOS: e.target.value })} /></div>
        <div><label className="label">Versões de base mantidas</label><input className="input" type="number" min={2} value={v.VERSOES_MANTIDAS || ''} onChange={e => setV({ ...v, VERSOES_MANTIDAS: e.target.value })} /></div>
        <div><label className="label">Divergência com valor a partir de (R$) exige aprovação do Gestor — 0 desliga</label><input className="input" type="number" min={0} step="1" value={v.APROVACAO_VALOR_MIN ?? '0'} onChange={e => setV({ ...v, APROVACAO_VALOR_MIN: e.target.value })} /></div>
        <div><label className="label">Limite de rejeição por arquivo (%)</label><input className="input" type="number" min={0} step="0.1" value={v.REJEICAO_MAX_PERCENT ?? '1'} onChange={e => setV({ ...v, REJEICAO_MAX_PERCENT: e.target.value })} /></div></div>
      <div className="card space-y-3"><h2 className="font-bold">Mensagens do aplicativo</h2>
        {Object.keys(m).map(k => <div key={k}><label className="label">{k}</label><input className="input" value={m[k]} onChange={e => setM({ ...m, [k]: e.target.value })} /></div>)}</div>
    </div>
  );
}
