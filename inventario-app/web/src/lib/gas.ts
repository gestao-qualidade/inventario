/** Chamada servidor→Apps Script. O segredo e a URL nunca chegam ao navegador. */
export type GasResp<T = unknown> = { ok: true; dados: T } | { ok: false; erro: string; codigo: string };

export async function chamarGas(action: string, userId: string | null, payload: unknown): Promise<GasResp> {
  const url = process.env.APPS_SCRIPT_URL, secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return { ok: false, codigo: 'CONFIG', erro: 'Servidor não configurado (APPS_SCRIPT_URL / APPS_SCRIPT_SECRET).' };
  try {
    const r = await fetch(url, { method: 'POST', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret, action, userId, payload }) });
    const txt = await r.text();
    try { return JSON.parse(txt) as GasResp; } catch { return { ok: false, codigo: 'RESPOSTA', erro: 'Resposta inválida do Google Apps Script.' }; }
  } catch {
    return { ok: false, codigo: 'REDE', erro: 'Não foi possível falar com o Google Apps Script. Tente novamente.' };
  }
}
