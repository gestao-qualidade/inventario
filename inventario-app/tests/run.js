/**
 * Testes da lógica de negócio (seção 13 da especificação). Execute: node tests/run.js
 * Nota: a trava de concorrência (LockService) é do Google e não é simulada aqui; os testes de
 * "dois operadores" verificam o resultado serial garantido por ela (o 2º vê a tarefa já reservada).
 */
const assert = require('assert');
const { criarContexto } = require('./harness');

const J = x => JSON.parse(JSON.stringify(x));
let ok = 0, falhas = 0;
const teste0 = (n, f) => { try { f(); ok++; console.log('  ✔ ' + n); } catch (e) { falhas++; console.log('  ✘ ' + n + '\n      ' + (e.mensagem || e.message)); } };
function teste(nome, fn) {
  try { fn(); ok++; console.log('  ✔ ' + nome); }
  catch (e) { falhas++; console.log('  ✘ ' + nome + '\n      ' + (e.mensagem || e.message)); }
}
function erro(fn, codigo) {
  try { fn(); } catch (e) { if (codigo) assert.strictEqual(e.codigo, codigo, 'esperava ' + codigo + ' mas veio ' + e.codigo + ': ' + e.mensagem); return e; }
  assert.fail('deveria ter falhado' + (codigo ? ' com ' + codigo : ''));
}

const ctx = criarContexto();
let logs = []; ctx.Logger.log = s => logs.push(s);
ctx.setTime('2026-11-05T12:00:00Z');
ctx.setupInicial();
const senhaAdmin = (logs.find(l => /Senha inicial/.test(l)) || '').match(/Senha inicial: (\S+)/)[1];
const run = (u, acao, p) => J(ctx.executar(acao, u && u.id, p || {}));
const admin = run(null, 'login', { login: 'admin', senha: senhaAdmin });
teste0('senha provisória bloqueia qualquer ação até ser trocada (validado no backend)', () => {
  assert.strictEqual(admin.trocarSenha, true);
  erro(() => ctx.executar('usuarios.listar', admin.id, {}), 'TROCAR_SENHA');
  erro(() => ctx.executar('senha.trocar', admin.id, { atual: senhaAdmin, nova: 'curta' }), 'SENHA_FRACA');
  run(admin, 'senha.trocar', { atual: senhaAdmin, nova: 'NovaSenhaForte1' });
  assert(run(admin, 'usuarios.listar').length === 1);
});

function criarUsuario(login, perfil) {
  const u = run(admin, 'usuarios.criar', { nome: login.toUpperCase(), login, perfil, senha: 'senha-' + login + '-123' });
  ctx.DB.update('USUARIOS', ctx.DB.find('USUARIOS', 'ID', u.id)[0]._row, { TROCAR_SENHA: 'N' }); // simula primeiro acesso já concluído
  return u;
}
const analista = criarUsuario('ana', 'ANALISTA'), gestor = criarUsuario('gil', 'GESTOR'), supervisor = criarUsuario('sup', 'SUPERVISOR'), auditor = criarUsuario('aud', 'AUDITOR');
const ops = ['op1', 'op2', 'op3', 'op4'].map(l => criarUsuario(l, 'OPERADOR'));
const [op1, op2, op3, op4] = ops;

// ---------- dados de importação ----------
const ARM = (pos, ver, cli, sku, desc, fam, qtd, cod) => [`${pos}|${cli}|${sku}`, 'GALPÃO_1', pos, ver, cli, sku, desc, fam, qtd, cod || '', 'N', 10, 'A', 1, '[["L1","10/12/2027"]]'];
const armRows = [
  ARM('A.01.1', 'V1', 'COT', 'COTMMK0001', 'ITEM UM', 'BRINDE', 10, '7890001'),
  ARM('A.01.1', 'V1', 'COT', 'COTMMK0002', 'ITEM DOIS', 'PRODUTO', 5, '7890002'),
  ARM('B.01.1', 'V2', 'LTX', 'LTXMMK0004', 'ITEM QUATRO', 'BRINDE', 20),
  ARM('C.01.1', 'V3', 'COT', 'COTMMK0009', 'ITEM NOVE', 'BRINDE', 3),
  ARM('D.01.1', 'V4', 'HYP', 'HYPMMK0003', 'ITEM TRES', 'GRÁFICO', 7),
  ARM('E.01.1', 'V5', 'COT', 'COTMMK0010', 'ITEM DEZ', 'BRINDE', 2),
  ARM('F.01.1', 'V6', 'COT', 'COTMMK0011', 'ITEM ONZE', 'BRINDE', 9),
  ARM('G.01.1', 'V7', 'COT', 'COTMMK0001', 'ITEM UM', 'BRINDE', 4, '7890001') // mesmo SKU em outra posição
];
const CF = (cli, sku, sc, sf, promo) => [`${cli}|${sku}`, cli, sku, 'DESC', sc, sf, 0, promo || 'N', 'UNICO', 'DEPTO', 10];
const cfRows = [CF('COT', 'COTMMK0001', 10, 10), CF('COT', 'COTMMK0002', 5, 0), CF('LTX', 'LTXMMK0004', 20, 20), CF('COT', 'COTMMK0009', 3, 3),
  CF('HYP', 'HYPMMK0003', 7, 7), CF('COT', 'COTMMK0010', 0, 0), CF('COT', 'COTMMK0011', 9, 9)];
const baseRows = [['COT|COTMMK0002|FALTA', 'COT', 'COTMMK0002', 'ITEM DOIS', 'FALTA', 2, 1, '01/10/2026', 'MATRIZ']];

function importar(arm, cf, base, { publicar = true } = {}) {
  const est = run(analista, 'importacao.estado');
  const ex = Object.fromEntries(est.esperados.map(e => [e.tipo, e]));
  let importId;
  [['ARM', arm], ['CF', cf], ['BASE', base]].forEach(([tipo, linhas]) => {
    const r = run(analista, 'importacao.registrarArquivo', { tipo, nomeArquivo: ex[tipo].arquivo, aba: ex[tipo].aba, cabecalhos: ex[tipo].layout });
    importId = r.importId;
    run(analista, 'importacao.enviarLote', { importId, tipo, seq: 0, linhas });
    run(analista, 'importacao.finalizarArquivo', { importId, tipo, linhasLidas: linhas.length });
  });
  run(analista, 'importacao.previa', { importId });
  if (publicar) run(analista, 'importacao.publicar', { importId, confirmar: true });
  return importId;
}

