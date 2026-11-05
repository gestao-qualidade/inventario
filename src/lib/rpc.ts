'use client';
export class ErroApp extends Error { codigo: string; constructor(m: string, c: string) { super(m); this.codigo = c; } }

export async function rpc<T = any>(action: string, payload: unknown = {}): Promise<T> {
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
