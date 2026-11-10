/**
 * Code.gs — ponto de entrada (Web App) e instalação.
 *
 * O Web App é chamado SOMENTE pelo servidor da Vercel (rota /api/rpc), que envia um segredo
 * compartilhado (API_SECRET, guardado em Propriedades do Script e em variável de ambiente da Vercel).
 * O navegador nunca vê o segredo nem a URL do Apps Script.
 */

/** ação → { fn(user, payload), lock } */
var ROTAS = {
  'sessao.eu': { fn: function (u) { return Auth.publico(u); } },
  'senha.trocar': { fn: Auth.trocarSenha, lock: true },
  'usuarios.listar': { fn: function () { return Auth.listar(); } },
  'usuarios.operadores': { fn: function () { return DB.all('USUARIOS').filter(function (u) { return u.STATUS === 'ATIVO' && u.PERFIL === 'OPERADOR'; }).map(function (u) { return { id: u.ID, nome: u.NOME }; }); } },
  'usuarios.criar': { fn: Auth.criar, lock: true },
  'usuarios.atualizar': { fn: Auth.atualizar, lock: true },
  'usuarios.redefinirSenha': { fn: Auth.redefinirSenha, lock: true },
  'config.obter': { fn: function () { return Cfg.getAll(); } },
  'config.salvar': { fn: function (u, p) {
    var permitidas = Object.keys(CONFIG_PADRAO).filter(function (k) { return ['VERSAO_ATIVA', 'CONTADOR_VERSAO'].indexOf(k) < 0; });
    Object.keys(p).forEach(function (k) { if (permitidas.indexOf(k) >= 0) Cfg.set(k, p[k]); });
    Audit.log(u, 'CONFIG_ALTERADA', 'CONFIG', '', p); return Cfg.getAll();
  }, lock: true },
  'mensagens.listar': { fn: function () { return Object.keys(MENSAGENS_PADRAO).map(function (k) { return { chave: k, texto: Msg.get(k) }; }); } },
  'mensagens.salvar': { fn: function (u, p) {
    if (!MENSAGENS_PADRAO.hasOwnProperty(p.chave)) throw new AppError('DADOS', 'Mensagem inválida.');
    var r = DB.find('MENSAGENS', 'CHAVE', p.chave);
    if (r.length) DB.update('MENSAGENS', r[0]._row, { TEXTO: p.texto }); else DB.append('MENSAGENS', [{ CHAVE: p.chave, TEXTO: p.texto }]);
    Audit.log(u, 'MENSAGEM_ALTERADA', 'MENSAGEM', p.chave, { texto: p.texto }); return { ok: true };
  }, lock: true },

  'importacao.estado': { fn: function () { return Imp.estado(); } },
  'importacao.registrarArquivo': { fn: Imp.registrarArquivo, lock: true },
  'importacao.enviarLote': { fn: Imp.enviarLote, lock: true },
  'importacao.finalizarArquivo': { fn: Imp.finalizarArquivo, lock: true },
  'importacao.previa': { fn: Imp.previa, lock: true },
  'importacao.publicar': { fn: Imp.publicar, lock: true },
  'importacao.cancelar': { fn: Imp.cancelar, lock: true },
  'importacao.restaurar': { fn: Imp.restaurar, lock: true },
  'importacao.historico': { fn: function () { return Imp.historico(); } },
  'importacao.opcoesBase': { fn: function () { return Imp.opcoesBase(); } },

  'inventario.criar': { fn: Inv.criar, lock: true },
  'inventario.prepararLote': { fn: Inv.prepararLote, lock: true },
  'inventario.publicar': { fn: Inv.publicar, lock: true },
  'inventario.encerrar': { fn: Inv.encerrar, lock: true },
  'inventario.cancelar': { fn: Inv.cancelar, lock: true },
  'inventario.reagendar': { fn: Inv.reagendar, lock: true },
  'inventario.excluir': { fn: Inv.excluir, lock: true },
  'inventario.listar': { fn: function () { return Inv.listar(); } },
  'inventario.dashboard': { fn: Inv.dashboard },
  'tratativas.listar': { fn: Inv.tratativas },
  'tratativas.resolver': { fn: Inv.resolverTratativa, lock: true },
  'inclusoes.listar': { fn: Inv.inclusoes },

  'contagem.inventarios': { fn: function (u) { return Cnt.inventariosAbertos(u); } },
  'contagem.pendencias': { fn: function (u) { return Cnt.pendencias(u); } },
  'contagem.posicoes': { fn: Cnt.posicoes },
  'contagem.assumir': { fn: Cnt.assumir, lock: true },
  'contagem.liberar': { fn: Cnt.liberar, lock: true },
  'contagem.lancar': { fn: Cnt.lancar, lock: true },
  'contagem.produto': { fn: Cnt.produto },
  'inventario.catalogo': { fn: function () { return Inv.catalogo(); } },
  'mapa.dados': { fn: Mapa.dados },
  'mapa.posicao': { fn: Mapa.posicao },
  'contagem.concluir': { fn: Cnt.concluir, lock: true },
  'contagem.historico': { fn: function (u) { return Cnt.historico(u); } },
  'check.inventarios': { fn: function (u) { return DB.all('INVENTARIOS').filter(function (i) { return i.STATUS === 'ATIVO' && i.TIPO === 'CHECK' && Auth.podeTipo(u, 'CHECK'); }).map(function (i) { return { id: i.ID, nome: i.NOME, tipo: i.TIPO, modo: Chk.modo(i) }; }); } },
  'check.posicoes': { fn: Chk.posicoes },
  'check.esperados': { fn: Chk.esperados },
  'check.registrar': { fn: Chk.registrar, lock: true },

  'admin.excluirRegistros': { fn: Adm.excluirRegistros, lock: true },
  'usuarios.excluir': { fn: Adm.excluirUsuario, lock: true },
  'regras.excluir': { fn: Adm.excluirRegra, lock: true },
  'auditoria.limpar': { fn: Adm.limparAuditoria, lock: true },
  'importacao.excluirVersao': { fn: Adm.excluirVersao, lock: true },

  'regras.listar': { fn: function () { return Regras.listar(); } },
  'regras.criar': { fn: Regras.criar, lock: true },
  'regras.editar': { fn: Regras.editar, lock: true },
  'regras.ativar': { fn: Regras.ativar, lock: true },
  'regras.simular': { fn: function (u, p) { return Regras.simular(p); } },
  'regras.historico': { fn: function (u, p) { return Regras.historico(p); } },
  'diverg.listar': { fn: Dv.listar },
  'diverg.detalhe': { fn: Dv.detalhe },
  'diverg.decidir': { fn: Dv.decidir, lock: true },
  'diverg.avancar': { fn: Dv.avancar, lock: true },
  'diverg.aprovar': { fn: Dv.aprovar, lock: true },
  'auditoria.listar': { fn: function () { return DB.all('AUDITORIA').slice(-500).reverse(); } }
};

