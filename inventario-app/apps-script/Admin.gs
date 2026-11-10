/**
 * Admin.gs — limpeza e exclusão de registros. SOMENTE o administrador (a matriz PERMS já barra os demais;
 * aqui há uma segunda trava). Toda exclusão exige confirmação digitada e fica registrada na auditoria.
 */
var Adm = {
  exigir: function (user, p, esperado) {
    if (!user || user.PERFIL !== 'ADMINISTRADOR') throw new AppError('NEGADO', 'Somente o administrador pode excluir registros.');
    if (Util.s(p.confirmar) !== Util.s(esperado)) throw new AppError('CONFIRMACAO', 'Digite "' + esperado + '" para confirmar.');
  },

  /** Divergências / inclusões: exclui os IDs informados. */
  excluirRegistros: function (user, p) {
    Adm.exigir(user, p, 'EXCLUIR');
    var tab = p.tabela === 'INCLUSOES' ? 'INCLUSOES' : 'DIVERGENCIAS';
    var set = {}, n = 0; (p.ids || []).forEach(function (id) { set[String(id)] = 1; n++; });
    if (!n) throw new AppError('DADOS', 'Nenhum registro selecionado.');
    var rem = DB.removeIf(tab, 'ID', function (v) { return set[String(v)] === 1; });
    Audit.log(user, 'REGISTROS_EXCLUIDOS', tab, '', { solicitados: n, removidos: rem });
    return { removidos: rem };
  },

  excluirUsuario: function (user, p) {
    var u = Auth.porId(p.id);
    if (!u) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado.');
    Adm.exigir(user, p, u.LOGIN);
    if (u.ID === user.ID) throw new AppError('DADOS', 'Você não pode excluir o próprio usuário.');
    if (u.PERFIL === 'ADMINISTRADOR' && DB.all('USUARIOS').filter(function (x) { return x.PERFIL === 'ADMINISTRADOR' && x.STATUS === 'ATIVO' && x.ID !== u.ID; }).length === 0)
      throw new AppError('DADOS', 'Este é o único administrador ativo.');
    var usou = DB.find('CONTAGENS', 'OPERADOR_ID', u.ID).length + DB.find('CHECK_POSICAO', 'OPERADOR_ID', u.ID).length + DB.find('INCLUSOES', 'OPERADOR_ID', u.ID).length;
    if (usou) throw new AppError('DADOS', 'Este usuário já tem contagens registradas. Para preservar o histórico, use "Bloquear" em vez de excluir.');
    DB.removeWhere('USUARIOS', 'ID', u.ID);
    Audit.log(user, 'USUARIO_EXCLUIDO', 'USUARIO', u.ID, { login: u.LOGIN, perfil: u.PERFIL });
    return { ok: true };
  },

  excluirRegra: function (user, p) {
    Adm.exigir(user, p, 'EXCLUIR');
    var r = DB.find('REGRAS', 'ID', p.id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Regra não encontrada.');
    DB.removeWhere('REGRAS', 'ID', r.ID); DB.removeWhere('HISTORICO_REGRAS', 'REGRA_ID', r.ID);
    Audit.log(user, 'REGRA_EXCLUIDA', 'REGRA', r.ID, { acao: r.ACAO, cliente: r.CLIENTE });
    return { ok: true };
  },

  /** Auditoria: apaga registros anteriores à data (AAAA-MM-DD). A própria limpeza fica registrada. */
  limparAuditoria: function (user, p) {
    Adm.exigir(user, p, 'EXCLUIR');
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(Util.s(p.antesDe));
    if (!m) throw new AppError('DADOS', 'Informe a data limite.');
    var limite = Number(m[1] + m[2] + m[3]);
    var rem = DB.removeIf('AUDITORIA', 'DATA_HORA', function (v) {
      var d = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v)); return !!d && Number(d[3] + d[2] + d[1]) < limite;
    });
    Audit.log(user, 'AUDITORIA_LIMPA', 'AUDITORIA', '', { antesDe: p.antesDe, removidos: rem });
    return { removidos: rem };
  },

  /** Importação: apaga os dados (abas) de uma versão antiga. Não permite apagar a versão ativa. */
  excluirVersao: function (user, p) {
    Adm.exigir(user, p, 'EXCLUIR');
    var rec = Imp.obter(p.importId);
    if (!rec.NOVA_VERSAO) throw new AppError('DADOS', 'Esta importação não gerou versão.');
    if (rec.NOVA_VERSAO === Cfg.get('VERSAO_ATIVA')) throw new AppError('STATUS', 'Esta é a base ativa. Publique outra antes de excluir.');
    if (rec.STATUS === 'RECEBENDO') throw new AppError('STATUS', 'Importação em andamento: cancele-a primeiro.');
    TIPOS_ARQ.forEach(function (t) { DB.drop(Schema.versionTab(t, rec.NOVA_VERSAO)); });
    Imp.salvar(rec, { RESULTADO: 'Dados da versão excluídos por ' + user.NOME });
    Audit.log(user, 'VERSAO_EXCLUIDA', 'IMPORTACAO', rec.ID, { versao: rec.NOVA_VERSAO });
    return { ok: true };
  }
};
