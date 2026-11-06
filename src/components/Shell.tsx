'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc, msgErro, aquecer } from '@/lib/rpc';
import { Alerta, Carregando, Modal, UserCtx, Usuario } from './ui';
import Icon from './Icon';

const MENU: { href: string; rotulo: string; icone: string; perfis: string[] }[] = [
  { href: '/inventarios', rotulo: 'Inventários', icone: 'inventario', perfis: ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'AUDITOR'] },
  { href: '/divergencias', rotulo: 'Divergências', icone: 'auditoria', perfis: ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'ANALISTA', 'AUDITOR'] },
  { href: '/mapa', rotulo: 'Mapa 3D', icone: 'mapa', perfis: ['ADMINISTRADOR', 'GESTOR'] },
  { href: '/check', rotulo: 'Check de posição', icone: 'check', perfis: ['SUPERVISOR'] },
  { href: '/importacao', rotulo: 'Atualização das bases', icone: 'upload', perfis: ['ADMINISTRADOR', 'ANALISTA'] },
  { href: '/regras', rotulo: 'Regras', icone: 'regras', perfis: ['ADMINISTRADOR', 'GESTOR', 'AUDITOR', 'ANALISTA'] },
  { href: '/usuarios', rotulo: 'Usuários', icone: 'usuarios', perfis: ['ADMINISTRADOR'] },
  { href: '/configuracoes', rotulo: 'Configurações', icone: 'config', perfis: ['ADMINISTRADOR'] },
  { href: '/auditoria', rotulo: 'Auditoria', icone: 'auditoria', perfis: ['ADMINISTRADOR', 'AUDITOR'] }
];
const INICIO: Record<string, string> = { OPERADOR: '/contagem', ANALISTA: '/importacao' };
type Pend = Record<string, { pendentes: number; inventarios: { id: string; nome: string; pendentes?: number; modo?: string }[] }>;
const TIPOS_OP: [string, string, string, string][] = [
  ['GERAL', 'Inventário geral', '/contagem/geral', 'contagem'], ['CICLICO', 'Inventário cíclico', '/contagem/ciclico', 'contagem'],
  ['ESPECIAL', 'Inventário especial', '/contagem/especial', 'contagem'], ['CHECK', 'Check de posição', '/check', 'check']];

