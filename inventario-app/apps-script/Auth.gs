/**
 * Auth.gs — usuários, login com senha (hash salgado, nunca texto aberto) e permissões validadas no backend.
 */
var ADM = ['ADMINISTRADOR'];
var GEST = ['ADMINISTRADOR', 'GESTOR'];
var SUP = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR'];
var LEITURA = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'AUDITOR'];
var OPER = ['OPERADOR'];
var ANAL = ['ADMINISTRADOR', 'ANALISTA'];
var DIVL = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'ANALISTA', 'AUDITOR'];
var DIVD = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'ANALISTA'];

/** Matriz ação → perfis permitidos. Qualquer ação fora daqui é negada. */
var PERMS = {
  'sessao.eu': PERFIS, 'senha.trocar': PERFIS,
  'usuarios.listar': ADM, 'usuarios.operadores': GEST, 'usuarios.criar': ADM, 'usuarios.atualizar': ADM, 'usuarios.redefinirSenha': ADM,
  'config.obter': ANAL.concat(['GESTOR']), 'config.salvar': ADM, 'mensagens.listar': ADM, 'mensagens.salvar': ADM,
  'importacao.estado': ANAL, 'importacao.registrarArquivo': ANAL, 'importacao.enviarLote': ANAL, 'importacao.finalizarArquivo': ANAL,
  'importacao.previa': ANAL, 'importacao.publicar': ANAL, 'importacao.cancelar': ANAL, 'importacao.restaurar': ADM,
  'importacao.historico': ADM, 'importacao.opcoesBase': GEST,
  'inventario.criar': GEST, 'inventario.prepararLote': GEST, 'inventario.publicar': GEST, 'inventario.encerrar': GEST,
  'inventario.cancelar': GEST, 'inventario.reagendar': GEST, 'inventario.excluir': ADM, 'inventario.listar': LEITURA, 'inventario.dashboard': LEITURA,
  'tratativas.listar': SUP.concat(['AUDITOR']), 'tratativas.resolver': SUP, 'inclusoes.listar': SUP.concat(['AUDITOR']),
  'contagem.inventarios': OPER, 'contagem.pendencias': OPER, 'contagem.posicoes': OPER, 'contagem.assumir': OPER, 'contagem.liberar': OPER,
  'contagem.lancar': OPER, 'contagem.produto': OPER, 'inventario.catalogo': GEST, 'mapa.dados': GEST, 'mapa.posicao': GEST, 'contagem.concluir': OPER, 'contagem.historico': OPER,
  'check.inventarios': OPER.concat(SUP), 'check.posicoes': OPER.concat(SUP), 'check.esperados': OPER.concat(SUP), 'check.registrar': OPER.concat(SUP),
  'regras.listar': ADM.concat(['GESTOR', 'AUDITOR', 'ANALISTA']), 'regras.criar': ADM, 'regras.editar': ADM, 'regras.ativar': ADM,
  'regras.simular': ADM.concat(['GESTOR', 'AUDITOR']), 'regras.historico': ADM.concat(['GESTOR', 'AUDITOR']),
  'diverg.listar': DIVL, 'diverg.detalhe': DIVL, 'diverg.decidir': DIVD, 'diverg.avancar': DIVD, 'diverg.aprovar': GEST,
  'admin.excluirRegistros': ADM, 'usuarios.excluir': ADM, 'regras.excluir': ADM, 'auditoria.limpar': ADM, 'importacao.excluirVersao': ADM,
  'auditoria.listar': ADM.concat(['AUDITOR'])
};

