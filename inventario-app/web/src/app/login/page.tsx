'use client';
import { useState } from 'react';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta } from '@/components/ui';

export default function Login() {
  const [login, setLogin] = useState(''); const [senha, setSenha] = useState(''); const [erro, setErro] = useState(''); const [env, setEnv] = useState(false);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setEnv(true);
    try { await rpc('login', { login, senha }); location.href = '/'; } catch (x) { setErro(msgErro(x)); setEnv(false); }
  };
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-900 to-blue-700 p-4">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-400/25 blur-3xl" /><div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-indigo-400/30 blur-3xl" />
      <form onSubmit={entrar} className="relative w-full max-w-sm space-y-4 rounded-3xl bg-white/95 p-8 shadow-2xl ring-1 ring-white/50 backdrop-blur">
        <div><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-lg shadow-blue-500/30"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /></svg></div>
          <h1 className="grad-text text-3xl font-extrabold">Inventário Logístico</h1><p className="text-sm text-slate-500">Acesse com seu login e senha.</p></div>
        <div><label className="label" htmlFor="login">Login</label><input id="login" className="input" value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus /></div>
        <div><label className="label" htmlFor="senha">Senha</label><input id="senha" className="input" type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="current-password" required /></div>
        {erro && <Alerta>{erro}</Alerta>}
        <button className="btn btn-primary w-full" disabled={env}>{env ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