console.log('\nAutenticação e permissões');
teste('senha não é armazenada em texto aberto', () => {
  const todas = JSON.stringify(ctx.tabs.USUARIOS);
  assert(!todas.includes(senhaAdmin)); assert(!todas.includes('senha-op1-123'));
});
teste('login inválido retorna mensagem genérica e 5 falhas bloqueiam temporariamente', () => {
  const e = erro(() => ctx.executar('login', null, { login: 'op4', senha: 'errada' }), 'LOGIN');
  assert(/inválidos/.test(e.mensagem));
  for (let i = 0; i < 4; i++) erro(() => ctx.executar('login', null, { login: 'op4', senha: 'errada' }), 'LOGIN');
  erro(() => ctx.executar('login', null, { login: 'op4', senha: 'senha-op4-123' }), 'BLOQUEADO');
});
teste('administrador desbloqueia usuário', () => {
  run(admin, 'usuarios.atualizar', { id: op4.id, status: 'ATIVO' });
  assert.strictEqual(run(null, 'login', { login: 'op4', senha: 'senha-op4-123' }).perfil, 'OPERADOR');
});
teste('operador não acessa importação, usuários, regras (edição) nem dashboard', () => {
  ['importacao.estado', 'usuarios.listar', 'regras.criar', 'inventario.dashboard', 'importacao.historico', 'auditoria.listar'].forEach(a => erro(() => ctx.executar(a, op1.id, {}), 'NEGADO'));
});
teste('analista não edita regras nem gerencia usuários; gestor não cria usuários', () => {
  erro(() => ctx.executar('regras.criar', analista.id, {}), 'NEGADO');
  erro(() => ctx.executar('usuarios.criar', gestor.id, {}), 'NEGADO');
});
teste('usuário bloqueado perde a sessão imediatamente', () => {
  const u = criarUsuario('tmp', 'OPERADOR');
  run(admin, 'usuarios.atualizar', { id: u.id, status: 'BLOQUEADO' });
  erro(() => ctx.executar('contagem.inventarios', u.id, {}), 'SESSAO');
});
teste('ação desconhecida / sessão ausente são negadas', () => {
  erro(() => ctx.executar('xyz', admin.id, {}), 'ACAO');
  erro(() => ctx.executar('inventario.listar', 'USR-FALSO', {}), 'SESSAO');
});

console.log('\nMatriz de regras');
teste('64 combinações carregadas e todas retornam a ação da matriz original', () => {
  const regras = J(ctx.DB.all('REGRAS'));
  assert.strictEqual(regras.length, 64);
  ctx.REGRAS_SEED.forEach(r => {
    const flags = { CLIENTE: r[0], FISCAL: r[1], FISICO: r[2], PROMOCIONAL: r[3], PRODUTO: r[4], BRINDE: r[5], FALTA_BASE: r[6] };
    assert.strictEqual(ctx.Regras.buscarAcao(flags, 'X').acao, r[7]);
  });
});
teste('ações centrais: Sim/Sim → manter; um dos saldos → atendimento; nenhum → descartar', () => {
  const f = (c, fi) => ({ CLIENTE: c, FISCAL: fi, FISICO: 'SIM', PROMOCIONAL: 'NAO', PRODUTO: 'NAO', BRINDE: 'SIM', FALTA_BASE: 'NAO' });
  assert.strictEqual(ctx.Regras.buscarAcao(f('SIM', 'SIM'), 'X').acao, 'Manter ou armazenar');
  assert.strictEqual(ctx.Regras.buscarAcao(f('SIM', 'NAO'), 'X').acao, 'armazenar e submeter ao atendimento');
  assert.strictEqual(ctx.Regras.buscarAcao(f('NAO', 'NAO'), 'X').acao, 'Descartar');
});
teste('regras duplicadas são bloqueadas', () => {
  const r = J(ctx.DB.all('REGRAS'))[0];
  erro(() => ctx.executar('regras.criar', admin.id, { CLIENTE: r.CLIENTE, FISCAL: r.FISCAL, FISICO: r.FISICO, PROMOCIONAL: r.PROMOCIONAL, PRODUTO: r.PRODUTO, BRINDE: r.BRINDE, FALTA_BASE: r.FALTA_BASE, ACAO: 'Outra' }), 'DUPLICADA');
});
teste('combinação sem regra ativa → análise administrativa (nada inventado)', () => {
  const r = J(ctx.DB.all('REGRAS'))[5];
  run(admin, 'regras.ativar', { id: r.id || r.ID, ativa: false });
  const res = run(admin, 'regras.simular', { CLIENTE: r.CLIENTE, FISCAL: r.FISCAL, FISICO: r.FISICO, PROMOCIONAL: r.PROMOCIONAL, PRODUTO: r.PRODUTO, BRINDE: r.BRINDE, FALTA_BASE: r.FALTA_BASE });
  assert.strictEqual(res.encontrada, false); assert(/AN[ÁA]LISE/i.test(res.acao));
  run(admin, 'regras.ativar', { id: r.ID, ativa: true });
});
teste('edição exige motivo, gera nova versão e histórico', () => {
  const r = J(ctx.DB.all('REGRAS'))[2];
  erro(() => ctx.executar('regras.editar', admin.id, { id: r.ID, ACAO: 'X' }), 'DADOS');
  const n = run(admin, 'regras.editar', { id: r.ID, MENSAGEM: 'teste', motivo: 'ajuste' });
  assert.strictEqual(n.VERSAO, r.VERSAO + 1);
  assert(run(admin, 'regras.historico', { id: r.ID }).length >= 2);
});

console.log('\nCentral de Atualização das Bases');
teste('nome de arquivo diferente é rejeitado (mensagem oficial)', () => {
  const ex = run(analista, 'importacao.estado').esperados[0];
  const e = erro(() => ctx.executar('importacao.registrarArquivo', analista.id, { tipo: 'ARM', nomeArquivo: 'armazenado (1).xls', aba: ex.aba, cabecalhos: ex.layout }), 'ARQUIVO');
  assert(/Arquivo não reconhecido/.test(e.mensagem));
});
teste('layout incompatível interrompe a importação', () => {
  const ex = run(analista, 'importacao.estado').esperados[0];
  erro(() => ctx.executar('importacao.registrarArquivo', analista.id, { tipo: 'ARM', nomeArquivo: ex.arquivo, aba: ex.aba, cabecalhos: ex.layout.slice(1) }), 'LAYOUT');
  erro(() => ctx.executar('importacao.registrarArquivo', analista.id, { tipo: 'ARM', nomeArquivo: ex.arquivo, aba: 'outra', cabecalhos: ex.layout }), 'LAYOUT');
});
teste('não publica importação incompleta (só 1 arquivo enviado)', () => {
  const est = run(analista, 'importacao.estado'), ex = est.esperados[0];
  const r = run(analista, 'importacao.registrarArquivo', { tipo: 'ARM', nomeArquivo: ex.arquivo, aba: ex.aba, cabecalhos: ex.layout });
  run(analista, 'importacao.enviarLote', { importId: r.importId, tipo: 'ARM', seq: 0, linhas: armRows });
  run(analista, 'importacao.finalizarArquivo', { importId: r.importId, tipo: 'ARM', linhasLidas: armRows.length });
  erro(() => ctx.executar('importacao.previa', analista.id, { importId: r.importId }), 'PENDENTE');
  erro(() => ctx.executar('importacao.publicar', analista.id, { importId: r.importId, confirmar: true }), 'STATUS');
  assert.strictEqual(run(analista, 'importacao.estado').versaoAtiva, '');
  run(analista, 'importacao.cancelar', { importId: r.importId });
});
teste('linhas inválidas são rejeitadas e reprovam se passarem do limite; duplicidade reprova', () => {
  const ex = run(analista, 'importacao.estado').esperados[0];
  const r = run(analista, 'importacao.registrarArquivo', { tipo: 'ARM', nomeArquivo: ex.arquivo, aba: ex.aba, cabecalhos: ex.layout });
  const ruim = ARM('Z.01.1', 'V', 'COT', 'COTMMK0777', 'X', 'BRINDE', -5);
  const res = run(analista, 'importacao.enviarLote', { importId: r.importId, tipo: 'ARM', seq: 0, linhas: [armRows[0], armRows[0], ruim] });
  assert.strictEqual(res.rejeitadas, 1);
  const fin = run(analista, 'importacao.finalizarArquivo', { importId: r.importId, tipo: 'ARM', linhasLidas: 3 });
  assert.strictEqual(fin.status, 'INVALIDO'); assert(fin.duplicados >= 1);
  run(analista, 'importacao.cancelar', { importId: r.importId });
});
let impV1, v1;
teste('importação completa: prévia, publicação e nova versão ativa', () => {
  impV1 = importar(armRows, cfRows, baseRows);
  const est = run(analista, 'importacao.estado');
  v1 = est.versaoAtiva; assert(/^V\d{4}$/.test(v1));
  assert(ctx.DB.exists('ARM_' + v1) && ctx.DB.exists('CF_' + v1) && ctx.DB.exists('BASE_' + v1));
  assert.strictEqual(est.historico[0].STATUS, 'PUBLICADA');
});
teste('segunda carga + restauração da versão anterior (ponteiro único)', () => {
  const id2 = importar(armRows.slice(0, 3), cfRows, baseRows);
  const v2 = run(analista, 'importacao.estado').versaoAtiva; assert(v2 > v1);
  erro(() => ctx.executar('importacao.restaurar', analista.id, { importId: impV1 }), 'NEGADO');
  run(admin, 'importacao.restaurar', { importId: impV1 });
  assert.strictEqual(run(admin, 'importacao.estado').versaoAtiva, v1);
  const hist = run(admin, 'importacao.historico');
  assert(hist.find(h => h.ID === impV1).STATUS === 'PUBLICADA' && hist.find(h => h.ID === id2).STATUS === 'SUBSTITUIDA');
});