export default function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [aberto, setAberto] = useState(false);
  const path = usePathname(); const router = useRouter();
  const [pend, setPend] = useState<Pend | null>(null); const [aviso, setAviso] = useState(''); const total = useRef<number | null>(null);
  const op = user?.perfil === 'OPERADOR';
  const buscarPend = useCallback(() => {
    const atualizar = (tipos: Pend) => {
      const t = Object.values(tipos).reduce((a, x) => a + x.pendentes, 0);
      if (total.current !== null && t > total.current) { setAviso('Novo inventário/pendência disponível para você.'); setTimeout(() => setAviso(''), 6000); }
      total.current = t; setPend(tipos);
    };
    rpc<{ tipos: Pend }>('contagem.pendencias').then(r => atualizar(r.tipos)).catch(async () => {
      // Apps Script antigo (sem a ação nova): monta a lista pelas ações que já existiam
      try {
        const [a, c] = await Promise.all([rpc<any[]>('contagem.inventarios'), rpc<any[]>('check.inventarios')]);
        const t: Pend = {};
        a.forEach(i => { const x = t[i.tipo] || (t[i.tipo] = { pendentes: 0, inventarios: [] }); x.inventarios.push({ id: i.id, nome: i.nome }); });
        if (c.length) t.CHECK = { pendentes: c.length, inventarios: c.map(i => ({ id: i.id, nome: i.nome })) };
        atualizar(t);
      } catch { setPend(p => p || {}); }
    });
  }, []);
  useEffect(() => { if (!op || user?.trocarSenha) return; buscarPend(); const t = setInterval(buscarPend, 45000); return () => clearInterval(t); }, [op, user?.trocarSenha, buscarPend]);
  useEffect(() => { if (op) buscarPend(); }, [path, op, buscarPend]);

  useEffect(() => { rpc<Usuario>('sessao.eu').then(u => { setUser(u); if (!u.trocarSenha) aquecer(u.perfil); }).catch(() => router.replace('/login')); }, [router]);
  useEffect(() => { if (user && path === '/') router.replace(INICIO[user.perfil] || '/inventarios'); }, [user, path, router]);
  useEffect(() => setAberto(false), [path]);

  if (!user) return <Carregando texto="Verificando sessão…" />;
  const itens = MENU.filter(m => m.perfis.includes(user.perfil) || user.extras?.includes(m.href));
  const sair = async () => { await rpc('logout').catch(() => {}); location.href = '/login'; };

  return (
    <UserCtx.Provider value={user}>
      <div className="min-h-screen lg:flex">
        <header className="flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-800 px-4 py-3 text-white lg:hidden">
          <button className="text-2xl" onClick={() => setAberto(!aberto)} aria-label="Menu">☰</button><span className="font-semibold">Inventário Logístico</span><span className="w-6" />
        </header>
        <aside className={`${aberto ? 'block' : 'hidden'} w-full shrink-0 bg-gradient-to-b from-slate-950 via-indigo-950 to-blue-900 text-slate-200 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:overflow-auto`}>
          <div className="hidden items-center gap-3 px-5 py-6 lg:flex"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 text-white shadow-lg shadow-cyan-500/30"><Icon nome="inventario" /></div><div><div className="text-base font-extrabold leading-tight text-white">Inventário</div><div className="text-[11px] font-semibold uppercase tracking-widest text-cyan-300">Logístico</div></div></div>
          <nav className="space-y-1 px-3 pb-4">
            {op && <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-cyan-300/80">Meus inventários</div>}
            {op && TIPOS_OP.filter(([k]) => !user.tiposInv?.length || user.tiposInv.includes(k)).map(([k, nome, href, ic]) => { const x = pend?.[k] || { pendentes: 0, inventarios: [] }; const ativo = path.startsWith(href);
              return <Link key={k} href={href} className={`block rounded-xl px-3 py-2.5 transition ${ativo ? 'bg-gradient-to-r from-blue-500/40 to-cyan-400/20 text-white ring-1 ring-white/15' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                <div className="flex items-center gap-3 text-sm font-semibold"><Icon nome={ic} className="h-5 w-5 opacity-90" /><span className="flex-1">{nome}</span>
                  {x.pendentes > 0 && <span className="min-w-[1.5rem] rounded-full bg-red-500 px-2 py-0.5 text-center text-xs font-extrabold text-white shadow shadow-red-900/40">{x.pendentes}</span>}</div>
                <div className="ml-8 mt-0.5 truncate text-[11px] text-cyan-200/80">{x.inventarios.length ? x.inventarios.map(i => i.nome).join(' · ') : pend ? 'Nenhum inventário ativo' : 'Carregando…'}</div></Link>; })}
            {itens.map(i => <Link key={i.href} href={i.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${path.startsWith(i.href) ? 'bg-gradient-to-r from-blue-500/40 to-cyan-400/20 text-white ring-1 ring-white/15' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Icon nome={i.icone} className="h-5 w-5 opacity-90" />{i.rotulo}</Link>)}
          </nav>
          {user.perfil !== 'OPERADOR' && <div className="px-3 pb-2"><button className="w-full rounded-xl bg-white/10 px-3 py-2 text-left text-xs font-semibold text-cyan-200 hover:bg-white/20" onClick={() => window.dispatchEvent(new Event('inv:atualizar'))}>↻ Atualizar dados da tela</button>
            <div className="mt-1 px-1 text-[10px] text-slate-400">As telas guardam o que já carregaram. Clique aqui para buscar de novo.</div></div>}
          <div className="mt-2 border-t border-white/10 px-5 py-4 text-sm">
            <div className="font-semibold text-white">{user.nome}</div><div className="text-xs text-slate-400">{user.perfil}</div>
            <button className="mt-3 text-xs underline" onClick={sair}>Sair</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 lg:p-8">{aviso && <div className="fixed right-4 top-4 z-50 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-xl" onClick={() => setAviso('')}>🔔 {aviso}</div>}{user.trocarSenha ? <TrocarSenha onOk={() => setUser({ ...user, trocarSenha: false })} /> : children}</main>
      </div>
    </UserCtx.Provider>
  );
}

function TrocarSenha({ onOk }: { onOk: () => void }) {
  const [atual, setAtual] = useState(''); const [nova, setNova] = useState(''); const [conf, setConf] = useState('');
  const [erro, setErro] = useState(''); const [env, setEnv] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro('');
    if (nova !== conf) return setErro('A confirmação não confere com a nova senha.');
    setEnv(true);
    try { await rpc('senha.trocar', { atual, nova }); onOk(); } catch (x) { setErro(msgErro(x)); } finally { setEnv(false); }
  };
  return (
    <Modal titulo="Defina uma nova senha" onClose={() => {}}>
      <form onSubmit={enviar} className="space-y-3">
        <Alerta tipo="info">Por segurança, troque a senha provisória antes de continuar. Mínimo de 8 caracteres.</Alerta>
        <div><label className="label">Senha atual</label><input className="input" type="password" value={atual} onChange={e => setAtual(e.target.value)} autoComplete="current-password" required /></div>
        <div><label className="label">Nova senha</label><input className="input" type="password" value={nova} onChange={e => setNova(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
        <div><label className="label">Confirmar nova senha</label><input className="input" type="password" value={conf} onChange={e => setConf(e.target.value)} autoComplete="new-password" required /></div>
        {erro && <Alerta>{erro}</Alerta>}
        <button className="btn btn-primary w-full" disabled={env}>{env ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </Modal>
  );
}
