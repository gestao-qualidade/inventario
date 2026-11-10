// Servidor local que imita o Web App do Apps Script usando o código .gs real + banco em memória.
// Serve para testar o front sem Google: node tools/mock-gas.js   (porta 8787)
// Com SEED=1 já carrega dados fictícios (login: admin / Admin12345  e  gestor / Senha12345  e  op1 / Senha12345).
const http = require('http'); const { criarContexto } = require('../tests/harness');
const ctx = criarContexto(); const logs = []; ctx.Logger.log = s => logs.push(s);
ctx.setTime(null); ctx.setupInicial();
ctx.ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: s => ({ setMimeType: () => s }) };
const secret = ctx.PropertiesService.getScriptProperties().getProperty('API_SECRET');
const senha = (logs.find(l => /Senha inicial/.test(l)) || '').match(/Senha inicial: (\S+)/)[1];
const J = x => JSON.parse(JSON.stringify(x)); const run = (u, a, p) => J(ctx.executar(a, u && u.id, p || {}));
if (process.env.SEED) {
  const admin = run(null, 'login', { login: 'admin', senha }); run(admin, 'senha.trocar', { atual: senha, nova: 'Admin12345' });
  const mk = (login, perfil) => { const u = run(admin, 'usuarios.criar', { nome: login.toUpperCase(), login, perfil, senha: 'Senha12345' }); ctx.DB.update('USUARIOS', ctx.DB.find('USUARIOS', 'ID', u.id)[0]._row, { TROCAR_SENHA: 'N' }); return u; };
  const gestor = mk('gestor', 'GESTOR'), analista = mk('ana', 'ANALISTA'); const ops = ['op1', 'op2', 'op3'].map(l => mk(l, 'OPERADOR'));
  const arm = [], cf = []; const clis = ['COT', 'HYP', 'DCA'], fams = ['BRINDE', 'PRODUTO', 'GRÁFICO'];
  let n = 0;
  for (const rua of ['A', 'B', 'C', 'D', 'E', 'F']) for (let col = 1; col <= 30; col++) for (let alt = 1; alt <= 4; alt++) {
    const pos = `${rua}.${String(col).padStart(2, '0')}.${alt}`; const cli = clis[(col + alt) % 3]; const sku = `${cli}MMK${String(1000 + (n % 120)).padStart(4, '0')}`; n++;
    arm.push([`${pos}|${cli}|${sku}`, rua < 'D' ? 'GALPÃO_1' : 'SANCA', pos, 'V' + col, cli, sku, 'PRODUTO EXEMPLO ' + sku, fams[n % 3], 5 + (n % 40), '789' + n, 'N', 10 + (n % 50), 'ABC'[n % 3], 1, n % 3 === 0 ? '[["LT' + (n % 90) + '","31/12/2027"]]' : '']);
  }
  new Set(arm.map(a => a[4] + '|' + a[5])).forEach(k => { const [c, s] = k.split('|'); cf.push([k, c, s, 'DESC', 10, n % 2 ? 10 : 0, 0, 'N', 'UNICO', 'DEPTO', 10]); });
  const est = run(analista, 'importacao.estado'); const ex = Object.fromEntries(est.esperados.map(e => [e.tipo, e])); let id;
  const base = [['COT|COTMMK1001|FALTA', 'COT', 'COTMMK1001', 'DESC', 'FALTA', 2, 1, '01/10/2026', 'MATRIZ']];
  [['ARM', arm], ['CF', cf], ['BASE', base]].forEach(([tipo, linhas]) => {
    const r = run(analista, 'importacao.registrarArquivo', { tipo, nomeArquivo: ex[tipo].arquivo, aba: ex[tipo].aba, cabecalhos: ex[tipo].layout }); id = r.importId;
    for (let i = 0, sq = 0; i < linhas.length; i += 1500, sq++) run(analista, 'importacao.enviarLote', { importId: id, tipo, seq: sq, linhas: linhas.slice(i, i + 1500) });
    run(analista, 'importacao.finalizarArquivo', { importId: id, tipo, linhasLidas: linhas.length });
  });
  run(analista, 'importacao.previa', { importId: id }); run(analista, 'importacao.publicar', { importId: id, confirmar: true });
  const c = run(gestor, 'inventario.criar', { nome: 'Geral demonstração', tipo: 'GERAL' });
  for (let off = 0; ;) { const r = run(gestor, 'inventario.prepararLote', { id: c.id, offset: off, limite: 3000 }); off = r.proximo; if (r.fim) break; }
  const inv = run(gestor, 'inventario.publicar', { id: c.id });
  const qtdDe = Object.fromEntries(arm.map(a => [a[2], [a[5], a[8]]]));
  const contar = (op, pos, delta) => { const t = run(op, 'contagem.assumir', { invId: inv.id, posicao: pos, leitura: pos }).tarefaId; run(op, 'contagem.lancar', { tarefaId: t, sku: qtdDe[pos][0], qtd: Math.max(0, qtdDe[pos][1] + delta) }); return t; };
  const posicoes = arm.map(a => a[2]);
  posicoes.slice(0, 50).forEach(p => contar(ops[0], p, 0));                  // concluídas sem divergência
  posicoes.slice(50, 70).forEach(p => { contar(ops[0], p, -2); contar(ops[1], p, -2); }); // divergência (falta) com 2 contagens
  posicoes.slice(70, 78).forEach(p => { contar(ops[0], p, 3); contar(ops[1], p, 1); contar(ops[2], p, 4); }); // 3ª contagem
  posicoes.slice(78, 82).forEach(p => { contar(ops[0], p, 1); });             // aguardando 2ª
  run(ops[1], 'contagem.assumir', { invId: inv.id, posicao: posicoes[90], leitura: posicoes[90] });  // em andamento (reservada)
  run(gestor, 'tratativas.listar', {}).slice(0, 3).forEach(d => run(gestor, 'tratativas.resolver', { id: d.ID, tratativa: 'Ajuste aprovado' }));
  const chk = run(gestor, 'inventario.criar', { nome: 'Check demonstração', tipo: 'CHECK', posicoes: [posicoes[100], posicoes[101]] });
  for (let off = 0; ;) { const r = run(gestor, 'inventario.prepararLote', { id: chk.id, offset: off, limite: 3000 }); off = r.proximo; if (r.fim) break; }
  run(gestor, 'inventario.publicar', { id: chk.id });
}
console.log(JSON.stringify({ secret, senhaAdmin: senha }));
http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
  res.setHeader('Content-Type', 'application/json'); res.end(ctx.doPost({ postData: { contents: b } })); }); }).listen(8787, () => console.log('mock ok'));