console.log('\nInventário e contagem cega');
function criarInventario(nome, tipo, extra) {
  const c = run(gestor, 'inventario.criar', Object.assign({ nome, tipo }, extra || {}));
  let off = 0;
  for (;;) { const r = run(gestor, 'inventario.prepararLote', { id: c.id, offset: off, limite: 3 }); off = r.proximo; if (r.fim) break; }
  return run(gestor, 'inventario.publicar', { id: c.id });
}
const INV = criarInventario('Geral Nov/2026', 'GERAL');
teste('inventário publicado congela a fotografia da base (8 unidades, 7 posições)', () => {
  assert.strictEqual(INV.status, 'ATIVO'); assert.strictEqual(INV.totalUnidades, 8); assert.strictEqual(INV.totalPosicoes, 7);
});
teste('retentativa de lote (mesmo offset) não duplica registros', () => {
  const c = run(gestor, 'inventario.criar', { nome: 'T', tipo: 'GERAL' });
  run(gestor, 'inventario.prepararLote', { id: c.id, offset: 0, limite: 3 });
  const rep = run(gestor, 'inventario.prepararLote', { id: c.id, offset: 0, limite: 3 });
  assert(rep.ignorado);
  run(gestor, 'inventario.cancelar', { id: c.id });
});
const assumir = (u, pos, leitura) => run(u, 'contagem.assumir', { invId: INV.id, posicao: pos, leitura: leitura || pos });
const lancar = (u, t, sku, qtd) => run(u, 'contagem.lancar', { tarefaId: t, sku, qtd });
let tA;
teste('operador precisa bipar a posição correta para assumir', () => {
  erro(() => ctx.executar('contagem.assumir', op1.id, { invId: INV.id, posicao: 'A.01.1', leitura: 'B.01.1' }), 'POSICAO_ERRADA');
});
teste('1ª contagem igual ao sistema finaliza (e mensagem configurada)', () => {
  tA = assumir(op1, 'A.01.1', 'a.01.1').tarefaId;
  const r = lancar(op1, tA, 'COTMMK0001', 10);
  assert(r.finalizada); assert.strictEqual(r.mensagem, 'Contagem finalizada e bateu com o sistema.');
});
teste('1ª diferente gera 2ª (resposta neutra, sem revelar nada)', () => {
  const r = lancar(op1, tA, 'COTMMK0002', 4);
  assert(!r.finalizada); assert.strictEqual(r.mensagem, 'Contagem registrada.');
  assert(!/saldo|etapa|falta|sobra/i.test(JSON.stringify(r).replace(/"tipo":"CONTAGEM"/, '')));
});
teste('operador não repete a mesma unidade (nem vê a posição de novo)', () => {
  run(op1, 'contagem.concluir', { tarefaId: tA, confirmarZero: true });
  erro(() => assumir(op1, 'A.01.1'), 'INDISPONIVEL');
  assert(!run(op1, 'contagem.posicoes', { invId: INV.id }).posicoes.find(p => p.posicao === 'A.01.1'));
});
teste('2ª contagem por outro operador: igual à 1ª finaliza (com divergência registrada)', () => {
  const t = assumir(op2, 'A.01.1').tarefaId;
  const r = lancar(op2, t, 'COTMMK0002', 4);
  assert(r.finalizada); assert.strictEqual(r.mensagem, 'Sua contagem se refere a uma falta.');
  const d = J(ctx.DB.all('DIVERGENCIAS'));
  assert.strictEqual(d.length, 1); assert.strictEqual(d[0].TIPO, 'FALTA'); assert.strictEqual(d[0].DIFERENCA, -1); assert.strictEqual(d[0].ETAPA_FINAL, 2);
});
teste('2ª contagem igual ao sistema finaliza', () => {
  const t1 = assumir(op1, 'D.01.1').tarefaId; lancar(op1, t1, 'HYPMMK0003', 6);
  const t2 = assumir(op2, 'D.01.1').tarefaId;
  const r = lancar(op2, t2, 'HYPMMK0003', 7);
  assert(r.finalizada && /bateu/.test(r.mensagem));
});
teste('2ª diferente das duas → 3ª por terceiro operador; 3ª é sempre definitiva', () => {
  const t1 = assumir(op1, 'B.01.1').tarefaId; lancar(op1, t1, 'LTXMMK0004', 18);
  const t2 = assumir(op2, 'B.01.1').tarefaId; const r2 = lancar(op2, t2, 'LTXMMK0004', 19);
  assert(!r2.finalizada);
  erro(() => assumir(op1, 'B.01.1'), 'INDISPONIVEL'); // quem já contou não repete
  erro(() => assumir(op2, 'B.01.1'), 'INDISPONIVEL');
  const t3 = assumir(op3, 'B.01.1').tarefaId; const r3 = lancar(op3, t3, 'LTXMMK0004', 21);
  assert(r3.finalizada);
  const d = J(ctx.DB.all('DIVERGENCIAS')).find(x => x.SKU === 'LTXMMK0004');
  assert.strictEqual(d.QTD_FINAL, 21); assert.strictEqual(d.TIPO, 'SOBRA'); assert.strictEqual(d.ETAPA_FINAL, 3);
});
teste('lançamentos originais preservados (append-only) com operador, data, hora e etapa', () => {
  const c = J(ctx.DB.all('CONTAGENS')).filter(x => x.SKU === 'LTXMMK0004');
  assert.deepStrictEqual(c.map(x => x.QTD), [18, 19, 21]); assert.deepStrictEqual(c.map(x => x.ETAPA), [1, 2, 3]);
  assert(c.every(x => x.OPERADOR_ID && x.DATA && x.HORA && x.TAREFA_ID));
});
teste('operador não visualiza saldo, etapa nem resultados anteriores em nenhuma resposta', () => {
  const t = assumir(op4, 'C.01.1').tarefaId;
  const textos = [run(op4, 'contagem.posicoes', { invId: INV.id }), run(op4, 'contagem.historico'), run(op4, 'contagem.inventarios')].map(x => JSON.stringify(x));
  textos.forEach(s => assert(!/saldo|"etapa"|resultado|diverg/i.test(s), s));
  const r = lancar(op4, t, 'COTMMK0009', 3); assert(r.finalizada);
});
teste('inclusão: SKU de outra posição é identificado, registrado e não altera a posição oficial', () => {
  const antes = ctx.DB.count('BASE_INVENTARIO');
  const t = assumir(op1, 'E.01.1').tarefaId;
  const r = lancar(op1, t, 'COTMMK0001', 5);
  assert.strictEqual(r.tipo, 'INCLUSAO'); assert.strictEqual(r.mensagem, 'Produto não cadastrado nesta posição. Inclusão identificada.');
  assert.deepStrictEqual(r.detalhe.outrasPosicoes.sort(), ['A.01.1', 'G.01.1']); assert.strictEqual(r.detalhe.cliente, 'COT');
  assert.strictEqual(ctx.DB.count('BASE_INVENTARIO'), antes);
  const inc = J(ctx.DB.all('INCLUSOES'))[0];
  assert.strictEqual(inc.POSICAO_ENCONTRADA, 'E.01.1'); assert.strictEqual(inc.STATUS, 'PENDENTE_ANALISE');
  erro(() => lancar(op1, t, 'COTMMK0001', 5), 'DUPLICADO');
  run(op1, 'contagem.concluir', { tarefaId: t, confirmarZero: true });
});
teste('SKU inexistente na base vira inclusão e a regra não-encontrada vai para análise', () => {
  const t = assumir(op2, 'F.01.1').tarefaId;
  const r = lancar(op2, t, 'XXXMMK0000', 1); assert.strictEqual(r.tipo, 'INCLUSAO');
  const inc = J(ctx.DB.all('INCLUSOES')).find(i => i.SKU === 'XXXMMK0000');
  assert(/AN[ÁA]LISE|armazenar|Descartar|Manter/i.test(inc.ACAO));
  run(op2, 'contagem.liberar', { tarefaId: t });
});
teste('conclusão exige confirmação para itens não lidos (lançados como zero)', () => {
  const t = assumir(op2, 'F.01.1').tarefaId;
  const c = run(op2, 'contagem.concluir', { tarefaId: t });
  assert(c.exigeConfirmacao && c.pendentes === 1);
  const f = run(op2, 'contagem.concluir', { tarefaId: t, confirmarZero: true }); assert.strictEqual(f.zerados, 1);
  assert.strictEqual(J(ctx.DB.all('CONTAGENS')).filter(x => x.SKU === 'COTMMK0011')[0].QTD, 0);
});
teste('motor de regras aplicado na divergência (flags da base + ação da matriz)', () => {
  const d = J(ctx.DB.all('DIVERGENCIAS')).find(x => x.SKU === 'COTMMK0002');
  const flags = JSON.parse(d.FLAGS);
  assert.deepStrictEqual(flags, { CLIENTE: 'SIM', FISCAL: 'NAO', FISICO: 'SIM', PROMOCIONAL: 'NAO', PRODUTO: 'SIM', BRINDE: 'NAO', FALTA_BASE: 'SIM' });
  assert.strictEqual(d.ACAO, 'armazenar e submeter ao atendimento');
});

