/** Util.gs — utilitários comuns (erros, datas, ids, hash, trava). */

function AppError(codigo, mensagem) {
  this.codigo = codigo;
  this.mensagem = mensagem;
  this.message = mensagem;
  this.isAppError = true;
}

var Util = {
  /** Validade digitada (DDMMAAAA, DD/MM/AAAA, DD/MM/AA) → 'DD/MM/AAAA'. Vazio → ''. Inválida → null. */
  validade: function (v) {
    var s = Util.s(v); if (!s) return '';
    var m = /^(\d{1,2})[\/.\-\s]?(\d{1,2})[\/.\-\s]?(\d{4}|\d{2})$/.exec(s); if (!m) return null;
    var d = Number(m[1]), mo = Number(m[2]), a = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(a, mo, 0).getDate() || a < 1990 || a > 2100) return null;
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return z(d) + '/' + z(mo) + '/' + a;
  },
  /** LOTES_DET (JSON [[lote, validade], ...]) → [{lote, validade}] */
  lotes: function (s) { return Util.json(s, []).map(function (l) { return { lote: l[0], validade: l[1] }; }); },
  now: function () {
    if (typeof TEST_NOW !== 'undefined' && TEST_NOW) return new Date(TEST_NOW);
    return new Date();
  },
  data: function (d) { return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy'); },
  hora: function (d) { return Utilities.formatDate(d, 'America/Sao_Paulo', 'HH:mm:ss'); },
  id: function (prefixo) { return prefixo + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase(); },
  s: function (v) { return v === null || v === undefined ? '' : String(v).trim(); },
  num: function (v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isNaN(n) ? NaN : n;
  },
  sha256hex: function (str) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
    return bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length === 1 ? '0' + x : x; }).join('');
  },
  json: function (s, padrao) { try { return s ? JSON.parse(s) : padrao; } catch (e) { return padrao; } },
  /** Normaliza código de posição/SKU lido por leitor: caixa alta, sem espaços, segmentos numéricos sem zeros à esquerda. */
  normPosicao: function (p) {
    return Util.s(p).toUpperCase().replace(/\s+/g, '').split('.').map(function (seg) {
      return /^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg;
    }).join('.');
  },
  /** "I.25.2" -> rua(prateleira) I, coluna 25, altura 2 (zeros à esquerda removidos). */
  partesPosicao: function (p) {
    var s = Util.s(p).toUpperCase().split('.');
    function n(x) { return /^\d+$/.test(x) ? String(parseInt(x, 10)) : x; }
    return { rua: s[0] || '', coluna: s.length > 1 ? n(s[1]) : '', altura: s.length > 2 ? n(s[2]) : '' };
  },
  normSku: function (s) { return Util.s(s).toUpperCase().replace(/\s+/g, ''); }
};

/** Cache em pedaços (o Google limita ~100 KB por chave). Sem CacheService (testes) simplesmente não guarda. */
var Cache = {
  get: function (chave) {
    if (typeof CacheService === 'undefined') return null;
    try {
      var c = CacheService.getScriptCache(), n = c.get(chave + ':n'); if (!n) return null;
      var chaves = []; for (var i = 0; i < Number(n); i++) chaves.push(chave + ':' + i);
      var m = c.getAll(chaves), txt = '';
      for (var j = 0; j < chaves.length; j++) { if (m[chaves[j]] === undefined) return null; txt += m[chaves[j]]; }
      return JSON.parse(txt);
    } catch (e) { return null; }
  },
  put: function (chave, obj, seg) {
    if (typeof CacheService === 'undefined') return;
    try {
      var txt = JSON.stringify(obj), TAM = 90000, parts = {}, n = Math.ceil(txt.length / TAM);
      if (n > 90) return; // grande demais: não guarda
      for (var i = 0; i < n; i++) parts[chave + ':' + i] = txt.substr(i * TAM, TAM);
      parts[chave + ':n'] = String(n);
      CacheService.getScriptCache().putAll(parts, seg);
    } catch (e) { /* cache é opcional */ }
  }
};

/** Trava global: serializa operações de escrita críticas (reserva de tarefa, lançamentos, publicação). */
var Lock = {
  run: function (fn) {
    if (typeof LockService === 'undefined') return fn();
    var l = LockService.getScriptLock();
    try { l.waitLock(25000); } catch (e) { throw new AppError('OCUPADO', 'Sistema ocupado. Tente novamente em instantes.'); }
    try { return fn(); } finally { l.releaseLock(); }
  }
};

/** Posições/linhas fictícias (coluna Ficticio = S do relatório de armazenagem) nunca entram em mapa, catálogo, inventário nem relatórios. */
var Fic = {
  sim: function (v) { return /^(S|SIM|Y|1|TRUE)$/i.test(String(v === undefined || v === null ? '' : v).trim()); },
  /** Remove dos vetores paralelos os índices cuja coluna FICTICIO é "S". */
  filtrar: function (fic, vetores) {
    return vetores.map(function (v) { return v.filter(function (_, i) { return !Fic.sim(fic[i]); }); });
  },
  /** UNIDADE_ID de linhas fictícias nas fotografias dos inventários (inclui inventários antigos). */
  unidades: function () {
    var u = DB.col('BASE_INVENTARIO', 'UNIDADE_ID'), f = DB.col('BASE_INVENTARIO', 'FICTICIO'), m = {};
    for (var i = 0; i < u.length; i++) if (Fic.sim(f[i])) m[u[i]] = 1;
    return m;
  }
};

var Audit = {
  log: function (user, acao, entidade, entidadeId, detalhe) {
    var d = Util.now();
    DB.append('AUDITORIA', [{
      ID: Util.id('AUD'), DATA_HORA: Util.data(d) + ' ' + Util.hora(d),
      USUARIO_ID: user ? user.ID : '', USUARIO_NOME: user ? user.NOME : '',
      ACAO: acao, ENTIDADE: entidade, ENTIDADE_ID: entidadeId || '',
      DETALHE: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe || {})
    }]);
  }
};

var Cfg = {
  get: function (chave) {
    var r = DB.find('CONFIGURACOES', 'CHAVE', chave);
    return r.length ? r[0].VALOR : (CONFIG_PADRAO[chave] !== undefined ? CONFIG_PADRAO[chave] : '');
  },
  set: function (chave, valor) {
    var r = DB.find('CONFIGURACOES', 'CHAVE', chave);
    if (r.length) DB.update('CONFIGURACOES', r[0]._row, { VALOR: String(valor) });
    else DB.append('CONFIGURACOES', [{ CHAVE: chave, VALOR: String(valor) }]);
  },
  getAll: function () {
    var out = {}; Object.keys(CONFIG_PADRAO).forEach(function (k) { out[k] = CONFIG_PADRAO[k]; });
    DB.all('CONFIGURACOES').forEach(function (r) { out[r.CHAVE] = r.VALOR; });
    return out;
  }
};

var Msg = {
  get: function (chave) {
    var r = DB.find('MENSAGENS', 'CHAVE', chave);
    return r.length ? r[0].TEXTO : (MENSAGENS_PADRAO[chave] || '');
  }
};