var Auth = {
  ITER: 1000,
  hash: function (senha, salt) {
    var h = salt + '|' + senha;
    for (var i = 0; i < Auth.ITER; i++) h = Util.sha256hex(h + salt);
    return h;
  },
  novoSalt: function () { return Utilities.getUuid().replace(/-/g, ''); },
  publico: function (u) {
    return { id: u.ID, nome: u.NOME, email: u.EMAIL, login: u.LOGIN, perfil: u.PERFIL, status: u.STATUS,
      extras: Util.json(u.PERMISSOES_EXTRA, []), tiposInv: Util.json(u.TIPOS_INV, []), trocarSenha: u.TROCAR_SENHA === 'S', ultimoAcesso: u.ULTIMO_ACESSO, criadoEm: u.CRIADO_EM };
  },
  /** Tipos de inventário que o usuário pode executar. Lista vazia = todos. */
  tiposValidos: function (l) {
    var ok = ['GERAL', 'CICLICO', 'CHECK', 'ESPECIAL'];
    return (l || []).filter(function (t, i, a) { return ok.indexOf(t) >= 0 && a.indexOf(t) === i; });
  },
  podeTipo: function (u, tipo) { var l = Util.json(u.TIPOS_INV, []); return !l.length || l.indexOf(tipo) >= 0; },
  porId: function (id) { var r = DB.find('USUARIOS', 'ID', id); return r.length ? r[0] : null; },
  porLogin: function (login) { var r = DB.find('USUARIOS', 'LOGIN', Util.s(login).toLowerCase()); return r.length ? r[0] : null; },
  validarSenha: function (s) {
    if (!s || String(s).length < 8) throw new AppError('SENHA_FRACA', 'A senha deve ter pelo menos 8 caracteres.');
  },

  login: function (p) {
    var u = Auth.porLogin(p.login);
    var agora = Util.now().getTime();
    var generico = new AppError('LOGIN', 'Login ou senha inválidos.');
    if (!u) throw generico;
    if (u.STATUS !== 'ATIVO') throw new AppError('BLOQUEADO', 'Usuário bloqueado. Procure o administrador.');
    if (u.BLOQUEADO_ATE && Number(u.BLOQUEADO_ATE) > agora) throw new AppError('BLOQUEADO', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    if (Auth.hash(String(p.senha || ''), u.SALT) !== u.SENHA_HASH) {
      var t = (Number(u.TENTATIVAS) || 0) + 1;
      DB.update('USUARIOS', u._row, { TENTATIVAS: t, BLOQUEADO_ATE: t >= 5 ? agora + 15 * 60000 : '' });
      Audit.log(u, 'LOGIN_FALHA', 'USUARIO', u.ID, {});
      throw generico;
    }
    var d = Util.now();
    DB.update('USUARIOS', u._row, { TENTATIVAS: 0, BLOQUEADO_ATE: '', ULTIMO_ACESSO: Util.data(d) + ' ' + Util.hora(d) });
    Audit.log(u, 'LOGIN', 'USUARIO', u.ID, {});
    return Auth.publico(u);
  },

  /** Valida sessão + permissão da ação. Perfil sempre lido da planilha (nunca confiado ao cliente). */
  exigir: function (userId, acao) {
    var u = userId ? Auth.porId(userId) : null;
    if (!u || u.STATUS !== 'ATIVO') throw new AppError('SESSAO', 'Sessão inválida. Faça login novamente.');
    var perfis = PERMS[acao];
    var extras = Util.json(u.PERMISSOES_EXTRA, []);
    if (!perfis || (perfis.indexOf(u.PERFIL) < 0 && extras.indexOf(acao) < 0)) throw new AppError('NEGADO', 'Você não tem permissão para esta ação.');
    if (u.TROCAR_SENHA === 'S' && acao !== 'sessao.eu' && acao !== 'senha.trocar') throw new AppError('TROCAR_SENHA', 'Troque a senha provisória antes de continuar.');
    return u;
  },

  trocarSenha: function (user, p) {
    var u = Auth.porId(user.ID);
    if (Auth.hash(String(p.atual || ''), u.SALT) !== u.SENHA_HASH) throw new AppError('LOGIN', 'Senha atual incorreta.');
    Auth.validarSenha(p.nova);
    var salt = Auth.novoSalt();
    DB.update('USUARIOS', u._row, { SALT: salt, SENHA_HASH: Auth.hash(String(p.nova), salt), TROCAR_SENHA: 'N' });
    Audit.log(user, 'SENHA_TROCADA', 'USUARIO', u.ID, {});
    return { ok: true };
  },

  listar: function () { return DB.all('USUARIOS').map(Auth.publico); },

  criar: function (user, p) {
    var login = Util.s(p.login).toLowerCase();
    if (!login || !Util.s(p.nome)) throw new AppError('DADOS', 'Informe nome e login.');
    if (PERFIS.indexOf(p.perfil) < 0) throw new AppError('DADOS', 'Perfil inválido.');
    if (Auth.porLogin(login)) throw new AppError('DUPLICADO', 'Já existe usuário com este login.');
    Auth.validarSenha(p.senha);
    var salt = Auth.novoSalt(), d = Util.now();
    var u = { ID: Util.id('USR'), NOME: Util.s(p.nome), EMAIL: Util.s(p.email), LOGIN: login, PERFIL: p.perfil, STATUS: 'ATIVO',
      SENHA_HASH: Auth.hash(String(p.senha), salt), SALT: salt, TENTATIVAS: 0, BLOQUEADO_ATE: '', PERMISSOES_EXTRA: JSON.stringify(p.extras || []), TIPOS_INV: JSON.stringify(Auth.tiposValidos(p.tiposInv)),
      TROCAR_SENHA: 'S', CRIADO_EM: Util.data(d), ULTIMO_ACESSO: '', CRIADO_POR: user ? user.ID : 'SETUP' };
    DB.append('USUARIOS', [u]);
    Audit.log(user, 'USUARIO_CRIADO', 'USUARIO', u.ID, { login: login, perfil: p.perfil });
    return Auth.publico(u);
  },

  atualizar: function (user, p) {
    var u = Auth.porId(p.id);
    if (!u) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado.');
    var patch = {};
    if (p.nome !== undefined) patch.NOME = Util.s(p.nome);
    if (p.email !== undefined) patch.EMAIL = Util.s(p.email);
    if (p.perfil !== undefined) { if (PERFIS.indexOf(p.perfil) < 0) throw new AppError('DADOS', 'Perfil inválido.'); patch.PERFIL = p.perfil; }
    if (p.status !== undefined) {
      if (['ATIVO', 'BLOQUEADO'].indexOf(p.status) < 0) throw new AppError('DADOS', 'Status inválido.');
      if (u.ID === user.ID && p.status !== 'ATIVO') throw new AppError('DADOS', 'Você não pode bloquear o próprio usuário.');
      patch.STATUS = p.status; if (p.status === 'ATIVO') { patch.TENTATIVAS = 0; patch.BLOQUEADO_ATE = ''; }
    }
    if (p.extras !== undefined) patch.PERMISSOES_EXTRA = JSON.stringify(p.extras);
    if (p.tiposInv !== undefined) patch.TIPOS_INV = JSON.stringify(Auth.tiposValidos(p.tiposInv));
    if (u.ID === user.ID && patch.PERFIL && patch.PERFIL !== 'ADMINISTRADOR') throw new AppError('DADOS', 'Você não pode remover o próprio perfil de administrador.');
    DB.update('USUARIOS', u._row, patch);
    Audit.log(user, 'USUARIO_ATUALIZADO', 'USUARIO', u.ID, patch);
    return Auth.publico(Auth.porId(u.ID));
  },

  redefinirSenha: function (user, p) {
    var u = Auth.porId(p.id);
    if (!u) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado.');
    Auth.validarSenha(p.senha);
    var salt = Auth.novoSalt();
    DB.update('USUARIOS', u._row, { SALT: salt, SENHA_HASH: Auth.hash(String(p.senha), salt), TROCAR_SENHA: 'S', TENTATIVAS: 0, BLOQUEADO_ATE: '' });
    Audit.log(user, 'SENHA_REDEFINIDA', 'USUARIO', u.ID, {});
    return { ok: true };
  }
};