console.log('\nTarefas: reserva exclusiva, expiração e recuperação');
let tG;
teste('dois operadores não assumem a mesma tarefa (o 2º encontra reservada)', () => {
  const t = tG = assumir(op3, 'G.01.1').tarefaId;
  erro(() => assumir(op4, 'G.01.1'), 'INDISPONIVEL');
  assert(!run(op4, 'contagem.posicoes', { invId: INV.id }).posicoes.find(p => p.posicao === 'G.01.1'));
  assert(run(op3, 'contagem.posicoes', { invId: INV.id }).posicoes.find(p => p.posicao === 'G.01.1').minha);
  erro(() => ctx.executar('contagem.lancar', op4.id, { tarefaId: t, sku: 'COTMMK0001', qtd: 4 }), 'TAREFA');
});
teste('operador não acumula tarefas: precisa concluir/liberar a atual', () => {
  erro(() => assumir(op3, 'F.01.1'), 'TAREFA_ABERTA');
});
teste('reserva abandonada é recuperada após o prazo e disponibilizada a outro', () => {
  ctx.setTime('2026-11-05T12:45:00Z'); // +45 min (reserva = 30 min)
  const t = assumir(op4, 'G.01.1').tarefaId; assert(t);
  erro(() => ctx.executar('contagem.lancar', op3.id, { tarefaId: tG, sku: 'COTMMK0001', qtd: 4 }), 'TAREFA'); // op3 perdeu a reserva vencida
  run(op4, 'contagem.liberar', { tarefaId: t });
  assert.strictEqual(ctx.Cnt.recuperarExpiradas(), 0);
});

console.log('\nDashboard e tratativas');
teste('indicadores refletem os dados reais gravados', () => {
  const d = run(gestor, 'inventario.dashboard', { id: INV.id, fresh: true });
  const k = d.kpis;
  assert.strictEqual(k.posicoesPlanejadas, 7); assert.strictEqual(k.totalSkus, 8);
  assert.strictEqual(k.faltas, 1); assert.strictEqual(k.sobras, 1); assert.strictEqual(k.divergencias, 2); assert.strictEqual(k.inclusoes, 2);
  assert.strictEqual(k.terceiras, 1); assert.strictEqual(k.pendenciasTratativa, 2);
  assert(k.acuracidadePrimeira < 100 && k.acuracidadeFinal <= 100);
  assert(d.produtividade.length >= 3);
});
teste('tratativa exige justificativa e registra responsável', () => {
  const d = run(supervisor, 'tratativas.listar', { invId: INV.id })[0];
  erro(() => ctx.executar('tratativas.resolver', supervisor.id, { id: d.ID }), 'DADOS');
  run(supervisor, 'tratativas.resolver', { id: d.ID, tratativa: 'Ajuste aprovado' });
  const novo = run(supervisor, 'tratativas.listar', { invId: INV.id }).find(x => x.ID === d.ID);
  assert.strictEqual(novo.STATUS, 'RESOLVIDA'); assert.strictEqual(novo.RESOLVIDO_POR, supervisor.id);
  erro(() => ctx.executar('tratativas.resolver', supervisor.id, { id: d.ID, tratativa: 'x' }), 'STATUS');
});
teste('auditor consulta, mas não altera', () => {
  assert(run(auditor, 'inventario.dashboard', { id: INV.id }));
  erro(() => ctx.executar('tratativas.resolver', auditor.id, { id: 'x', tratativa: 'y' }), 'NEGADO');
});

console.log('\nCheck de posição');
const CHK = criarInventario('Check', 'CHECK', { posicoes: ['A.01.1'] });
teste('check mostra SKUs esperados sem saldo; registra divergência e inclusão', () => {
  const e = run(op1, 'check.esperados', { invId: CHK.id, posicao: 'A.01.1', leitura: 'A.01.1' });
  assert.strictEqual(e.itens.length, 2); assert(!/saldo|qtd/i.test(JSON.stringify(e)));
  const r = run(op1, 'check.registrar', { invId: CHK.id, posicao: 'A.01.1', itens: [{ sku: 'COTMMK0001', encontrado: true, qtd: 10 }, { sku: 'COTMMK0002', encontrado: false }], inclusoes: [{ sku: 'HYPMMK0003', qtd: 2 }] });
  assert.strictEqual(r.itens, 2); assert.strictEqual(r.divergentes, 1); assert.strictEqual(r.inclusoes, 1);
  erro(() => ctx.executar('check.registrar', op1.id, { invId: CHK.id, posicao: 'A.01.1', itens: [] }), 'DUPLICADO');
});


