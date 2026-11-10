/**
 * Lê o relatório Excel (.xls/.xlsx) no navegador, valida cabeçalhos, normaliza e agrega.
 * Roda em Web Worker para não travar a tela (arquivos de ~34 MB).
 * Saída: linhas já no formato das abas de versão (ver VSCHEMA no Apps Script).
 */
import * as XLSX from 'xlsx';

export type Tipo = 'ARM' | 'CF' | 'BASE';
export type ErroLinha = { linha: number; motivo: string; chave: string };
export type Resultado = {
  aba: string; cabecalhos: string[]; linhas: (string | number)[][];
  linhasLidas: number; ignoradas: number; rejeitadas: number; agregadas: number; erros: ErroLinha[]; camposVazios: Record<string, number>;
};

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? NaN : n;
};
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Validade do Excel (número serial, Date ou texto) → DD/MM/AAAA. Vazio/0 → ''. */
function validade(v: unknown): string {
  if (v === null || v === undefined || v === '' || v === 0) return '';
  const z = (n: number) => String(n).padStart(2, '0');
  if (v instanceof Date) return `${z(v.getUTCDate())}/${z(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === 'number') { if (v < 20000) return ''; const d = new Date(Math.round((v - 25569) * 86400000)); return `${z(d.getUTCDate())}/${z(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function parseData(s: string): number { // dd/mm/aaaa hh:mm:ss → número ordenável
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(s);
  return m ? Number(m[3] + m[2] + m[1] + (m[4] || '00') + (m[5] || '00') + (m[6] || '00')) : 0;
}

export function processar(tipo: Tipo, wbBuf: ArrayBuffer): Resultado {
  const wb = XLSX.read(wbBuf, { type: 'array', dense: true, cellStyles: false, cellHTML: false, cellFormula: false, cellNF: false });
  const aba = wb.SheetNames[0];
  const ws = wb.Sheets[aba];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
  const cab = (rows[0] || []).map(txt);
  const idx = (n: string) => cab.indexOf(n);
  const res: Resultado = { aba, cabecalhos: cab, linhas: [], linhasLidas: Math.max(rows.length - 1, 0), ignoradas: 0, rejeitadas: 0, agregadas: 0, erros: [], camposVazios: {} };
  const erro = (i: number, motivo: string, chave = '') => { res.rejeitadas++; if (res.erros.length < 500) res.erros.push({ linha: i + 1, motivo, chave }); };
  const vazio = (c: string) => { res.camposVazios[c] = (res.camposVazios[c] || 0) + 1; };

  if (tipo === 'ARM') {
    const c = { pos: idx('id_posicao'), ver: idx('Divito_Verificador'), gal: idx('galpao_en'), fic: idx('Ficticio'), cli: idx('cod_cli'), sku: idx('Codigo'), desc: idx('descricao'),
      fam: idx('Familia'), qtd: idx('Qtde'), cod: idx('cod_it_cli'), val: idx('VALOR UNITARIO MEDIO'), lot: idx('cod_lot_fm'), dval: idx('dat_val_fm') };
    const mapa = new Map<string, any[]>(); const lotes = new Map<string, Set<string>>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const pos = txt(r[c.pos]), cli = txt(r[c.cli]), sku = txt(r[c.sku]).toUpperCase();
      if (!pos && !cli && !sku) { res.ignoradas++; continue; }
      const q = num(r[c.qtd]);
      if (!pos) { erro(i, 'Posição vazia', sku); continue; }
      if (!cli) { erro(i, 'Cliente vazio', sku); continue; }
      if (!sku) { erro(i, 'SKU vazio', pos); continue; }
      if (isNaN(q) || q <= 0) { erro(i, 'Quantidade inválida', pos + '|' + sku); continue; }
      const fam = txt(r[c.fam]); if (!fam) vazio('Familia');
      if (!txt(r[c.ver])) vazio('Divito_Verificador');
      const key = pos + '|' + cli + '|' + sku;
      const ex = mapa.get(key);
      const val = num(r[c.val]) || 0;
      const lt = c.lot >= 0 ? txt(r[c.lot]) : '', lv = c.dval >= 0 ? validade(r[c.dval]) : '';
      if ((lt && lt !== '0') || lv) { const st = lotes.get(key) || new Set<string>(); if (st.size < 10) st.add(JSON.stringify([lt === '0' ? '' : lt, lv])); lotes.set(key, st); }
      if (ex) { ex[8] += q; ex[13] += 1; res.agregadas++; if (!ex[11] && val) ex[11] = val; }
      else mapa.set(key, [key, txt(r[c.gal]), pos, txt(r[c.ver]), cli, sku, txt(r[c.desc]), fam, q, txt(r[c.cod]), txt(r[c.fic]), val, '', 1, '']);
    }
    // Curva ABC por SKU (valor em estoque: quantidade × valor unitário médio), 80/15/5
    const valorSku = new Map<string, number>();
    mapa.forEach(l => valorSku.set(l[5], (valorSku.get(l[5]) || 0) + l[8] * (l[11] || 0)));
    const ord = [...valorSku.entries()].sort((a, b) => b[1] - a[1]);
    const total = ord.reduce((s, [, v]) => s + v, 0) || 1;
    const curva = new Map<string, string>(); let acum = 0;
    ord.forEach(([sku, v]) => { acum += v; curva.set(sku, (acum - v) / total < 0.8 ? 'A' : (acum - v) / total < 0.95 ? 'B' : 'C'); });
    mapa.forEach((l, k) => { l[12] = curva.get(l[5]) || 'C'; const st = lotes.get(k); l[14] = st ? '[' + [...st].join(',') + ']' : ''; res.linhas.push(l); });
  } else if (tipo === 'CF') {
    const c = { cli: idx('CLIENTE'), sku: idx('SKU'), desc: idx('DESCRIÇÃO'), sc: idx('SALDO CLIENTE'), sf: idx('SALDO BOLSAO FISCAL'), fis: idx('SALDO FISICO'),
      promo: idx('DAT VALIDADE CAMPANHA'), grp: idx('GRUPO'), dep: idx('DEPTO'), val: idx('VALOR UNIT') };
    const mapa = new Map<string, any[]>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cli = txt(r[c.cli]), sku = txt(r[c.sku]).toUpperCase();
      if (!cli && !sku) { res.ignoradas++; continue; } // linha de totais / em branco
      if (!cli) { erro(i, 'Cliente vazio', sku); continue; }
      if (!sku) { erro(i, 'SKU vazio', cli); continue; }
      const sc = num(r[c.sc]), sf = num(r[c.sf]), fis = num(r[c.fis]);
      if (isNaN(sc) || isNaN(sf) || isNaN(fis) || sc < 0 || sf < 0 || fis < 0) { erro(i, 'Saldo inválido', cli + '|' + sku); continue; }
      if (!txt(r[c.sf])) vazio('SALDO BOLSAO FISCAL');
      const promo = num(r[c.promo]) > 0 ? 'S' : 'N';
      const key = cli + '|' + sku, ex = mapa.get(key);
      if (ex) { ex[4] += sc; ex[5] += sf; ex[6] += fis; if (promo === 'S') ex[7] = 'S'; res.agregadas++; }
      else mapa.set(key, [key, cli, sku, txt(r[c.desc]), sc, sf, fis, promo, txt(r[c.grp]), txt(r[c.dep]), num(r[c.val]) || 0]);
    }
    mapa.forEach(l => res.linhas.push(l));
  } else {
    const c = { cli: idx('Cliente'), sku: idx('Item'), desc: idx('Descricao'), qtd: idx('Qtde'), dep: idx('Depto'), nf: idx('Numero NF'), dat: idx('Data_Ocorrencia'), ori: idx('Origem') };
    const mapa = new Map<string, any[]>(); const nfs = new Map<string, Set<string>>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const cli = txt(r[c.cli]), sku = txt(r[c.sku]).toUpperCase();
      let tipoB = txt(r[c.dep]).toUpperCase();
      if (!cli && !sku && !tipoB) { res.ignoradas++; continue; }
      if (tipoB.startsWith('AVARIA')) tipoB = 'AVARIA';
      if (!cli) { erro(i, 'Cliente vazio', sku); continue; }
      if (!sku) { erro(i, 'Item vazio', cli); continue; }
      if (!tipoB) { erro(i, 'Depto vazio', cli + '|' + sku); continue; }
      const q = num(r[c.qtd]); if (isNaN(q)) { erro(i, 'Quantidade inválida', cli + '|' + sku); continue; }
      const key = cli + '|' + sku + '|' + tipoB, dat = txt(r[c.dat]);
      const ex = mapa.get(key);
      if (ex) { ex[5] += q; nfs.get(key)!.add(txt(r[c.nf])); res.agregadas++; if (parseData(dat) > parseData(ex[7])) ex[7] = dat; }
      else { mapa.set(key, [key, cli, sku, txt(r[c.desc]), tipoB, q, 1, dat, txt(r[c.ori])]); nfs.set(key, new Set([txt(r[c.nf])])); }
    }
    mapa.forEach((l, k) => { l[6] = nfs.get(k)!.size; res.linhas.push(l); });
  }
  return res;
}

