'use client';
import { useRef, useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Barra, Carregando, Titulo, fmt, useCarregar, useUser } from '@/components/ui';
import type { Resultado, Tipo } from '@/lib/excelProcess';

type Arq = { nome: string; status: string; linhasLidas: number; validos: number; rejeitados: number; ignoradas?: number; agregadas?: number; duplicados?: number; posicoes?: number; skus?: number;
  camposVazios?: Record<string, number>; motivos?: string[]; erros: { linha: number; motivo: string; chave: string }[]; finalizadoEm?: string };
type Estado = { versaoAtiva: string; esperados: { tipo: Tipo; titulo: string; arquivo: string; aba: string; layout: string[] }[];
  aberta: null | { id: string; versao: string; status: string; resumo: { arquivos: Record<string, Arq>; previa?: any } }; historico: any[] };

const TITULOS: Record<Tipo, string> = { ARM: 'ARQUIVO 1 — SALDO ARMAZENADO', CF: 'ARQUIVO 2 — SALDO CLIENTE E FISCAL', BASE: 'ARQUIVO 3 — SALDO DIVERGÊNCIA BASE' };

function lerNoWorker(tipo: Tipo, buffer: ArrayBuffer): Promise<Resultado> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../../../workers/excel.worker.ts', import.meta.url));
    w.onmessage = e => { w.terminate(); e.data.ok ? resolve(e.data.res) : reject(new Error(e.data.erro)); };
    w.onerror = () => { w.terminate(); reject(new Error('Falha ao ler o arquivo Excel.')); };
    w.postMessage({ tipo, buffer }, [buffer]);
  });
}

async function comRetentativa<T>(fn: () => Promise<T>) {
  let ult: unknown;
  for (let i = 0; i < 3; i++) { try { return await fn(); } catch (e: any) { ult = e; if (e?.codigo && e.codigo !== 'REDE' && e.codigo !== 'OCUPADO' && e.codigo !== 'RESPOSTA') throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); } }
  throw ult;
}

function baixarErros(nome: string, erros: Arq['erros']) {
  const csv = 'linha;motivo;chave\n' + erros.map(e => `${e.linha};${e.motivo};${e.chave}`).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `erros_${nome}.csv`; a.click();
}

