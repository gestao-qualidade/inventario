'use client';
import { useState } from 'react';
import Icon from './Icon';

/** Foto do produto: sempre puxada de https://sil.pslogistica.com.br/imagens/CODIGO.JPG */
export const urlFoto = (sku: string) => `https://sil.pslogistica.com.br/imagens/${encodeURIComponent(sku.trim().toUpperCase())}.JPG`;

export default function ProdutoFoto({ sku, className = 'h-24 w-24' }: { sku: string; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!sku || falhou) return <div className={`${className} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400`}><Icon nome="box" className="h-1/2 w-1/2" /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urlFoto(sku)} alt={sku} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} className={`${className} shrink-0 rounded-xl bg-white object-contain ring-1 ring-slate-200`} />;
}