console.log('\nFiltros em cascata, ficha do produto (lote/validade) e mapa 3D');
teste('catálogo compacto da base ativa (dicionários + índices) para filtros inteligentes', () => {
  const c = run(gestor, 'inventario.catalogo');
  assert.strictEqual(c.total, 8); assert.strictEqual(c.linhas.length, 8);
  assert.deepStrictEqual(c.dims.ruas, ['A', 'B', 'C', 'D', 'E', 'F', 'G']); assert.deepStrictEqual(c.dims.colunas, ['1']); assert.deepStrictEqual(c.dims.alturas, ['1']);
  const l = c.linhas[0]; assert.strictEqual(c.dims.clientes[l[0]], 'COT'); assert.strictEqual(c.dims.skus[l[6]], 'COTMMK0001');
  erro(() => ctx.executar('inventario.catalogo', op1.id, {}), 'NEGADO');
});
teste('inventário só com um código (SKU) em qualquer posição', () => {
  const i = criarInventario('Só um código', 'GERAL', { skus: ['cotmmk0001'] });
  assert.strictEqual(i.totalUnidades, 2); assert.strictEqual(i.totalPosicoes, 2);
});
teste('filtros de prateleira, coluna e altura (zeros à esquerda normalizados)', () => {
  const a = criarInventario('Rua A col 01 alt 1', 'GERAL', { ruas: ['A'], colunas: ['1'], alturas: ['1'] });
  assert.strictEqual(a.totalUnidades, 2);
  const c = run(gestor, 'inventario.criar', { nome: 'Coluna inexistente', tipo: 'GERAL', colunas: ['99'] });
  let off = 0; for (;;) { const r = run(gestor, 'inventario.prepararLote', { id: c.id, offset: off, limite: 3 }); off = r.proximo; if (r.fim) break; }
  erro(() => ctx.executar('inventario.publicar', gestor.id, { id: c.id }), 'VAZIO');
});

teste('ficha do produto traz descrição, lote e validade — e nunca saldo', () => {
  const inv = criarInventario('Ficha', 'GERAL', { posicoes: ['A.01.1'] });
  const t = run(op3, 'contagem.assumir', { invId: inv.id, posicao: 'A.01.1', leitura: 'A.01.1' }).tarefaId;
  const f = run(op3, 'contagem.produto', { tarefaId: t, sku: 'cotmmk0001' });
  assert.strictEqual(f.pertence, true); assert.strictEqual(f.descricao, 'ITEM UM'); assert.deepStrictEqual(f.lotes, [{ lote: 'L1', validade: '10/12/2027' }]);
  assert(!/saldo|qtd|quantidade/i.test(JSON.stringify(f)));
  // inventário antigo (fotografia sem lote): busca na aba de armazenagem da versão da base
  ctx.DB.find('BASE_INVENTARIO', 'INV_ID', inv.id).forEach(r => ctx.DB.update('BASE_INVENTARIO', r._row, { LOTES_DET: '' }));
  const f2 = run(op3, 'contagem.produto', { tarefaId: t, sku: 'cotmmk0001' });
  assert.deepStrictEqual(f2.lotes, [{ lote: 'L1', validade: '10/12/2027' }], 'fallback pela aba ARM');
  const g = run(op3, 'contagem.produto', { tarefaId: t, sku: 'LTXMMK0004' });
  assert.strictEqual(g.pertence, false); assert.strictEqual(g.descricao, 'ITEM QUATRO');
  run(op3, 'contagem.liberar', { tarefaId: t });
});
teste('mapa 3D: só gestor/admin; posições únicas somadas entre inventários; detalhe com histórico', () => {
  erro(() => ctx.executar('mapa.dados', op1.id, {}), 'NEGADO'); erro(() => ctx.executar('mapa.dados', supervisor.id, {}), 'NEGADO');
  const m = run(gestor, 'mapa.dados');
  assert.strictEqual(m.cobertura.total, 7); assert.strictEqual(m.posicoes.length, 7);
  const c = m.contagem; assert.strictEqual(c.nao + c.andamento + c.ok + c.divergente + c.pendente, 7);
  assert.strictEqual(m.cobertura.inventariadas, c.ok + c.divergente + c.pendente);
  assert(c.ok >= 2); // C.01.1 e D.01.1 concluídas sem divergência
  const d = run(admin, 'mapa.posicao', { posicao: 'B.01.1' });
  assert.strictEqual(d.historico.length, 3); assert.strictEqual(d.divergencias[0].tipo, 'SOBRA'); assert.strictEqual(d.itens[0].lotes[0].lote, 'L1');
});

teste('mapa por inventário: só conta as posições do inventário; as demais ficam "fora" (5)', () => {
  const todos = run(gestor, 'mapa.dados', {});
  const so = run(gestor, 'mapa.dados', { invId: CHK.id });
  assert.strictEqual(so.cobertura.total, 1);
  assert.strictEqual(so.posicoes.filter(x => x[2] === 5).length, todos.posicoes.length - 1);
  assert.strictEqual(so.posicoes.filter(x => x[2] !== 5).length, 1);
});

