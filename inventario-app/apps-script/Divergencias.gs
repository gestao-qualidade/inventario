/**
 * Divergencias.gs — tela única de Divergências: tudo que foi encontrado em qualquer inventário
 * (divergências de contagem, check de posição e inclusões) vai para uma fila de decisão do analista.
 * Fluxo: PENDENTE_TRATATIVA → EM_ANALISE → (AGUARDANDO_APROVACAO) → DECIDIDA → EXECUTADA → FECHADA.
 */
var DECISOES = {
  AJUSTAR_WMS: 'Ajustar o saldo no WMS (a favor da contagem)',
  RECONTAR: 'Mandar recontar',
  INVESTIGAR: 'Investigar (movimentação ou NF pendente)',
  ACEITAR: 'Aceitar a divergência, sem ajuste',
  CORRIGIR_CADASTRO: 'Corrigir o cadastro ou a posição',
  BAIXA: 'Dar baixa (perda, avaria ou vencido)',
  ACIONAR_CLIENTE_FISCAL: 'Acionar o cliente ou o fiscal'
};
var ST_ABERTAS = ['PENDENTE_TRATATIVA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO'];

var Dv = {
  tabela: function (origem) { return origem === 'INCLUSAO' ? 'INCLUSOES' : 'DIVERGENCIAS'; },
  campoTexto: function (tab) { return tab === 'INCLUSOES' ? 'OBS' : 'TRATATIVA'; },
  norm: function (st) { return st === 'PENDENTE_ANALISE' ? 'PENDENTE_TRATATIVA' : st === 'RESOLVIDA' ? 'FECHADA' : st; },
  achar: function (tab, id) {
    var r = DB.find(tab, 'ID', Util.s(id))[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Registro não encontrado.');
    return r;
  },
  agora: function () { var d = Util.now(); return Util.data(d) + ' ' + Util.hora(d); },
  epoch: function (s) {
    var m = /^(\d\d)\/(\d\d)\/(\d{4})(?: (\d\d):(\d\d):(\d\d))?/.exec(Util.s(s)); if (!m) return 0;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  },
  valor: function (r, tab) {
    if (tab === 'INCLUSOES') return '';
    var v = Number(r.VALOR_UNIT); if (!isFinite(v) || r.VALOR_UNIT === '' || r.VALOR_UNIT === undefined) return '';
    return Math.round(Number(r.DIFERENCA) * v * 100) / 100;
  },
  /** Lotes/validades por UNIDADE_ID (lê as colunas da fotografia uma vez só). */
  lotesMapa: function () {
    var u = DB.col('BASE_INVENTARIO', 'UNIDADE_ID'), l = DB.col('BASE_INVENTARIO', 'LOTES_DET'), ds = DB.col('BASE_INVENTARIO', 'DESCRICAO'), fi = DB.col('BASE_INVENTARIO', 'FICTICIO'), m = {};
    for (var i = 0; i < u.length; i++) m[u[i]] = { lotes: l[i] ? Util.lotes(l[i]) : [], descricao: ds[i], fic: Fic.sim(fi[i]) };
    return m;
  },
  resumo: function (origem, r, invs, lotes) {
    var tab = Dv.tabela(origem), inc = tab === 'INCLUSOES';
    return {
      id: r.ID, origem: origem, invId: r.INV_ID, inventario: invs[r.INV_ID] || r.INV_ID, cliente: r.CLIENTE, sku: r.SKU, posicao: inc ? r.POSICAO_ENCONTRADA : r.POSICAO,
      rua: Util.partesPosicao(inc ? r.POSICAO_ENCONTRADA : r.POSICAO).rua,
      tipo: inc ? 'INCLUSAO' : r.TIPO, saldo: inc ? '' : r.SALDO, final: inc ? r.QTD : r.QTD_FINAL, diferenca: inc ? '' : r.DIFERENCA,
      valor: Dv.valor(r, tab), status: Dv.norm(r.STATUS), acao: r.ACAO, decisao: r.DECISAO || '', responsavel: r.RESPONSAVEL || '', prazo: r.PRAZO || '',
      lotes: inc ? ((r.LOTE || r.VALIDADE) ? [{ lote: r.LOTE || '', validade: r.VALIDADE || '' }] : []) : ((lotes && lotes[r.UNIDADE_ID] && lotes[r.UNIDADE_ID].lotes) || []), descricao: inc ? r.DESCRICAO : ((lotes && lotes[r.UNIDADE_ID] && lotes[r.UNIDADE_ID].descricao) || ''), criadoEm: inc ? (r.DATA + ' ' + r.HORA) : r.CRIADO_EM, decididoEm: r.DECIDIDO_EM || r.RESOLVIDO_EM || '', ordem: Dv.epoch(inc ? (r.DATA + ' ' + r.HORA) : r.CRIADO_EM)
    };
  },
  log: function (r, user, texto, de, para) {
    var h = Util.json(r.HISTORICO, []); h.push({ quando: Dv.agora(), quem: user.NOME, texto: texto, de: de || '', para: para || '' });
    return JSON.stringify(h.slice(-60));
  },

  listar: function (user, p) {
    var invs = {}; DB.all('INVENTARIOS').forEach(function (i) { invs[i.ID] = i.NOME; });
    var out = [];
    var lm = Dv.lotesMapa();
    DB.all('DIVERGENCIAS').forEach(function (r) { if (lm[r.UNIDADE_ID] && lm[r.UNIDADE_ID].fic) return; out.push(Dv.resumo('DIVERGENCIA', r, invs, lm)); });
    DB.all('INCLUSOES').forEach(function (r) { out.push(Dv.resumo('INCLUSAO', r, invs)); });
    out.sort(function (a, b) { return b.ordem - a.ordem; });
    var decisoes = Object.keys(DECISOES).map(function (k) { return { id: k, rotulo: DECISOES[k] }; });
    return { itens: out.slice(0, 5000), decisoes: decisoes, aprovacaoMin: Number(Cfg.get('APROVACAO_VALOR_MIN')) || 0 };
  },

  detalhe: function (user, p) {
    var tab = Dv.tabela(p.origem), r = Dv.achar(tab, p.id), invs = {}; DB.all('INVENTARIOS').forEach(function (i) { invs[i.ID] = i.NOME; });
    var out = Dv.resumo(p.origem, r, invs);
    out.flags = Util.json(r.FLAGS, {}); out.historico = Util.json(r.HISTORICO, []); out.justificativa = r[Dv.campoTexto(tab)] || ''; out.refAjuste = r.REF_AJUSTE || '';
    out.decididoPor = r.DECIDIDO_POR || '';
    if (tab === 'DIVERGENCIAS') {
      var b = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', r.UNIDADE_ID)[0];
      if (b) out.produto = { descricao: b.DESCRICAO, galpao: b.GALPAO, familia: b.FAMILIA, curva: b.CURVA, codigoBarras: b.COD_ITEM_CLI, valorUnit: b.VALOR_UNIT,
        lotes: Inv.lotesDe(Inv.obter(r.INV_ID), b) };
      out.contagens = DB.find('CONTAGENS', 'UNIDADE_ID', r.UNIDADE_ID).map(function (c) { return { etapa: c.ETAPA, qtd: c.QTD, operador: c.OPERADOR_NOME, data: c.DATA, hora: c.HORA }; });
      out.podeRecontar = !!DB.find('FILA_CONTAGENS', 'UNIDADE_ID', r.UNIDADE_ID).length;
    } else {
      out.produto = { descricao: r.DESCRICAO, galpao: '', familia: '', curva: '', codigoBarras: '', valorUnit: '', lotes: (r.LOTE || r.VALIDADE) ? [{ lote: r.LOTE || '', validade: r.VALIDADE || '' }] : [] };
      out.outrasPosicoes = Util.json(r.OUTRAS_POSICOES, []); out.contagens = []; out.podeRecontar = false;
    }
    out.outras = DB.find('DIVERGENCIAS', 'SKU', r.SKU).filter(function (x) { return x.ID !== r.ID; }).slice(-15).map(function (x) {
      return { id: x.ID, inventario: invs[x.INV_ID] || x.INV_ID, posicao: x.POSICAO, tipo: x.TIPO, diferenca: x.DIFERENCA, status: Dv.norm(x.STATUS) };
    });
    return out;
  },

  /** Devolve a unidade para a fila de contagem (novo ciclo de 1ª/2ª/3ª). */
  recontar: function (r, tab) {
    if (tab !== 'DIVERGENCIAS') throw new AppError('DADOS', 'Recontagem só vale para divergência de contagem.');
    var f = DB.find('FILA_CONTAGENS', 'UNIDADE_ID', r.UNIDADE_ID)[0];
    if (!f) throw new AppError('SEM_FILA', 'Este item veio de um check de posição e não tem fila de contagem. Escolha outra decisão ou crie um check.');
    var inv = Inv.obter(r.INV_ID);
    if (inv.STATUS !== 'ATIVO') throw new AppError('STATUS', 'O inventário não está ativo; não dá para recontar.');
    DB.update('FILA_CONTAGENS', f._row, { STATUS: 'DISPONIVEL', ETAPA: 1, C1_OP: '', C2_OP: '', C3_OP: '', RESERVADO_POR: '', RESERVADO_ATE: '', TAREFA_ID: '', VERSAO: Number(f.VERSAO) + 1, ATUALIZADO_EM: Dv.agora() });
  },

  decidir: function (user, p) {
    var tab = Dv.tabela(p.origem), r = Dv.achar(tab, p.id), st = Dv.norm(r.STATUS);
    if (['PENDENTE_TRATATIVA', 'EM_ANALISE'].indexOf(st) < 0) throw new AppError('STATUS', 'Esta divergência já tem decisão ou está encerrada.');
    if (!DECISOES[p.decisao]) throw new AppError('DADOS', 'Escolha o que será feito.');
    if (Util.s(p.justificativa).length < 5) throw new AppError('DADOS', 'Escreva a justificativa da decisão (mínimo de 5 letras).');
    if (p.prazo && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.prazo))) throw new AppError('DADOS', 'Prazo inválido.');
    if (p.decisao === 'RECONTAR' && tab !== 'DIVERGENCIAS') throw new AppError('DADOS', 'Recontagem só vale para divergência de contagem.');
    var min = Number(Cfg.get('APROVACAO_VALOR_MIN')) || 0, v = Dv.valor(r, tab);
    var precisa = min > 0 && v !== '' && Math.abs(v) >= min && ['ADMINISTRADOR', 'GESTOR'].indexOf(user.PERFIL) < 0;
    var novo = precisa ? 'AGUARDANDO_APROVACAO' : 'DECIDIDA';
    var patch = { DECISAO: p.decisao, RESPONSAVEL: Util.s(p.responsavel) || user.NOME, PRAZO: p.prazo || '', DECIDIDO_POR: user.NOME, DECIDIDO_EM: Dv.agora(), STATUS: novo };
    patch[Dv.campoTexto(tab)] = Util.s(p.justificativa);
    var texto = 'Decidiu: ' + DECISOES[p.decisao] + ' — ' + Util.s(p.justificativa);
    if (!precisa && p.decisao === 'RECONTAR') { Dv.recontar(r, tab); patch.STATUS = 'EXECUTADA'; texto += ' (unidade devolvida à fila de contagem)'; }
    patch.HISTORICO = Dv.log(r, user, texto, st, patch.STATUS);
    DB.update(tab, r._row, patch);
    Audit.log(user, 'DIVERGENCIA_DECIDIDA', tab, r.ID, { decisao: p.decisao, status: patch.STATUS });
    return { ok: true, status: patch.STATUS, aguardaAprovacao: precisa };
  },

  avancar: function (user, p) {
    var tab = Dv.tabela(p.origem), r = Dv.achar(tab, p.id), st = Dv.norm(r.STATUS), para = p.para, patch = {};
    var ok = (st === 'PENDENTE_TRATATIVA' && para === 'EM_ANALISE') || (st === 'DECIDIDA' && para === 'EXECUTADA') || (st === 'EXECUTADA' && para === 'FECHADA');
    if (!ok) throw new AppError('STATUS', 'Esse passo não é permitido agora.');
    if (para === 'EM_ANALISE') patch.RESPONSAVEL = r.RESPONSAVEL || user.NOME;
    if (para === 'EXECUTADA') {
      if (r.DECISAO === 'AJUSTAR_WMS' && !Util.s(p.refAjuste)) throw new AppError('DADOS', 'Informe o número/referência do ajuste feito no WMS.');
      if (Util.s(p.refAjuste)) patch.REF_AJUSTE = Util.s(p.refAjuste);
    }
    patch.STATUS = para;
    patch.HISTORICO = Dv.log(r, user, (para === 'EM_ANALISE' ? 'Assumiu a análise' : para === 'EXECUTADA' ? 'Marcou como executada' + (patch.REF_AJUSTE ? ' (ref. ' + patch.REF_AJUSTE + ')' : '') : 'Fechou') + (Util.s(p.obs) ? ' — ' + Util.s(p.obs) : ''), st, para);
    DB.update(tab, r._row, patch);
    Audit.log(user, 'DIVERGENCIA_' + para, tab, r.ID, { ref: patch.REF_AJUSTE || '' });
    return { ok: true, status: para };
  },

  aprovar: function (user, p) {
    var tab = Dv.tabela(p.origem), r = Dv.achar(tab, p.id), st = Dv.norm(r.STATUS);
    if (st !== 'AGUARDANDO_APROVACAO') throw new AppError('STATUS', 'Esta decisão não está aguardando aprovação.');
    var patch = {};
    if (p.aprovar) {
      patch.STATUS = 'DECIDIDA';
      if (r.DECISAO === 'RECONTAR') { Dv.recontar(r, tab); patch.STATUS = 'EXECUTADA'; }
    } else {
      if (Util.s(p.obs).length < 5) throw new AppError('DADOS', 'Explique por que a decisão foi recusada.');
      patch.STATUS = 'EM_ANALISE';
    }
    patch.HISTORICO = Dv.log(r, user, (p.aprovar ? 'Aprovou a decisão' : 'Recusou a decisão') + (Util.s(p.obs) ? ' — ' + Util.s(p.obs) : ''), st, patch.STATUS);
    DB.update(tab, r._row, patch);
    Audit.log(user, p.aprovar ? 'DIVERGENCIA_APROVADA' : 'DIVERGENCIA_RECUSADA', tab, r.ID, {});
    return { ok: true, status: patch.STATUS };
  }
};
