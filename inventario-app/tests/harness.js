/**
 * Harness: carrega os .gs (exceto Db.gs) num contexto Node, com um banco em memória que implementa
 * a MESMA interface de DB (all/find/col/append/update/slice/ensure/drop/exists/count).
 * Assim a lógica de negócio real (regras, contagem, importação, permissões) é testada sem o Google.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function criarContexto() {
  const tabs = {};
  const ctx = { console, TEST_NOW: null, tabs };
  ctx.Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    formatDate: (d, tz, fmt) => {
      const p = new Date(d.getTime() - 3 * 3600000); const z = n => String(n).padStart(2, '0');
      const [dd, mm, yy, H, M, S] = [p.getUTCDate(), p.getUTCMonth() + 1, p.getUTCFullYear(), p.getUTCHours(), p.getUTCMinutes(), p.getUTCSeconds()];
      return fmt === 'dd/MM/yyyy' ? `${z(dd)}/${z(mm)}/${yy}` : `${z(H)}:${z(M)}:${z(S)}`;
    }
  };
  const props = {};
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) };
  ctx.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) };
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null, getSheets: () => [] }) };
  ctx.Logger = { log() {} };
  ctx.ContentService = {};
  ctx.LockService = undefined; // execução serial no Node
  ctx.setTime = (iso) => { ctx.TEST_NOW = iso; };

  // Banco em memória
  const NUM = null;
  ctx.DB = {
    exists: t => !!tabs[t],
    ensure: t => { if (!tabs[t]) { ctx.Schema.cols(t); tabs[t] = []; } },
    drop: t => { delete tabs[t]; },
    count: t => tabs[t].length,
    all: t => tabs[t].map((r, i) => Object.assign({}, r, { _row: i + 2 })),
    slice: (t, o, l) => tabs[t].slice(o, o + l).map((r, i) => Object.assign({}, r, { _row: o + i + 2 })),
    col: (t, n) => tabs[t].map(r => (r[n] === undefined ? '' : r[n])),
    append: (t, objs) => { const cols = ctx.Schema.cols(t); objs.forEach(o => { const r = {}; cols.forEach(c => { r[c] = o[c] === undefined ? '' : o[c]; }); tabs[t].push(r); }); },
    removeWhere: (t, n, v) => { const a = tabs[t].length; tabs[t] = tabs[t].filter(r => String(r[n]) !== String(v)); return a - tabs[t].length; },
    removeIf: (t, n, fn) => { const a = tabs[t].length; tabs[t] = tabs[t].filter(r => !fn(r[n])); return a - tabs[t].length; },
    find: (t, n, v) => tabs[t].map((r, i) => Object.assign({}, r, { _row: i + 2 })).filter(r => String(r[n]) === String(v)),
    update: (t, row, patch) => { const cols = ctx.Schema.cols(t); Object.keys(patch).forEach(k => { if (cols.includes(k)) tabs[t][row - 2][k] = patch[k]; }); }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  const ordem = ['Schema.gs', 'Util.gs', 'Auth.gs', 'Regras.gs', 'RegrasSeed.gs', 'Importacao.gs', 'Inventario.gs', 'Contagem.gs', 'Mapa.gs', 'Divergencias.gs', 'Admin.gs', 'Code.gs'];
  // Util.gs/Importacao etc. usam DB em tempo de chamada, então a ordem não importa para o DB de teste
  ordem.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  // globais declarados com var em scripts ficam no contexto: ok
  return ctx;
}
module.exports = { criarContexto };
