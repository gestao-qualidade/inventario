/**
 * Importacao.gs — Central de Atualização das Bases.
 * Cada ciclo de carga recebe uma versão única (V0001...). Os 3 relatórios são gravados em abas
 * temporárias da versão (ARM_V0001, CF_V0001, BASE_V0001). A publicação é UMA única troca do
 * ponteiro VERSAO_ATIVA — nunca existe mistura de bases antigas e novas, e restaurar = voltar o ponteiro.
 *
 * O navegador lê o Excel (SheetJS), normaliza e agrega; o backend revalida tudo.
 */
var TIPOS_ARQ = ['ARM', 'CF', 'BASE'];
var NOMES_TIPO = { ARM: 'Saldo Armazenado', CF: 'Saldo Cliente e Fiscal', BASE: 'Saldo Divergência Base' };

var Imp = {
  lerResumo: function (rec) { return Util.json(rec.RESUMO, { arquivos: {} }); },
  salvar: function (rec, patch, resumo) {
    var p = patch || {};
    if (resumo) p.RESUMO = JSON.stringify(resumo);
    DB.update('HISTORICO_IMPORTACOES', rec._row, p);
  },
  obter: function (id) {
    var r = DB.find('HISTORICO_IMPORTACOES', 'ID', id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Importação não encontrada.');
    return r;
  },
  aberta: function () {
    return DB.all('HISTORICO_IMPORTACOES').filter(function (r) { return r.STATUS === 'RECEBENDO' || r.STATUS === 'VALIDADA'; })[0] || null;
  },
  versaoDe: function (rec) { return rec.NOVA_VERSAO; },
  tipoOk: function (t) { if (TIPOS_ARQ.indexOf(t) < 0) throw new AppError('DADOS', 'Tipo de arquivo inválido.'); },

  estado: function () {
    var cfg = Cfg.getAll();
    var ab = Imp.aberta();
    var hist = DB.all('HISTORICO_IMPORTACOES').slice(-8).reverse().map(Imp.publicoHist);
    return {
      versaoAtiva: cfg.VERSAO_ATIVA,
      esperados: TIPOS_ARQ.map(function (t) {
        return { tipo: t, titulo: NOMES_TIPO[t], arquivo: cfg['ARQUIVO_' + t], aba: cfg['ABA_' + t], layout: Util.json(cfg['LAYOUT_' + t], []) };
      }),
      aberta: ab ? { id: ab.ID, versao: ab.NOVA_VERSAO, status: ab.STATUS, resumo: Imp.lerResumo(ab) } : null,
      historico: hist,
      limites: { rejeicaoMaxPercent: Number(cfg.REJEICAO_MAX_PERCENT || 1) }
    };
  },
  publicoHist: function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'RESUMO' && k !== '_row') o[k] = r[k]; }); return o; },

  registrarArquivo: function (user, p) {
    Imp.tipoOk(p.tipo);
    var cfg = Cfg.getAll();
    if (Util.s(p.nomeArquivo) !== cfg['ARQUIVO_' + p.tipo]) throw new AppError('ARQUIVO', Msg.get('ARQUIVO_NAO_RECONHECIDO'));
    if (Util.s(p.aba) !== cfg['ABA_' + p.tipo]) throw new AppError('LAYOUT', 'Aba incorreta: esperado "' + cfg['ABA_' + p.tipo] + '", recebido "' + p.aba + '".');
    var obrig = Util.json(cfg['LAYOUT_' + p.tipo], []);
    var recebidos = (p.cabecalhos || []).map(Util.s);
    var faltando = obrig.filter(function (h) { return recebidos.indexOf(h) < 0; });
    if (faltando.length) throw new AppError('LAYOUT', 'Layout incompatível. Colunas ausentes: ' + faltando.join(', ') + '. Importação interrompida.');

    var rec = Imp.aberta();
    if (rec && rec.STATUS === 'VALIDADA') { // novo envio invalida a prévia anterior
      Imp.salvar(rec, { STATUS: 'RECEBENDO' });
      rec = Imp.obter(rec.ID);
    }
    var d = Util.now();
    if (!rec) {
      var n = Number(Cfg.get('CONTADOR_VERSAO')) + 1;
      Cfg.set('CONTADOR_VERSAO', n);
      var versao = 'V' + ('0000' + n).slice(-4);
      var novo = { ID: 'IMP-' + versao.slice(1), ANALISTA_ID: user.ID, ANALISTA_NOME: user.NOME, DATA: Util.data(d), HORA: Util.hora(d),
        VERSAO_ANTERIOR: cfg.VERSAO_ATIVA, NOVA_VERSAO: versao, STATUS: 'RECEBENDO', RESULTADO: '', RESUMO: JSON.stringify({ arquivos: {} }) };
      DB.append('HISTORICO_IMPORTACOES', [novo]);
      rec = Imp.obter(novo.ID);
      Audit.log(user, 'IMPORTACAO_INICIADA', 'IMPORTACAO', rec.ID, {});
    }
    var resumo = Imp.lerResumo(rec);
    var tab = Schema.versionTab(p.tipo, rec.NOVA_VERSAO);
    if (DB.exists(tab)) DB.drop(tab); // reenvio substitui o anterior
    DB.ensure(tab);
    resumo.arquivos[p.tipo] = { nome: p.nomeArquivo, status: 'RECEBENDO', linhasLidas: 0, validos: 0, rejeitados: 0, ultimoLote: -1, erros: [], recebidoEm: Util.data(d) + ' ' + Util.hora(d) };
    var patch = {}; patch['ARQ_' + p.tipo] = p.nomeArquivo; patch['REG_' + p.tipo] = 0; patch['REJ_' + p.tipo] = 0;
    Imp.salvar(rec, patch, resumo);
    return { importId: rec.ID, versao: rec.NOVA_VERSAO };
  },

  /** Valida uma linha normalizada. Retorna mensagem de erro ou ''. */
  validarLinha: function (tipo, o) {
    if (tipo === 'ARM') {
      if (!o.POSICAO) return 'Posição vazia';
      if (!o.CLIENTE) return 'Cliente vazio';
      if (!o.SKU) return 'SKU vazio';
      if (isNaN(o.QTD) || !(Number(o.QTD) > 0)) return 'Quantidade inválida';
    } else if (tipo === 'CF') {
      if (!o.CLIENTE) return 'Cliente vazio';
      if (!o.SKU) return 'SKU vazio';
      if (isNaN(Number(o.SALDO_CLIENTE)) || isNaN(Number(o.SALDO_FISCAL)) || isNaN(Number(o.SALDO_FISICO))) return 'Saldo inválido';
      if (Number(o.SALDO_CLIENTE) < 0 || Number(o.SALDO_FISCAL) < 0 || Number(o.SALDO_FISICO) < 0) return 'Saldo negativo';
    } else {
      if (!o.CLIENTE) return 'Cliente vazio';
      if (!o.SKU) return 'Item vazio';
      if (!o.TIPO) return 'Tipo (Depto) vazio';
      if (isNaN(Number(o.QTD))) return 'Quantidade inválida';
    }
    return '';
  },

  enviarLote: function (user, p) {
    Imp.tipoOk(p.tipo);
    var rec = Imp.obter(p.importId);
    if (rec.STATUS !== 'RECEBENDO') throw new AppError('STATUS', 'Esta importação não aceita mais arquivos.');
    var resumo = Imp.lerResumo(rec), arq = resumo.arquivos[p.tipo];
    if (!arq) throw new AppError('STATUS', 'Arquivo não registrado. Selecione o arquivo novamente.');
    if (p.seq <= arq.ultimoLote) return { aceitas: 0, rejeitadas: 0, repetido: true };
    var cols = VSCHEMA[p.tipo], ok = [], rej = 0;
    (p.linhas || []).forEach(function (arr, i) {
      var o = {}; cols.forEach(function (c, j) { o[c] = arr[j] === undefined ? '' : arr[j]; });
      var erro = Imp.validarLinha(p.tipo, o);
      if (erro) { rej++; if (arq.erros.length < 500) arq.erros.push({ linha: (p.seq * 1000000) + i, motivo: erro, chave: o.KEY || '' }); }
      else ok.push(o);
    });
    DB.append(Schema.versionTab(p.tipo, rec.NOVA_VERSAO), ok);
    arq.ultimoLote = p.seq; arq.validos += ok.length; arq.rejeitados += rej;
    var patch = {}; patch['REG_' + p.tipo] = arq.validos; patch['REJ_' + p.tipo] = arq.rejeitados;
    Imp.salvar(rec, patch, resumo);
    return { aceitas: ok.length, rejeitadas: rej };
  },

  finalizarArquivo: function (user, p) {
    Imp.tipoOk(p.tipo);
    var rec = Imp.obter(p.importId), resumo = Imp.lerResumo(rec), arq = resumo.arquivos[p.tipo];
    if (!arq) throw new AppError('STATUS', 'Arquivo não registrado.');
    var tab = Schema.versionTab(p.tipo, rec.NOVA_VERSAO);
    var keys = DB.col(tab, 'KEY'), vistos = {}, dup = 0;
    keys.forEach(function (k) { if (vistos[k]) dup++; vistos[k] = 1; });
    arq.linhasLidas = Number(p.linhasLidas) || 0;
    arq.ignoradas = p.ignoradas || 0; // ex.: linha de totais do relatório
    arq.rejeitados += Number(p.rejeitadasCliente) || 0;
    (p.errosCliente || []).forEach(function (e) { if (arq.erros.length < 500) arq.erros.push(e); });
    arq.duplicados = dup; // chaves repetidas na aba de preparação
    arq.agregadas = Number(p.agregadas) || 0; // linhas somadas na mesma chave (ex.: lotes)
    arq.camposVazios = p.camposVazios || {};
    arq.validos = keys.length;
    var total = arq.validos + arq.rejeitados;
    var pct = total ? (arq.rejeitados / total) * 100 : 100;
    var max = Number(Cfg.get('REJEICAO_MAX_PERCENT') || 1);
    var motivos = [];
    if (arq.validos === 0) motivos.push('Nenhum registro válido.');
    if (dup > 0) motivos.push(dup + ' chave(s) duplicada(s).');
    if (pct > max) motivos.push('Rejeições (' + pct.toFixed(2) + '%) acima do limite de ' + max + '%.');
    if (p.tipo === 'ARM') {
      var pos = {}, sk = {}; DB.col(tab, 'POSICAO').forEach(function (v) { pos[v] = 1; }); DB.col(tab, 'SKU').forEach(function (v) { sk[v] = 1; });
      arq.posicoes = Object.keys(pos).length; arq.skus = Object.keys(sk).length;
      arq.comLote = DB.col(tab, 'LOTES_DET').filter(function (v) { return !!v; }).length; // linhas que trouxeram lote/validade
    } else {
      var sk2 = {}; DB.col(tab, 'SKU').forEach(function (v) { sk2[v] = 1; }); arq.skus = Object.keys(sk2).length;
    }
    arq.status = motivos.length ? 'INVALIDO' : 'APROVADO';
    arq.motivos = motivos;
    arq.finalizadoEm = Util.data(Util.now()) + ' ' + Util.hora(Util.now());
    var patch = {}; patch['REG_' + p.tipo] = arq.validos; patch['REJ_' + p.tipo] = arq.rejeitados;
    Imp.salvar(rec, patch, resumo);
    return arq;
  },

  somaQtd: function (tab, col) { return DB.col(tab, col).reduce(function (a, v) { return a + (Number(v) || 0); }, 0); },

  previa: function (user, p) {
    var rec = Imp.obter(p.importId), resumo = Imp.lerResumo(rec);
    var faltam = TIPOS_ARQ.filter(function (t) { return !resumo.arquivos[t] || resumo.arquivos[t].status !== 'APROVADO'; });
    if (faltam.length) throw new AppError('PENDENTE', 'Ainda há arquivos pendentes ou inválidos: ' + faltam.map(function (t) { return NOMES_TIPO[t]; }).join(', ') + '.');
    var v = rec.NOVA_VERSAO;
    var arm = Schema.versionTab('ARM', v), cf = Schema.versionTab('CF', v), base = Schema.versionTab('BASE', v);
    var skuCf = {}; DB.col(cf, 'SKU').forEach(function (s) { skuCf[s] = 1; });
    var skuArm = {}; DB.col(arm, 'SKU').forEach(function (s) { skuArm[s] = 1; });
    var armSemCf = Object.keys(skuArm).filter(function (s) { return !skuCf[s]; }).length;
    var interseccao = Object.keys(skuArm).length - armSemCf;
    var baseSemCadastro = Object.keys((function () { var o = {}; DB.col(base, 'SKU').forEach(function (s) { if (!skuCf[s] && !skuArm[s]) o[s] = 1; }); return o; })()).length;
    var erros = [];
    if (interseccao === 0) erros.push('Nenhum SKU do Saldo Armazenado existe no Saldo Cliente e Fiscal: arquivos de bases diferentes.');
    var atual = { linhasArm: resumo.arquivos.ARM.validos, skusArm: Object.keys(skuArm).length, posicoes: resumo.arquivos.ARM.posicoes, qtdArm: Imp.somaQtd(arm, 'QTD'),
      linhasCf: resumo.arquivos.CF.validos, linhasBase: resumo.arquivos.BASE.validos };
    var anterior = null, antV = rec.VERSAO_ANTERIOR;
    if (antV && DB.exists(Schema.versionTab('ARM', antV))) {
      var a = Schema.versionTab('ARM', antV);
      var sk = {}, ps = {}; DB.col(a, 'SKU').forEach(function (s) { sk[s] = 1; }); DB.col(a, 'POSICAO').forEach(function (s) { ps[s] = 1; });
      anterior = { linhasArm: DB.count(a), skusArm: Object.keys(sk).length, posicoes: Object.keys(ps).length, qtdArm: Imp.somaQtd(a, 'QTD'),
        linhasCf: DB.exists(Schema.versionTab('CF', antV)) ? DB.count(Schema.versionTab('CF', antV)) : 0,
        linhasBase: DB.exists(Schema.versionTab('BASE', antV)) ? DB.count(Schema.versionTab('BASE', antV)) : 0 };
    }
    resumo.previa = { atual: atual, anterior: anterior, armazenadoSemClienteFiscal: armSemCf, baseSemCadastro: baseSemCadastro, erros: erros, geradaEm: Util.data(Util.now()) + ' ' + Util.hora(Util.now()) };
    if (erros.length) { Imp.salvar(rec, {}, resumo); throw new AppError('RELACIONAMENTO', erros.join(' ')); }
    Imp.salvar(rec, { STATUS: 'VALIDADA' }, resumo);
    return resumo.previa;
  },

  /** Publicação: troca atômica do ponteiro de versão, sob trava. */
  publicar: function (user, p) {
    if (p.confirmar !== true) throw new AppError('CONFIRMACAO', 'É necessário confirmar a atualização.');
    var rec = Imp.obter(p.importId);
    if (rec.STATUS !== 'VALIDADA') throw new AppError('STATUS', 'Gere e confira a prévia antes de publicar.');
    var resumo = Imp.lerResumo(rec);
    TIPOS_ARQ.forEach(function (t) {
      if (!resumo.arquivos[t] || resumo.arquivos[t].status !== 'APROVADO' || !DB.exists(Schema.versionTab(t, rec.NOVA_VERSAO)))
        throw new AppError('INCOMPLETA', 'Importação incompleta: não pode ser publicada.');
    });
    var antiga = Cfg.get('VERSAO_ATIVA'), d = Util.now();
    Cfg.set('VERSAO_ATIVA', rec.NOVA_VERSAO); // ← ponto único de virada
    if (antiga) {
      var h = DB.all('HISTORICO_IMPORTACOES').filter(function (r) { return r.NOVA_VERSAO === antiga && r.STATUS === 'PUBLICADA'; })[0];
      if (h) DB.update('HISTORICO_IMPORTACOES', h._row, { STATUS: 'SUBSTITUIDA' });
    }
    Imp.salvar(rec, { STATUS: 'PUBLICADA', RESULTADO: 'Publicada com sucesso', CONFIRMADO_POR: user.ID, CONFIRMADO_EM: Util.data(d) + ' ' + Util.hora(d) });
    Imp.limparAntigas(rec.NOVA_VERSAO);
    Audit.log(user, 'IMPORTACAO_PUBLICADA', 'IMPORTACAO', rec.ID, { versao: rec.NOVA_VERSAO, anterior: antiga });
    return { versaoAtiva: rec.NOVA_VERSAO };
  },

  limparAntigas: function (ativa) {
    var manter = Math.max(2, Number(Cfg.get('VERSOES_MANTIDAS')) || 3);
    var pub = DB.all('HISTORICO_IMPORTACOES').filter(function (r) { return r.STATUS === 'PUBLICADA' || r.STATUS === 'SUBSTITUIDA'; });
    pub.sort(function (a, b) { return a.NOVA_VERSAO < b.NOVA_VERSAO ? 1 : -1; });
    pub.slice(manter).forEach(function (r) {
      if (r.NOVA_VERSAO === ativa) return;
      TIPOS_ARQ.forEach(function (t) { DB.drop(Schema.versionTab(t, r.NOVA_VERSAO)); });
      DB.update('HISTORICO_IMPORTACOES', r._row, { STATUS: 'PURGADA' });
    });
  },

  cancelar: function (user, p) {
    var rec = Imp.obter(p.importId);
    if (['RECEBENDO', 'VALIDADA'].indexOf(rec.STATUS) < 0) throw new AppError('STATUS', 'Só é possível cancelar importações em andamento.');
    TIPOS_ARQ.forEach(function (t) { DB.drop(Schema.versionTab(t, rec.NOVA_VERSAO)); });
    Imp.salvar(rec, { STATUS: 'CANCELADA', RESULTADO: 'Cancelada por ' + user.NOME });
    Audit.log(user, 'IMPORTACAO_CANCELADA', 'IMPORTACAO', rec.ID, {});
    return { ok: true };
  },

  restaurar: function (user, p) {
    var rec = Imp.obter(p.importId);
    if (rec.STATUS !== 'SUBSTITUIDA') throw new AppError('STATUS', 'Só é possível restaurar uma versão anterior ainda disponível.');
    TIPOS_ARQ.forEach(function (t) { if (!DB.exists(Schema.versionTab(t, rec.NOVA_VERSAO))) throw new AppError('INDISPONIVEL', 'Versão indisponível para restauração.'); });
    var atual = Cfg.get('VERSAO_ATIVA');
    Cfg.set('VERSAO_ATIVA', rec.NOVA_VERSAO);
    DB.all('HISTORICO_IMPORTACOES').filter(function (r) { return r.NOVA_VERSAO === atual && r.STATUS === 'PUBLICADA'; })
      .forEach(function (r) { DB.update('HISTORICO_IMPORTACOES', r._row, { STATUS: 'SUBSTITUIDA' }); });
    Imp.salvar(rec, { STATUS: 'PUBLICADA', RESULTADO: 'Restaurada por ' + user.NOME });
    Audit.log(user, 'IMPORTACAO_RESTAURADA', 'IMPORTACAO', rec.ID, { de: atual, para: rec.NOVA_VERSAO });
    return { versaoAtiva: rec.NOVA_VERSAO };
  },

  historico: function () { return DB.all('HISTORICO_IMPORTACOES').reverse().map(Imp.publicoHist); },

  /** Filtros disponíveis para criar inventário (a partir da base ativa). */
  opcoesBase: function () {
    var v = Cfg.get('VERSAO_ATIVA');
    if (!v) throw new AppError('SEM_BASE', 'Nenhuma base publicada. Use a Central de Atualização das Bases.');
    var tab = Schema.versionTab('ARM', v);
    var cli = DB.col(tab, 'CLIENTE'), gal = DB.col(tab, 'GALPAO'), pos = DB.col(tab, 'POSICAO'), cur = DB.col(tab, 'CURVA');
    var sem = Fic.filtrar(DB.col(tab, 'FICTICIO'), [cli, gal, pos, cur]); cli = sem[0]; gal = sem[1]; pos = sem[2]; cur = sem[3];
    var c = {}, g = {}, r = {}, u = {}, ps = {};
    for (var i = 0; i < cli.length; i++) {
      c[cli[i]] = (c[cli[i]] || 0) + 1; g[gal[i]] = 1; r[String(pos[i]).split('.')[0]] = 1; u[cur[i]] = 1; ps[pos[i]] = 1;
    }
    return { versao: v, linhas: cli.length, posicoes: Object.keys(ps).length,
      clientes: Object.keys(c).sort().map(function (k) { return { codigo: k, unidades: c[k] }; }),
      galpoes: Object.keys(g).sort(), ruas: Object.keys(r).sort(), curvas: Object.keys(u).sort() };
  }
};