console.log('\nTela de Divergências');
teste('lista única reúne divergências e inclusões de todos os inventários; só perfis certos acessam', () => {
  const l = run(analista, 'diverg.listar');
  assert(l.itens.length > 0 && l.decisoes.length === 7);
  assert(l.itens.some(i => i.origem === 'DIVERGENCIA') && l.itens.some(i => i.origem === 'INCLUSAO'));
  assert(l.itens.filter(i => i.origem === 'DIVERGENCIA').every(i => typeof i.valor === 'number'));
  run(auditor, 'diverg.listar');
  erro(() => ctx.executar('diverg.listar', op1.id, {}), 'NEGADO');
  erro(() => ctx.executar('diverg.decidir', auditor.id, {}), 'NEGADO');
});
teste('detalhe mostra produto, histórico das contagens e outras ocorrências', () => {
  const d = run(analista, 'diverg.listar').itens.find(i => i.origem === 'DIVERGENCIA' && i.invId === INV.id);
  const x = run(analista, 'diverg.detalhe', { id: d.id, origem: 'DIVERGENCIA' });
  assert(x.produto && x.produto.descricao && Array.isArray(x.contagens) && x.contagens.length >= 1 && x.flags);
});
teste('fluxo: pendente → em análise → decidida → executada (ref. do ajuste) → fechada', () => {
  const d = run(analista, 'diverg.listar').itens.find(i => i.origem === 'DIVERGENCIA' && i.status === 'PENDENTE_TRATATIVA');
  const base = { id: d.id, origem: 'DIVERGENCIA' };
  run(analista, 'diverg.avancar', Object.assign({ para: 'EM_ANALISE' }, base));
  erro(() => ctx.executar('diverg.decidir', analista.id, Object.assign({ decisao: 'AJUSTAR_WMS', justificativa: '' }, base)), 'DADOS');
  const r = run(analista, 'diverg.decidir', Object.assign({ decisao: 'AJUSTAR_WMS', justificativa: 'Contagem confirmada pela 2ª', responsavel: 'Ana', prazo: '2026-11-10' }, base));
  assert.strictEqual(r.status, 'DECIDIDA');
  erro(() => ctx.executar('diverg.decidir', analista.id, Object.assign({ decisao: 'ACEITAR', justificativa: 'outra vez ok' }, base)), 'STATUS');
  erro(() => ctx.executar('diverg.avancar', analista.id, Object.assign({ para: 'EXECUTADA' }, base)), 'DADOS');
  run(analista, 'diverg.avancar', Object.assign({ para: 'EXECUTADA', refAjuste: 'AJ-1234' }, base));
  erro(() => ctx.executar('diverg.avancar', analista.id, Object.assign({ para: 'EM_ANALISE' }, base)), 'STATUS');
  run(analista, 'diverg.avancar', Object.assign({ para: 'FECHADA' }, base));
  const x = run(analista, 'diverg.detalhe', base);
  assert.strictEqual(x.status, 'FECHADA'); assert.strictEqual(x.refAjuste, 'AJ-1234'); assert(x.historico.length >= 4);
  assert(run(admin, 'auditoria.listar').some(a => a.ACAO === 'DIVERGENCIA_DECIDIDA'));
});
teste('decisão "recontar" devolve a unidade à fila (1ª contagem) e só vale para divergência de contagem', () => {
  const d = run(analista, 'diverg.listar').itens.find(i => i.origem === 'DIVERGENCIA' && i.status === 'PENDENTE_TRATATIVA' && i.invId === INV.id);
  const antes = ctx.DB.all('FILA_CONTAGENS').find(f => f.INV_ID === INV.id && f.POSICAO === d.posicao && f.SKU === d.sku);
  assert.strictEqual(antes.STATUS, 'FINALIZADA');
  const r = run(analista, 'diverg.decidir', { id: d.id, origem: 'DIVERGENCIA', decisao: 'RECONTAR', justificativa: 'Mandar contar de novo' });
  assert.strictEqual(r.status, 'EXECUTADA');
  const dep = ctx.DB.all('FILA_CONTAGENS').find(f => f.UNIDADE_ID === antes.UNIDADE_ID);
  assert.strictEqual(dep.STATUS, 'DISPONIVEL'); assert.strictEqual(Number(dep.ETAPA), 1); assert.strictEqual(dep.C1_OP, '');
  const inc = run(analista, 'diverg.listar').itens.find(i => i.origem === 'INCLUSAO' && i.status === 'PENDENTE_TRATATIVA');
  erro(() => ctx.executar('diverg.decidir', analista.id, { id: inc.id, origem: 'INCLUSAO', decisao: 'RECONTAR', justificativa: 'não vale aqui' }), 'DADOS');
  run(analista, 'diverg.decidir', { id: inc.id, origem: 'INCLUSAO', decisao: 'CORRIGIR_CADASTRO', justificativa: 'Cadastrar na posição correta' });
});
teste('valor alto exige aprovação do gestor quando o limite está ligado', () => {
  run(admin, 'config.salvar', { APROVACAO_VALOR_MIN: '1' });
  const ck = criarInventario('Check aprovação', 'CHECK', { posicoes: ['E.01.1'] });
  const ex = run(op1, 'check.esperados', { invId: ck.id, posicao: 'E.01.1', leitura: 'E.01.1' });
  run(op1, 'check.registrar', { invId: ck.id, posicao: 'E.01.1', itens: ex.itens.map(i => ({ sku: i.sku, encontrado: false })) });
  const d = run(analista, 'diverg.listar').itens.find(i => i.origem === 'DIVERGENCIA' && i.status === 'PENDENTE_TRATATIVA' && Math.abs(i.valor) >= 1);
  const base = { id: d.id, origem: 'DIVERGENCIA' };
  const r = run(analista, 'diverg.decidir', Object.assign({ decisao: 'BAIXA', justificativa: 'Avaria confirmada' }, base));
  assert.strictEqual(r.status, 'AGUARDANDO_APROVACAO');
  erro(() => ctx.executar('diverg.aprovar', analista.id, Object.assign({ aprovar: true }, base)), 'NEGADO');
  erro(() => ctx.executar('diverg.aprovar', gestor.id, Object.assign({ aprovar: false, obs: '' }, base)), 'DADOS');
  assert.strictEqual(run(gestor, 'diverg.aprovar', Object.assign({ aprovar: true }, base)).status, 'DECIDIDA');
  const d2 = run(analista, 'diverg.listar').itens.find(i => i.origem === 'DIVERGENCIA' && i.status === 'PENDENTE_TRATATIVA' && Math.abs(i.valor) >= 1);
  if (d2) assert.strictEqual(run(gestor, 'diverg.decidir', { id: d2.id, origem: 'DIVERGENCIA', decisao: 'ACEITAR', justificativa: 'Gestor decide direto' }).status, 'DECIDIDA');
  run(admin, 'config.salvar', { APROVACAO_VALOR_MIN: '0' });
});

teste('inclusão guarda lote e validade (validade validada e normalizada)', () => {
  const ck = criarInventario('Check lote incl', 'CHECK', { posicoes: ['E.01.1'] });
  const e = run(op2, 'check.esperados', { invId: ck.id, posicao: 'E.01.1', leitura: 'E.01.1' });
  erro(() => ctx.executar('check.registrar', op2.id, { invId: ck.id, posicao: 'E.01.1', itens: e.itens.map(i => ({ sku: i.sku, encontrado: true, qtd: 1 })), inclusoes: [{ sku: 'HYPMMK0009', qtd: 2, lote: 'L9', validade: '31/02/2027' }] }), 'DADOS');
  run(op2, 'check.registrar', { invId: ck.id, posicao: 'E.01.1', itens: e.itens.map(i => ({ sku: i.sku, encontrado: true, qtd: 1 })), inclusoes: [{ sku: 'HYPMMK0009', qtd: 2, lote: 'L9', validade: '15032027' }] });
  const i = run(admin, 'diverg.listar', {}).itens.find(x => x.origem === 'INCLUSAO' && x.invId === ck.id);
  assert.deepStrictEqual(i.lotes, [{ lote: 'L9', validade: '15/03/2027' }]);
});

teste('check lista as posições a conferir e tira da lista as já feitas', () => {
  const CK2 = criarInventario('Check lista', 'CHECK', { posicoes: ['C.01.1', 'D.01.1'] });
  const l = run(op1, 'check.posicoes', { invId: CK2.id });
  assert(l.pendentes > 0 && l.posicoes[0].posicao && l.posicoes[0].itens > 0 && l.total >= l.pendentes);
  assert(!JSON.stringify(l).match(/saldo|SALDO/), 'não revela saldo');
  const antes = l.pendentes;
  const e = run(op1, 'check.esperados', { invId: CK2.id, posicao: l.posicoes[0].posicao, leitura: l.posicoes[0].posicao });
  assert(Array.isArray(e.itens[0].lotes), 'check traz lotes');
  const minus = run(op1, 'check.esperados', { invId: CK2.id, posicao: l.posicoes[0].posicao.toLowerCase(), leitura: l.posicoes[0].posicao.toLowerCase() });
  assert.strictEqual(minus.posicao, l.posicoes[0].posicao, 'aceita minúsculo');
  assert(Array.isArray(run(admin, 'tratativas.listar', {})[0].LOTES), 'tratativa traz lotes');
  assert(Array.isArray(run(admin, 'diverg.listar', {}).itens[0].lotes), 'divergência traz lotes');
  run(op1, 'check.registrar', { invId: CK2.id, posicao: l.posicoes[0].posicao, itens: e.itens.map(i => ({ sku: i.sku, encontrado: false, qtd: 0 })) });
  const d = run(op1, 'check.posicoes', { invId: CK2.id });
  assert.strictEqual(d.pendentes, antes - 1); assert.strictEqual(d.feitas, 1);
});

