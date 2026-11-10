import { NextRequest, NextResponse } from 'next/server';
import { chamarGas } from '@/lib/gas';
import { criarSessao, encerrarSessao, lerSessao } from '@/lib/session';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { action?: string; payload?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, erro: 'Requisição inválida.', codigo: 'DADOS' }, { status: 400 }); }
  const action = String(body.action || '');

  if (action === 'logout') { encerrarSessao(); return NextResponse.json({ ok: true, dados: {} }); }

  if (action === 'login') {
    const r = await chamarGas('login', null, body.payload);
    if (r.ok) { await criarSessao((r.dados as { id: string }).id); }
    return NextResponse.json(r);
  }

  const uid = await lerSessao();
  if (!uid) return NextResponse.json({ ok: false, codigo: 'SESSAO', erro: 'Sessão expirada. Faça login novamente.' }, { status: 401 });
  const r = await chamarGas(action, uid, body.payload ?? {});
  return NextResponse.json(r, { status: r.ok ? 200 : (r.codigo === 'SESSAO' ? 401 : 200) });
}