function Cartao({ tipo, est, onMudou }: { tipo: Tipo; est: Estado; onMudou: () => void }) {
  const esp = est.esperados.find(e => e.tipo === tipo)!;
  const arq = est.aberta?.resumo.arquivos[tipo];
  const [etapa, setEtapa] = useState(''); const [pct, setPct] = useState(0); const [erro, setErro] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const processar = async (file: File) => {
    setErro(''); setPct(0);
    try {
      if (file.name !== esp.arquivo) throw new Error('Arquivo não reconhecido. Verifique se o nome está exatamente igual ao relatório oficial esperado.');
      setEtapa('Lendo e normalizando o Excel (pode levar alguns segundos)…');
      const res = await lerNoWorker(tipo, await file.arrayBuffer());
      setEtapa('Validando estrutura…');
      const reg = await rpc<{ importId: string }>('importacao.registrarArquivo', { tipo, nomeArquivo: file.name, aba: res.aba, cabecalhos: res.cabecalhos });
      const TAM = 1500; let seq = 0;
      for (let i = 0; i < res.linhas.length; i += TAM, seq++) {
        setEtapa(`Enviando registros… ${fmt(Math.min(i + TAM, res.linhas.length))} de ${fmt(res.linhas.length)}`);
        setPct(Math.round(((i + TAM) / res.linhas.length) * 100));
        await comRetentativa(() => rpc('importacao.enviarLote', { importId: reg.importId, tipo, seq, linhas: res.linhas.slice(i, i + TAM) }));
      }
      setEtapa('Conferindo…');
      await rpc('importacao.finalizarArquivo', { importId: reg.importId, tipo, linhasLidas: res.linhasLidas, ignoradas: res.ignoradas, rejeitadasCliente: res.rejeitadas, errosCliente: res.erros, agregadas: res.agregadas, camposVazios: res.camposVazios });
      onMudou();
    } catch (e) { setErro(msgErro(e)); } finally { setEtapa(''); if (input.current) input.current.value = ''; }
  };

  const cor = !arq ? 'bg-slate-100 text-slate-600' : arq.status === 'APROVADO' ? 'bg-emerald-100 text-emerald-800' : arq.status === 'INVALIDO' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">{TITULOS[tipo]}</h3><span className={`badge ${cor}`}>{arq ? arq.status : 'PENDENTE'}</span></div>
      <div className="text-xs text-slate-500">Nome esperado: <b className="text-slate-700">{esp.arquivo}</b> · aba <b>{esp.aba}</b></div>
      <input ref={input} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => e.target.files?.[0] && processar(e.target.files[0])} />
      <button className="btn btn-secondary w-full" disabled={!!etapa} onClick={() => input.current?.click()}>{arq ? 'Substituir arquivo' : 'Selecionar arquivo'}</button>
      {etapa && <div className="space-y-1"><div className="text-xs text-slate-600">{etapa}</div><Barra pct={pct} /></div>}
      {erro && <Alerta>{erro}</Alerta>}
      {arq && !etapa && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Arquivo enviado</dt><dd className="truncate text-right font-medium">{arq.nome}</dd>
          <dt className="text-slate-500">Linhas lidas</dt><dd className="text-right font-medium">{fmt(arq.linhasLidas)}</dd>
          <dt className="text-slate-500">Registros válidos</dt><dd className="text-right font-medium">{fmt(arq.validos)}</dd>
          <dt className="text-slate-500">Rejeitados (erros)</dt><dd className={`text-right font-medium ${arq.rejeitados ? 'text-red-600' : ''}`}>{fmt(arq.rejeitados)}</dd>
          {arq.agregadas ? <><dt className="text-slate-500">Linhas somadas (lotes)</dt><dd className="text-right font-medium">{fmt(arq.agregadas)}</dd></> : null}
          {arq.ignoradas ? <><dt className="text-slate-500">Linhas ignoradas (totais)</dt><dd className="text-right font-medium">{fmt(arq.ignoradas)}</dd></> : null}
          {arq.posicoes ? <><dt className="text-slate-500">Posições</dt><dd className="text-right font-medium">{fmt(arq.posicoes)}</dd></> : null}
          {arq.skus ? <><dt className="text-slate-500">SKUs</dt><dd className="text-right font-medium">{fmt(arq.skus)}</dd></> : null}
          <dt className="text-slate-500">Duplicados</dt><dd className="text-right font-medium">{fmt(arq.duplicados || 0)}</dd>
          {arq.camposVazios && Object.entries(arq.camposVazios).map(([k, v]) => <><dt key={k} className="text-slate-500">Vazio: {k}</dt><dd key={k + 'v'} className="text-right font-medium">{fmt(v)}</dd></>)}
          <dt className="text-slate-500">Processado em</dt><dd className="text-right font-medium">{arq.finalizadoEm || '—'}</dd>
        </dl>
      )}
      {arq?.motivos?.length ? <Alerta>{arq.motivos.join(' ')}</Alerta> : null}
      {arq?.erros?.length ? <button className="text-xs font-semibold text-brand-600 underline" onClick={() => baixarErros(tipo, arq.erros)}>Baixar relatório de erros ({arq.erros.length})</button> : null}
    </div>
  );
}

