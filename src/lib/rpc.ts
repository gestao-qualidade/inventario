'use client';
export class ErroApp extends Error { codigo: string; constructor(m: string, c: string) { super(m); this.codigo = c; } }

// Cache de LEITURA no navegador: abre/volta de telas sem esperar o Google de novo.
// Só vale para telas de consulta (nunca para a contagem do operador). Qualquer gravação limpa tudo.
const LEITURAS = new Set(['inventario.listar', 'inventario.dashboard', 'inventario.catalogo', 'mapa.dados', 'mapa.posicao', 'importacao.estado', 'importacao.historico', 'importacao.opcoesBase',
  'regras.listar', 'regras.historico', 'usuarios.listar', 'usuarios.operadores', 'config.obter', 'mensagens.listar', 'auditoria.listar', 'tratativas.listar', 'inclusoes.listar', 'check.inventarios']);
const TTL_MS = 15 * 60 * 1000;
const guardado = new Map<string, { t: number; p: Promise<any> }>();
export const limparCache = () => guardado.clear();

export async function rpc<T = any>(action: string, payload: unknown = {}): Promise<T> {
  if (!LEITURAS.has(action)) {
    const r = await rpcDireto<T>(action, payload);
    guardado.clear(); // gravou algo: o que estava guardado pode estar velho
    return r;
  }
  const chave = action + '|' + JSON.stringify(payload ?? {});
  const g = guardado.get(chave);
  if (g && Date.now() - g.t < TTL_MS) return g.p as Promise<T>;
  const p = rpcDireto<T>(action, payload); guardado.set(chave, { t: Date.now(), p });
  p.catch(() => { if (guardado.get(chave)?.p === p) guardado.delete(chave); });
  return p;
}

async function rpcDireto<T = any>(action: string, payload: unknown = {}): Promise<T> {
  const r = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  let j: any;
  try { j = await r.json(); } catch { throw new ErroApp('Resposta inválida do servidor.', 'RESPOSTA'); }
  if (!j.ok) {
    if (j.codigo === 'SESSAO' && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login';
    throw new ErroApp(j.erro || 'Erro inesperado.', j.codigo || 'ERRO');
  }
  return j.dados as T;
}
export const msgErro = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');
