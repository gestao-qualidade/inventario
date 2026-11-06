'use client';
export class ErroApp extends Error { codigo: string; constructor(m: string, c: string) { super(m); this.codigo = c; } }

// Cache de LEITURA no navegador: abre/volta de telas sem esperar o Google de novo.
// Só vale para telas de consulta (nunca para a contagem do operador). Qualquer gravação limpa tudo.
const LEITURAS = new Set(['inventario.listar', 'inventario.dashboard', 'inventario.catalogo', 'mapa.dados', 'mapa.posicao', 'importacao.estado', 'importacao.historico', 'importacao.opcoesBase',
  'regras.listar', 'regras.historico', 'usuarios.listar', 'usuarios.operadores', 'config.obter', 'mensagens.listar', 'auditoria.listar', 'tratativas.listar', 'inclusoes.listar', 'check.inventarios']);
const SEM_CACHE = new Set(['contagem.pendencias', 'contagem.posicoes', 'check.posicoes', 'sessao.eu']);
const TTL_MS = 15 * 60 * 1000;
const guardado = new Map<string, { t: number; p: Promise<any> }>();
const PREF = 'inv_rpc:';
const lerDisco = (k: string): { t: number; d: any } | null => { try { const s = sessionStorage.getItem(PREF + k); return s ? JSON.parse(s) : null; } catch { return null; } };
const gravarDisco = (k: string, t: number, d: unknown) => { try { const s = JSON.stringify({ t, d }); if (s.length < 400000) sessionStorage.setItem(PREF + k, s); } catch { /* sem espaço: tudo bem */ } };
export const limparCache = () => {
  guardado.clear();
  try { Object.keys(sessionStorage).filter(k => k.startsWith(PREF)).forEach(k => sessionStorage.removeItem(k)); } catch { /* ignora */ }
};

/** Pré-carrega, em segundo plano, as telas que o perfil mais usa (assim o clique no menu já abre pronto). */
const AQUECER: Record<string, string[]> = {
  ADMINISTRADOR: ['inventario.listar', 'diverg.listar', 'mapa.dados', 'regras.listar', 'importacao.estado', 'config.obter', 'usuarios.listar', 'inventario.catalogo'],
  GESTOR: ['inventario.listar', 'diverg.listar', 'mapa.dados', 'regras.listar', 'inventario.catalogo'],
  SUPERVISOR: ['inventario.listar', 'diverg.listar'],
  AUDITOR: ['inventario.listar', 'diverg.listar', 'regras.listar', 'auditoria.listar'],
  ANALISTA: ['importacao.estado', 'diverg.listar', 'regras.listar', 'config.obter']
};
export function aquecer(perfil: string) {
  const fila = [...(AQUECER[perfil] || [])];
  const worker = async () => { for (let a = fila.shift(); a; a = fila.shift()) { try { await rpc(a, {}); } catch { /* ignora */ } } };
  setTimeout(() => { worker(); worker(); }, 1200);
}

export async function rpc<T = any>(action: string, payload: unknown = {}): Promise<T> {
  if (SEM_CACHE.has(action)) return rpcDireto<T>(action, payload);
  if (!LEITURAS.has(action)) {
    const r = await rpcDireto<T>(action, payload);
    limparCache(); // gravou algo: o que estava guardado pode estar velho
    return r;
  }
  const chave = action + '|' + JSON.stringify(payload ?? {});
  const g = guardado.get(chave);
  if (g && Date.now() - g.t < TTL_MS) return g.p as Promise<T>;
  const disco = lerDisco(chave);
  if (disco && Date.now() - disco.t < TTL_MS) { const pd = Promise.resolve(disco.d as T); guardado.set(chave, { t: disco.t, p: pd }); return pd; }
  const t0 = Date.now();
  const p = rpcDireto<T>(action, payload); guardado.set(chave, { t: t0, p });
  p.then(d => { if (guardado.get(chave)?.p === p) gravarDisco(chave, t0, d); }, () => { if (guardado.get(chave)?.p === p) guardado.delete(chave); });
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
