// Roda a MESMA função de leitura/normalização do navegador contra os arquivos reais.
// Uso: node tools/testa-excel.js /caminho/armazenado.xls /caminho/cliente_fiscal.xls /caminho/base.xls
const fs = require('fs'), path = require('path'), ts = require('../web/node_modules/typescript');
const src = fs.readFileSync(path.join(__dirname, '../web/src/lib/excelProcess.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText;
const Module = require('module'); const m = new Module('excelProcess'); m.paths = Module._nodeModulePaths(path.join(__dirname, '../web'));
m._compile(js, 'excelProcess.js');
const [arm, cf, base] = process.argv.slice(2);
for (const [tipo, f] of [['ARM', arm], ['CF', cf], ['BASE', base]]) {
  const t = Date.now(); const b = fs.readFileSync(f);
  const r = m.exports.processar(tipo, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const curvas = {}; if (tipo === 'ARM') r.linhas.forEach(l => { curvas[l[12]] = (curvas[l[12]] || 0) + 1; });
  console.log(tipo, { aba: r.aba, lidas: r.linhasLidas, validas: r.linhas.length, ignoradas: r.ignoradas, rejeitadas: r.rejeitadas, agregadas: r.agregadas, vazios: r.camposVazios, curvas, seg: ((Date.now() - t) / 1000).toFixed(1) });
  if (r.erros.length) console.log('  erros[0..2]', r.erros.slice(0, 3));
  console.log('  exemplo', JSON.stringify(r.linhas[0]));
}
