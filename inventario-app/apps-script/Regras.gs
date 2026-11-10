/**
 * Regras.gs — motor da matriz de regras fiscais e do cliente (regras.xlsx = fonte oficial).
 * Nunca inventa resultado: sem regra correspondente (ou regras conflitantes) => análise administrativa.
 */
var CAMPOS_REGRA = ['CLIENTE', 'FISCAL', 'FISICO', 'PROMOCIONAL', 'PRODUTO', 'BRINDE', 'FALTA_BASE'];
var ACAO_ANALISE = 'ENCAMINHAR PARA ANÁLISE ADMINISTRATIVA';

var Regras = {
  sn: function (b) { return b ? 'SIM' : 'NAO'; },

  chave: function (r) { return CAMPOS_REGRA.map(function (c) { return r[c]; }).join('|'); },

  aplicaAoInventario: function (r, invId) {
    var lista = Util.json(r.INVENTARIOS, []);
    return !lista.length || lista.indexOf(invId) >= 0;
  },

  /** flags: {CLIENTE,FISCAL,FISICO,PROMOCIONAL,PRODUTO,BRINDE,FALTA_BASE} com 'SIM'/'NAO'. */
  buscarAcao: function (flags, invId, regrasPreCarregadas) {
    var regras = (regrasPreCarregadas || DB.all('REGRAS')).filter(function (r) { return r.ATIVA === 'S' && Regras.aplicaAoInventario(r, invId); });
    var alvo = Regras.chave(flags);
    var achadas = regras.filter(function (r) { return Regras.chave(r) === alvo; });
    if (achadas.length === 1) return { acao: achadas[0].ACAO, regraId: achadas[0].ID, mensagem: achadas[0].MENSAGEM, encontrada: true };
    if (achadas.length === 0) return { acao: ACAO_ANALISE, regraId: '', mensagem: 'Nenhuma regra correspondente.', encontrada: false };
    var acoes = {}; achadas.forEach(function (r) { acoes[r.ACAO] = 1; });
    if (Object.keys(acoes).length === 1) return { acao: achadas[0].ACAO, regraId: achadas[0].ID, mensagem: achadas[0].MENSAGEM, encontrada: true };
    return { acao: ACAO_ANALISE, regraId: '', mensagem: 'Regras conflitantes.', encontrada: false };
  },

  /** Monta as 7 flags a partir da base ativa (CF/ARM/BASE) e da quantidade física final. */
  montarFlags: function (cliente, sku, qtdFisica, familiaConhecida) {
    var versao = Cfg.get('VERSAO_ATIVA');
    var f = { CLIENTE: 'NAO', FISCAL: 'NAO', FISICO: Regras.sn(qtdFisica > 0), PROMOCIONAL: 'NAO', PRODUTO: 'NAO', BRINDE: 'NAO', FALTA_BASE: 'NAO' };
    var familia = familiaConhecida || '';
    if (versao) {
      var key = cliente + '|' + sku;
      var cfTab = Schema.versionTab('CF', versao), baseTab = Schema.versionTab('BASE', versao), armTab = Schema.versionTab('ARM', versao);
      if (DB.exists(cfTab)) {
        var cf = DB.find(cfTab, 'KEY', key)[0];
        if (cf) { f.CLIENTE = Regras.sn(cf.SALDO_CLIENTE > 0); f.FISCAL = Regras.sn(cf.SALDO_FISCAL > 0); f.PROMOCIONAL = cf.PROMOCIONAL === 'S' ? 'SIM' : 'NAO'; }
      }
      if (DB.exists(baseTab)) {
        var b = DB.find(baseTab, 'KEY', key + '|FALTA')[0];
        f.FALTA_BASE = Regras.sn(!!b);
      }
      if (!familia && DB.exists(armTab)) {
        var a = DB.find(armTab, 'SKU', sku)[0];
        if (a) familia = a.FAMILIA;
      }
    }
    var fam = Util.s(familia).toUpperCase();
    f.PRODUTO = Regras.sn(fam === 'PRODUTO'); f.BRINDE = Regras.sn(fam === 'BRINDE');
    return f;
  },

  validar: function (p, ignorarId) {
    CAMPOS_REGRA.forEach(function (c) { if (['SIM', 'NAO'].indexOf(p[c]) < 0) throw new AppError('DADOS', 'Campo ' + c + ' deve ser SIM ou NAO.'); });
    if (!Util.s(p.ACAO)) throw new AppError('DADOS', 'Informe a ação.');
    var invs = p.INVENTARIOS || [];
    var dup = DB.all('REGRAS').filter(function (r) {
      if (r.ID === ignorarId || Regras.chave(r) !== Regras.chave(p)) return false;
      var a = Util.json(r.INVENTARIOS, []), b = invs;
      if (!a.length || !b.length) return true;
      return a.some(function (x) { return b.indexOf(x) >= 0; });
    });
    if (dup.length) throw new AppError('DUPLICADA', 'Já existe regra para esta combinação' + (dup[0].ACAO !== p.ACAO ? ' (com ação diferente — conflito).' : '.'));
  },

  listar: function () { return DB.all('REGRAS'); },

  registrarVersao: function (user, regra, motivo) {
    var d = Util.now();
    DB.append('HISTORICO_REGRAS', [{ ID: Util.id('HRG'), REGRA_ID: regra.ID, VERSAO: regra.VERSAO, DADOS: JSON.stringify(regra),
      ALTERADO_POR: user ? user.ID : 'SETUP', ALTERADO_EM: Util.data(d) + ' ' + Util.hora(d), MOTIVO: motivo || '' }]);
  },

  criar: function (user, p) {
    var inv = p.INVENTARIOS || [];
    Regras.validar({ CLIENTE: p.CLIENTE, FISCAL: p.FISCAL, FISICO: p.FISICO, PROMOCIONAL: p.PROMOCIONAL, PRODUTO: p.PRODUTO, BRINDE: p.BRINDE, FALTA_BASE: p.FALTA_BASE, ACAO: p.ACAO, INVENTARIOS: inv });
    var d = Util.now();
    var r = { ID: Util.id('RGR'), CLIENTE: p.CLIENTE, FISCAL: p.FISCAL, FISICO: p.FISICO, PROMOCIONAL: p.PROMOCIONAL, PRODUTO: p.PRODUTO, BRINDE: p.BRINDE,
      FALTA_BASE: p.FALTA_BASE, ACAO: Util.s(p.ACAO), ATIVA: 'S', INVENTARIOS: JSON.stringify(inv), MENSAGEM: Util.s(p.MENSAGEM), VERSAO: 1,
      ATUALIZADO_EM: Util.data(d), ATUALIZADO_POR: user ? user.ID : 'SETUP' };
    DB.append('REGRAS', [r]);
    Regras.registrarVersao(user, r, 'Criação');
    Audit.log(user, 'REGRA_CRIADA', 'REGRA', r.ID, r);
    return r;
  },

  editar: function (user, p) {
    var r = DB.find('REGRAS', 'ID', p.id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Regra não encontrada.');
    if (!Util.s(p.motivo)) throw new AppError('DADOS', 'Informe o motivo da alteração.');
    var novo = {};
    CAMPOS_REGRA.forEach(function (c) { novo[c] = p[c] !== undefined ? p[c] : r[c]; });
    novo.ACAO = p.ACAO !== undefined ? Util.s(p.ACAO) : r.ACAO;
    novo.INVENTARIOS = p.INVENTARIOS !== undefined ? p.INVENTARIOS : Util.json(r.INVENTARIOS, []);
    Regras.validar(novo, r.ID);
    var d = Util.now();
    var patch = { ACAO: novo.ACAO, INVENTARIOS: JSON.stringify(novo.INVENTARIOS), MENSAGEM: p.MENSAGEM !== undefined ? Util.s(p.MENSAGEM) : r.MENSAGEM,
      VERSAO: r.VERSAO + 1, ATUALIZADO_EM: Util.data(d), ATUALIZADO_POR: user.ID };
    CAMPOS_REGRA.forEach(function (c) { patch[c] = novo[c]; });
    DB.update('REGRAS', r._row, patch);
    var atual = DB.find('REGRAS', 'ID', r.ID)[0];
    Regras.registrarVersao(user, atual, p.motivo);
    Audit.log(user, 'REGRA_EDITADA', 'REGRA', r.ID, { motivo: p.motivo });
    return atual;
  },

  ativar: function (user, p) {
    var r = DB.find('REGRAS', 'ID', p.id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Regra não encontrada.');
    if (p.ativa) Regras.validarAtivacao(r);
    var d = Util.now();
    DB.update('REGRAS', r._row, { ATIVA: p.ativa ? 'S' : 'N', VERSAO: r.VERSAO + 1, ATUALIZADO_EM: Util.data(d), ATUALIZADO_POR: user.ID });
    Regras.registrarVersao(user, DB.find('REGRAS', 'ID', r.ID)[0], p.ativa ? 'Ativada' : 'Desativada');
    Audit.log(user, p.ativa ? 'REGRA_ATIVADA' : 'REGRA_DESATIVADA', 'REGRA', r.ID, {});
    return DB.find('REGRAS', 'ID', r.ID)[0];
  },

  /** Ao reativar, não pode coexistir com outra ativa da mesma combinação. */
  validarAtivacao: function (r) {
    var outras = DB.all('REGRAS').filter(function (o) { return o.ID !== r.ID && o.ATIVA === 'S' && Regras.chave(o) === Regras.chave(r); });
    if (outras.length) throw new AppError('DUPLICADA', 'Já existe regra ativa para esta combinação.');
  },

  simular: function (p) {
    var flags = {}; CAMPOS_REGRA.forEach(function (c) { flags[c] = p[c] === 'SIM' ? 'SIM' : 'NAO'; });
    return Regras.buscarAcao(flags, p.invId || '');
  },

  historico: function (p) { return DB.find('HISTORICO_REGRAS', 'REGRA_ID', p.id); }
};