export default function Importacao() {
  const user = useUser();
  const { dados: est, erro, carregando, recarregar } = useCarregar<Estado>(() => rpc('importacao.estado'), []);
  const [msg, setMsg] = useState(''); const [err2, setErr2] = useState(''); const [ocupado, setOcupado] = useState(false); const [conf, setConf] = useState(false);
  if (carregando) return <Carregando />;
  if (erro || !est) return <Alerta>{erro}</Alerta>;
  const ab = est.aberta; const arqs = ab?.resumo.arquivos || {};
  const todosOk = (['ARM', 'CF', 'BASE'] as Tipo[]).every(t => arqs[t]?.status === 'APROVADO');
  const previa = ab?.resumo.previa; const validada = ab?.status === 'VALIDADA';

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    setErr2(''); setMsg(''); setOcupado(true);
    try { await fn(); setMsg(ok); setConf(false); recarregar(); } catch (e) { setErr2(msgErro(e)); } finally { setOcupado(false); }
  };

  return (
    <div className="space-y-6">
      <Titulo acao={<span className="text-sm text-slate-500">Versão ativa: <b className="text-slate-900">{est.versaoAtiva || 'nenhuma'}</b></span>}>Central de Atualização das Bases</Titulo>
      <Alerta tipo="info">Envie os três relatórios oficiais. A base só é atualizada quando os <b>três</b> estiverem aprovados e você confirmar. Nada é publicado parcialmente e a versão anterior fica guardada.</Alerta>
      {msg && <Alerta tipo="ok">{msg}</Alerta>}{err2 && <Alerta>{err2}</Alerta>}

      <div className="grid gap-4 lg:grid-cols-3">{(['ARM', 'CF', 'BASE'] as Tipo[]).map(t => <Cartao key={t} tipo={t} est={est} onMudou={recarregar} />)}</div>

      {ab && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="font-bold">Ciclo de carga {ab.versao}</h2><p className="text-xs text-slate-500">Status: {ab.status}</p></div>
            <div className="flex gap-2">
              <button className="btn btn-secondary" disabled={ocupado} onClick={() => confirm('Cancelar este ciclo de carga? Os arquivos enviados serão descartados.') && acao(() => rpc('importacao.cancelar', { importId: ab.id }), 'Ciclo cancelado.')}>Cancelar ciclo</button>
              <button className="btn btn-primary" disabled={!todosOk || ocupado} onClick={() => acao(() => rpc('importacao.previa', { importId: ab.id }), 'Prévia gerada. Confira o resumo abaixo.')}>{ocupado ? 'Processando…' : 'Gerar prévia e conferir'}</button>
            </div>
          </div>
          {!todosOk && <p className="text-sm text-amber-700">Pendentes: {(['ARM', 'CF', 'BASE'] as Tipo[]).filter(t => arqs[t]?.status !== 'APROVADO').map(t => TITULOS[t].split('— ')[1]).join(', ')}.</p>}
          {validada && previa && (
            <div className="space-y-3">
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">Indicador</th><th className="th text-right">Nova carga</th><th className="th text-right">Versão ativa</th></tr></thead><tbody>
                {[['Unidades armazenadas (posição+SKU)', 'linhasArm'], ['SKUs no armazenado', 'skusArm'], ['Posições', 'posicoes'], ['Quantidade total armazenada', 'qtdArm'], ['Registros cliente/fiscal (SKU)', 'linhasCf'], ['Registros de divergência base', 'linhasBase']].map(([r, k]) =>
                  <tr key={k}><td className="td">{r}</td><td className="td text-right font-semibold">{fmt(previa.atual[k])}</td><td className="td text-right text-slate-500">{previa.anterior ? fmt(previa.anterior[k]) : '—'}</td></tr>)}
              </tbody></table></div>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <Alerta tipo={previa.armazenadoSemClienteFiscal ? 'aviso' : 'ok'}>SKUs do armazenado sem cadastro no cliente/fiscal: <b>{fmt(previa.armazenadoSemClienteFiscal)}</b></Alerta>
                <Alerta tipo={previa.baseSemCadastro ? 'aviso' : 'ok'}>SKUs da divergência base sem cadastro: <b>{fmt(previa.baseSemCadastro)}</b></Alerta>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={conf} onChange={e => setConf(e.target.checked)} /> Conferi o resumo e confirmo a atualização da base.</label>
              <button className="btn btn-primary" disabled={!conf || ocupado} onClick={() => acao(() => rpc('importacao.publicar', { importId: ab.id, confirmar: true }), 'Base atualizada e liberada para os inventários.')}>Confirmar e publicar nova versão</button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-bold">Histórico de importações</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="th">ID</th><th className="th">Data</th><th className="th">Analista</th><th className="th">Versão</th><th className="th text-right">Registros (Arm/Cli/Base)</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
          {est.historico.map(h => (
            <tr key={h.ID}><td className="td">{h.ID}</td><td className="td">{h.DATA} {h.HORA}</td><td className="td">{h.ANALISTA_NOME}</td><td className="td">{h.NOVA_VERSAO}</td>
              <td className="td text-right">{fmt(h.REG_ARM || 0)} / {fmt(h.REG_CF || 0)} / {fmt(h.REG_BASE || 0)}</td><td className="td">{h.STATUS}</td>
              <td className="td text-right">{user.perfil === 'ADMINISTRADOR' && h.STATUS === 'SUBSTITUIDA' && <button className="text-xs font-semibold text-brand-600 underline" disabled={ocupado}
                onClick={() => confirm(`Restaurar a versão ${h.NOVA_VERSAO}? Ela voltará a ser a base ativa dos novos inventários.`) && acao(() => rpc('importacao.restaurar', { importId: h.ID }), 'Versão restaurada.')}>Restaurar</button>}</td></tr>
          ))}
          {!est.historico.length && <tr><td className="td text-slate-500" colSpan={7}>Nenhuma importação ainda.</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  );
}