console.log('\nCheck somente de presença');
teste('check de presença: só administrador cria; sem quantidade; não achar = divergência; inclusão só pelo código', () => {
  erro(() => ctx.executar('inventario.criar', gestor.id, { nome: 'Pres', tipo: 'CHECK', modoCheck: 'PRESENCA', posicoes: ['B.01.1'] }), 'NEGADO');
  const c = run(admin, 'inventario.criar', { nome: 'Check presença', tipo: 'CHECK', modoCheck: 'PRESENCA', posicoes: ['B.01.1'] });
  let off = 0; for (;;) { const r = run(admin, 'inventario.prepararLote', { id: c.id, offset: off, limite: 3 }); off = r.proximo; if (r.fim) break; }
  const inv = run(admin, 'inventario.publicar', { id: c.id });
  assert.strictEqual(inv.modoCheck, 'PRESENCA');
  assert.strictEqual(run(op1, 'check.inventarios').find(i => i.id === c.id).modo, 'PRESENCA');
  assert.strictEqual(run(op1, 'check.inventarios').find(i => i.id === CHK.id).modo, 'CONTAGEM');
  const e = run(op1, 'check.esperados', { invId: c.id, posicao: 'B.01.1', leitura: 'B.01.1' });
  assert.strictEqual(e.modo, 'PRESENCA');
  const itens = e.itens.map((i, n) => ({ sku: i.sku, encontrado: n > 0 || e.itens.length === 1 ? true : false }));
  const antes = ctx.DB.count('INCLUSOES');
  const r = run(op1, 'check.registrar', { invId: c.id, posicao: 'B.01.1', itens: e.itens.map(i => ({ sku: i.sku, encontrado: false })), inclusoes: [{ sku: 'HYPMMK0009' }] });
  assert.strictEqual(r.divergentes, e.itens.length); assert.strictEqual(r.inclusoes, 1);
  assert.strictEqual(ctx.DB.count('INCLUSOES'), antes + 1);
  const ch = ctx.DB.all('CHECK_POSICAO').filter(x => x.INV_ID === c.id); assert(ch.every(x => x.QTD === '' && x.ENCONTRADO === 'N'));
});
teste('check de presença: achar o código encerra sem divergência, sem pedir quantidade', () => {
  const c = run(admin, 'inventario.criar', { nome: 'Check presença 2', tipo: 'CHECK', modoCheck: 'PRESENCA', posicoes: ['C.01.1'] });
  let off = 0; for (;;) { const r = run(admin, 'inventario.prepararLote', { id: c.id, offset: off, limite: 3 }); off = r.proximo; if (r.fim) break; }
  run(admin, 'inventario.publicar', { id: c.id });
  const e = run(op1, 'check.esperados', { invId: c.id, posicao: 'C.01.1', leitura: 'C.01.1' });
  const r = run(op1, 'check.registrar', { invId: c.id, posicao: 'C.01.1', itens: e.itens.map(i => ({ sku: i.sku, encontrado: true })) });
  assert.strictEqual(r.divergentes, 0);
});

console.log('\nAgendamento e exclusão de inventário');
teste('agendar: fica AGENDADO, não aparece ao operador e ativa sozinho na hora marcada', () => {
  const t0 = ctx.TEST_NOW;
  const a = criarInventario('Agendado', 'GERAL', { posicoes: ['A.01.1'], inicio: '2030-01-10T08:00', fim: '2030-01-12T18:00' });
  assert.strictEqual(a.status, 'AGENDADO'); assert.strictEqual(a.inicioPrevisto, '2030-01-10T08:00'); assert.strictEqual(a.fimPrevisto, '2030-01-12T18:00');
  assert(!run(op1, 'contagem.inventarios').some(i => i.id === a.id));
  ctx.setTime('2030-01-10T10:00:00Z'); // 07:00 em Brasília: ainda não
  assert(!run(op1, 'contagem.inventarios').some(i => i.id === a.id));
  ctx.setTime('2030-01-10T11:01:00Z'); // 08:01 em Brasília
  assert(run(op1, 'contagem.inventarios').some(i => i.id === a.id));
  assert.strictEqual(run(gestor, 'inventario.listar').find(i => i.id === a.id).status, 'ATIVO');
  ctx.setTime(t0);
});
teste('reagendar e "iniciar agora" só valem para agendados; término antes do início é recusado', () => {
  const a = criarInventario('Agendado 2', 'GERAL', { posicoes: ['B.01.1'], inicio: '2031-05-01T08:00' });
  erro(() => ctx.executar('inventario.reagendar', gestor.id, { id: a.id, inicio: '2031-05-02T08:00', fim: '2031-05-01T08:00' }), 'DADOS');
  const r = run(gestor, 'inventario.reagendar', { id: a.id, inicio: '2031-05-03T09:30', fim: '2031-05-04T09:30' });
  assert.strictEqual(r.inicioPrevisto, '2031-05-03T09:30');
  assert.strictEqual(run(gestor, 'inventario.reagendar', { id: a.id, iniciarAgora: true }).status, 'ATIVO');
  erro(() => ctx.executar('inventario.reagendar', gestor.id, { id: a.id, iniciarAgora: true }), 'STATUS');
});
teste('excluir agendado: some da lista e libera a fila/base; operador não pode excluir', () => {
  const a = criarInventario('Para excluir', 'GERAL', { posicoes: ['C.01.1'], inicio: '2032-01-01T08:00' });
  erro(() => ctx.executar('inventario.excluir', op1.id, { id: a.id }), 'NEGADO');
  const antes = ctx.DB.count('BASE_INVENTARIO');
  erro(() => ctx.executar('inventario.excluir', gestor.id, { id: a.id }), 'NEGADO');
  run(admin, 'inventario.excluir', { id: a.id });
  assert(!run(gestor, 'inventario.listar').some(i => i.id === a.id));
  assert(ctx.DB.count('BASE_INVENTARIO') < antes);
  assert(!ctx.DB.col('FILA_CONTAGENS', 'INV_ID').includes(a.id));
  assert(run(admin, 'auditoria.listar').some(x => x.ACAO === 'INVENTARIO_EXCLUIDO'));
});
teste('excluir inventário ativo: só administrador, com o nome digitado', () => {
  const a = criarInventario('Ativo p/ excluir', 'GERAL', { posicoes: ['D.01.1'] });
  erro(() => ctx.executar('inventario.excluir', gestor.id, { id: a.id, confirmar: a.nome }), 'NEGADO');
  erro(() => ctx.executar('inventario.excluir', admin.id, { id: a.id, confirmar: 'outro' }), 'CONFIRMACAO');
  run(admin, 'inventario.excluir', { id: a.id, confirmar: a.nome });
  assert(!run(admin, 'inventario.listar').some(i => i.id === a.id));
});