/** Executa uma ação já autenticada (usado pelo doPost e pelos testes). */
function executar(acao, userId, payload) {
  if (acao === 'login') return Auth.login(payload || {});
  var rota = ROTAS[acao];
  if (!rota) throw new AppError('ACAO', 'Ação desconhecida.');
  var user = Auth.exigir(userId, acao);
  var run = function () { return rota.fn(user, payload || {}); };
  return rota.lock ? Lock.run(run) : run();
}

function doPost(e) {
  var resp;
  try {
    var body = JSON.parse(e.postData.contents);
    var segredo = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!segredo || body.secret !== segredo) throw new AppError('NEGADO', 'Acesso negado.');
    resp = { ok: true, dados: executar(body.action, body.userId, body.payload) };
  } catch (err) {
    if (err && err.isAppError) resp = { ok: false, codigo: err.codigo, erro: err.mensagem };
    else {
      var ref = Utilities.getUuid().slice(0, 8);
      console.error('[' + ref + '] ' + (err && err.stack ? err.stack : err));
      resp = { ok: false, codigo: 'INTERNO', erro: 'Erro interno (ref. ' + ref + ').' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(resp)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('API de Inventário ativa.').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * EXECUTE UMA VEZ no editor do Apps Script: cria abas, mensagens, regras (matriz oficial),
 * configurações, segredo da API e o usuário administrador inicial. Veja o resultado em "Execuções"/Registro.
 */
function setupInicial() {
  Object.keys(SCHEMA).forEach(function (t) { DB.ensure(t); });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_SECRET')) props.setProperty('API_SECRET', Utilities.getUuid() + Utilities.getUuid());
  Object.keys(CONFIG_PADRAO).forEach(function (k) { if (!DB.find('CONFIGURACOES', 'CHAVE', k).length) DB.append('CONFIGURACOES', [{ CHAVE: k, VALOR: CONFIG_PADRAO[k] }]); });
  Object.keys(MENSAGENS_PADRAO).forEach(function (k) { if (!DB.find('MENSAGENS', 'CHAVE', k).length) DB.append('MENSAGENS', [{ CHAVE: k, TEXTO: MENSAGENS_PADRAO[k] }]); });
  if (!DB.count('REGRAS')) {
    var d = Util.now();
    var linhas = REGRAS_SEED.map(function (r) {
      return { ID: Util.id('RGR'), CLIENTE: r[0], FISCAL: r[1], FISICO: r[2], PROMOCIONAL: r[3], PRODUTO: r[4], BRINDE: r[5], FALTA_BASE: r[6], ACAO: r[7],
        ATIVA: 'S', INVENTARIOS: '[]', MENSAGEM: '', VERSAO: 1, ATUALIZADO_EM: Util.data(d), ATUALIZADO_POR: 'SETUP' };
    });
    DB.append('REGRAS', linhas);
    linhas.forEach(function (r) { Regras.registrarVersao(null, r, 'Carga inicial da matriz oficial'); });
  }
  var senhaAdmin = '';
  if (!DB.count('USUARIOS')) {
    senhaAdmin = Utilities.getUuid().slice(0, 10) + 'A1';
    Auth.criar(null, { nome: 'Administrador', login: 'admin', perfil: 'ADMINISTRADOR', senha: senhaAdmin, email: '' });
  }
  // remove a aba padrão vazia, se existir
  var padrao = SpreadsheetApp.getActiveSpreadsheet() && SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Página1');
  if (padrao && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(padrao);
  // gatilho de recuperação de tarefas abandonadas (a cada 10 min)
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'gatilhoRecuperar'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('gatilhoRecuperar').timeBased().everyMinutes(10).create();
  Logger.log('=== INSTALAÇÃO CONCLUÍDA ===');
  Logger.log('API_SECRET (copie para a Vercel como APPS_SCRIPT_SECRET): ' + props.getProperty('API_SECRET'));
  if (senhaAdmin) Logger.log('Usuário: admin | Senha inicial: ' + senhaAdmin + '  (será exigida a troca no primeiro acesso)');
  else Logger.log('Usuários já existiam: nenhum admin novo foi criado.');
}

function gatilhoRecuperar() { Lock.run(function () { Cnt.recuperarExpiradas(); Inv.ativarAgendados(); }); }
