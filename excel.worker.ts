/// <reference lib="webworker" />
import { processar, Tipo } from '@/lib/excelProcess';

self.onmessage = (ev: MessageEvent<{ tipo: Tipo; buffer: ArrayBuffer }>) => {
  try { (self as unknown as Worker).postMessage({ ok: true, res: processar(ev.data.tipo, ev.data.buffer) }); }
  catch (e) { (self as unknown as Worker).postMessage({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao ler o arquivo.' }); }
};