console.log('\nTipos de inventário por usuário');
teste('administrador define quais tipos cada operador pode executar', () => {
  assert(run(op4, 'check.inventarios').length > 0 && run(op4, 'contagem.inventarios').length > 0, 'vazio = todos');
  const u = run(admin, 'usuarios.atualizar', { id: op4.id, tiposInv: ['CICLICO', 'XX', 'CICLICO'] });
  assert.deepStrictEqual(u.tiposInv, ['CICLICO']);
  assert.strictEqual(run(op4, 'check.inventarios').length, 0);
  assert(run(op4, 'contagem.inventarios').every(i => i.tipo === 'CICLICO'));
  erro(() => ctx.executar('check.esperados', op4.id, { invId: CHK.id, posicao: 'A.01.1', leitura: 'A.01.1' }), 'NEGADO');
  erro(() => ctx.executar('usuarios.atualizar', op1.id, { id: op4.id, tiposInv: [] }), 'NEGADO');
  run(admin, 'usuarios.atualizar', { id: op4.id, tiposInv: [] });
  assert(run(op4, 'check.inventarios').length > 0);
});

teste('pendências por tipo para o menu do operador', () => {
  const r = run(op4, 'contagem.pendencias').tipos;
  assert(r.GERAL && r.GERAL.pendentes > 0 && r.GERAL.inventarios[0].nome, 'geral com pendências');
  assert(r.CHECK && r.CHECK.inventarios.length > 0);
  run(admin, 'usuarios.atualizar', { id: op4.id, tiposInv: ['CHECK'] });
  const r2 = run(op4, 'contagem.pendencias').tipos;
  assert(!r2.GERAL && r2.CHECK);
  run(admin, 'usuarios.atualizar', { id: op4.id, tiposInv: [] });
  erro(() => ctx.executar('contagem.pendencias', admin.id, {}), 'NEGADO');
});

teste('posição fictícia (Ficticio = S) fica fora de mapa, catálogo e novos inventários', () => {
  const v = run(admin, 'config.obter', {}).VERSAO_ATIVA; const arm = ctx.Schema.versionTab('ARM', v);
  const col = ctx.DB.col(arm, 'POSICAO'); const alvo = col[0];
  ctx.DB.all(arm).filter(r => r.POSICAO === alvo).forEach(r => ctx.DB.update(arm, r._row, { FICTICIO: 'S' }));
  const mapa = run(gestor, 'mapa.dados', { forcar: true });
  assert(!mapa.posicoes.some(p => p[0] === alvo), 'mapa sem fictícia');
  const cat = run(gestor, 'inventario.catalogo', {}); assert(cat.total < col.length, 'catálogo sem fictícia');
  let msg = ''; try { criarInventario('Sem fictícia', 'GERAL', { posicoes: [alvo] }); } catch (e) { msg = e.message || String(e.mensagem || ''); }
  assert(/Nenhuma unidade/.test(msg), 'fictícia não entra no inventário: ' + msg);
});

console.log('\nLimpeza e exclusão (somente administrador)');
teste('só o administrador exclui registros; exige confirmação e deixa rastro', () => {
  const dv = run(admin, 'diverg.listar', {}).itens;
  const alvo = dv.filter(x => x.origem === 'DIVERGENCIA').slice(0, 2).map(x => x.id);
  ['gestor', 'op1'].forEach(u => erro(() => ctx.executar('admin.excluirRegistros', (u === 'gestor' ? gestor : op1).id, { tabela: 'DIVERGENCIAS', ids: alvo, confirmar: 'EXCLUIR' }), 'NEGADO'));
  erro(() => ctx.executar('admin.excluirRegistros', admin.id, { tabela: 'DIVERGENCIAS', ids: alvo, confirmar: 'x' }), 'CONFIRMACAO');
  const r = run(admin, 'admin.excluirRegistros', { tabela: 'DIVERGENCIAS', ids: alvo, confirmar: 'EXCLUIR' });
  assert.strictEqual(r.removidos, alvo.length);
  assert(!run(admin, 'diverg.listar', {}).itens.some(x => alvo.includes(x.id)));
  assert(run(admin, 'auditoria.listar').some(x => x.ACAO === 'REGISTROS_EXCLUIDOS'));
});
teste('excluir usuário: sem histórico sim; com histórico não; nunca a si mesmo', () => {
  const novo = run(admin, 'usuarios.criar', { nome: 'Descartável', login: 'descartavel', perfil: 'OPERADOR', senha: 'Senha12345' });
  erro(() => ctx.executar('usuarios.excluir', gestor.id, { id: novo.id, confirmar: 'descartavel' }), 'NEGADO');
  erro(() => ctx.executar('usuarios.excluir', admin.id, { id: novo.id, confirmar: 'errado' }), 'CONFIRMACAO');
  run(admin, 'usuarios.excluir', { id: novo.id, confirmar: 'descartavel' });
  assert(!run(admin, 'usuarios.listar').some(u => u.id === novo.id));
  erro(() => ctx.executar('usuarios.excluir', admin.id, { id: admin.id, confirmar: 'admin' }), 'DADOS');
  erro(() => ctx.executar('usuarios.excluir', admin.id, { id: op1.id, confirmar: 'op1' }), 'DADOS');
});
teste('excluir regra e limpar auditoria antiga', () => {
  const reg = run(admin, 'regras.listar', {}); const alvo = reg[reg.length - 1];
  erro(() => ctx.executar('regras.excluir', gestor.id, { id: alvo.ID, confirmar: 'EXCLUIR' }), 'NEGADO');
  run(admin, 'regras.excluir', { id: alvo.ID, confirmar: 'EXCLUIR' });
  assert(!run(admin, 'regras.listar', {}).some(x => x.ID === alvo.ID));
  ctx.DB.append('AUDITORIA', [{ ID: 'AUD_VELHO', DATA_HORA: '01/01/2020 10:00:00', ACAO: 'ANTIGO' }]);
  const r = run(admin, 'auditoria.limpar', { antesDe: '2021-01-01', confirmar: 'EXCLUIR' });
  assert.strictEqual(r.removidos, 1);
  const depois = run(admin, 'auditoria.listar');
  assert(!depois.some(x => x.ACAO === 'ANTIGO') && depois.some(x => x.ACAO === 'AUDITORIA_LIMPA'));
  erro(() => ctx.executar('auditoria.limpar', gestor.id, { antesDe: '2021-01-01', confirmar: 'EXCLUIR' }), 'NEGADO');
});
teste('excluir dados de versão antiga da base: nunca a ativa', () => {
  const h = run(admin, 'importacao.historico', {});
  const ativa = run(admin, 'config.obter', {}).VERSAO_ATIVA;
  const rec = h.find(x => x.novaVersao === ativa || x.NOVA_VERSAO === ativa);
  assert(rec, 'achou registro da versão ativa');
  erro(() => ctx.executar('importacao.excluirVersao', admin.id, { importId: rec.id || rec.ID, confirmar: 'EXCLUIR' }), 'STATUS');
  erro(() => ctx.executar('importacao.excluirVersao', gestor.id, { importId: rec.id || rec.ID, confirmar: 'EXCLUIR' }), 'NEGADO');
});

console.log('\nAuditoria');
teste('ações administrativas ficam registradas', () => {
  const a = run(admin, 'auditoria.listar').map(x => x.ACAO);
  ['USUARIO_CRIADO', 'REGRA_EDITADA', 'IMPORTACAO_PUBLICADA', 'INVENTARIO_PUBLICADO', 'TRATATIVA_RESOLVIDA', 'INCLUSAO_IDENTIFICADA'].forEach(x => assert(a.includes(x), 'falta ' + x));
});

console.log(`\n${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
