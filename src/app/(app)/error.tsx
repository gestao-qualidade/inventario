'use client';
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-6 shadow">
      <h2 className="text-lg font-extrabold text-red-700">Algo deu errado nesta tela</h2>
      <p className="mt-2 text-sm text-slate-600">Tente de novo. Se continuar, tire um print desta mensagem e envie para o suporte.</p>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs text-slate-700">{error.message}</pre>
      <button className="btn btn-primary mt-4" onClick={reset}>Tentar de novo</button>
    </div>
  );
}
