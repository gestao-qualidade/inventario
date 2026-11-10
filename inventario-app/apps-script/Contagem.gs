/**
 * Contagem.gs — contagem cega (1ª/2ª/3ª), reserva atômica de tarefas, inclusões e check de posição.
 *
 * Integridade: toda operação que altera a fila roda dentro de Lock.run (trava de script do Apps Script),
 * os lançamentos são APPEND-ONLY na aba CONTAGENS e nada de saldo/esperado/etapa é devolvido ao operador.
 */

/** Regra de decisão (pura, testável). c1 = quantidade da 1ª contagem (só relevante na etapa 2). */
function decidirContagem(etapa, saldo, c1, qtd) {
  if (etapa === 1) {
    if (qtd === saldo) return { final: true, qtdFinal: qtd, motivo: 'IGUAL_SISTEMA' };
    return { final: false, proxima: 2, motivo: 'DIVERGENTE' };
  }
  if (etapa === 2) {
    if (qtd === saldo) return { final: true, qtdFinal: qtd, motivo: 'IGUAL_SISTEMA' };
    if (qtd === c1) return { final: true, qtdFinal: qtd, motivo: 'IGUAL_C1' };
    return { final: false, proxima: 3, motivo: 'DIVERGENTE' };
  }
  return { final: true, qtdFinal: qtd, motivo: 'DEFINITIVA' }; // 3ª contagem: sempre definitiva
}

var Cnt = {
  ttlMs: function () { return (Number(Cfg.get('RESERVA_MINUTOS')) || 30) * 60000; },

  jaContou: function (f, uid) { return f.C1_OP === uid || f.C2_OP === uid || f.C3_OP === uid; },

  /** Unidade disponível para o operador (livre, reservada por ele ou com reserva vencida), sem repetir etapa. */
  elegivel: function (f, uid, agora) {
    if (Cnt.jaContou(f, uid)) return false;
    if (f.STATUS === 'DISPONIVEL') return true;
    if (f.STATUS === 'RESERVADO') return f.RESERVADO_POR === uid || Number(f.RESERVADO_ATE) < agora;
    return false;
  },

  inventariosAbertos: function (user) {
    Inv.ativarAgendados();
    return DB.all('INVENTARIOS').filter(function (i) {
      if (i.STATUS !== 'ATIVO' || i.TIPO === 'CHECK' || !Auth.podeTipo(user, i.TIPO)) return false;
      var resp = Util.json(i.RESPONSAVEIS, []);
      return !resp.length || resp.indexOf(user.ID) >= 0;
    }).map(function (i) { return { id: i.ID, nome: i.NOME, tipo: i.TIPO }; });
  },

  /** Resumo para o menu do operador: por tipo liberado, inventários ativos e quantas posições ainda têm contagem para ele. */
  pendencias: function (user) {
    Inv.ativarAgendados();
    var ativos = DB.all('INVENTARIOS').filter(function (i) { return i.STATUS === 'ATIVO' && Auth.podeTipo(user, i.TIPO); });
    var porInv = {};
    var ids = DB.col('FILA_CONTAGENS', 'INV_ID'), pos = DB.col('FILA_CONTAGENS', 'POSICAO'), st = DB.col('FILA_CONTAGENS', 'STATUS'),
      rp = DB.col('FILA_CONTAGENS', 'RESERVADO_POR'), ra = DB.col('FILA_CONTAGENS', 'RESERVADO_ATE'),
      c1 = DB.col('FILA_CONTAGENS', 'C1_OP'), c2 = DB.col('FILA_CONTAGENS', 'C2_OP'), c3 = DB.col('FILA_CONTAGENS', 'C3_OP');
    var agora = Util.now().getTime(), vistos = {}, ficU = Fic.unidades(), uid = DB.col('FILA_CONTAGENS', 'UNIDADE_ID');
    ativos.forEach(function (i) { var r = Util.json(i.RESPONSAVEIS, []); if (i.TIPO !== 'CHECK' && (!r.length || r.indexOf(user.ID) >= 0)) { porInv[i.ID] = 0; vistos[i.ID] = {}; } });
    for (var k = 0; k < ids.length; k++) {
      if (!(ids[k] in porInv)) continue;
      var f = { STATUS: st[k], RESERVADO_POR: rp[k], RESERVADO_ATE: ra[k], C1_OP: c1[k], C2_OP: c2[k], C3_OP: c3[k] };
      if (!Cnt.elegivel(f, user.ID, agora) || vistos[ids[k]][pos[k]] || ficU[uid[k]]) continue;
      vistos[ids[k]][pos[k]] = 1; porInv[ids[k]]++;
    }
    var tipos = {};
    ativos.forEach(function (i) {
      var t = tipos[i.TIPO] || (tipos[i.TIPO] = { inventarios: [], pendentes: 0 });
      if (i.TIPO === 'CHECK') { var np = Chk.pendentes(i).length; t.inventarios.push({ id: i.ID, nome: i.NOME, modo: Chk.modo(i), pendentes: np }); t.pendentes += np; return; }
      if (!(i.ID in porInv)) return;
      t.inventarios.push({ id: i.ID, nome: i.NOME, pendentes: porInv[i.ID] }); t.pendentes += porInv[i.ID];
    });
    return { tipos: tipos };
  },

  checarInventario: function (invId, tipoCheck, user) {
    var inv = Inv.obter(invId);
    if (user && !Auth.podeTipo(user, inv.TIPO)) throw new AppError('NEGADO', 'Você não está autorizado a executar este tipo de inventário.');
    if (inv.STATUS !== 'ATIVO') throw new AppError('STATUS', 'Inventário não está ativo.');
    if ((inv.TIPO === 'CHECK') !== !!tipoCheck) throw new AppError('STATUS', 'Tipo de inventário incompatível com a operação.');
    return inv;
  },

  /** Lista posições com tarefas disponíveis. Não revela etapa, saldo nem resultados. */
  posicoes: function (user, p) {
    var inv = Cnt.checarInventario(p.invId, false, user);
    var ids = DB.col('FILA_CONTAGENS', 'INV_ID'), pos = DB.col('FILA_CONTAGENS', 'POSICAO'), st = DB.col('FILA_CONTAGENS', 'STATUS'),
      rp = DB.col('FILA_CONTAGENS', 'RESERVADO_POR'), ra = DB.col('FILA_CONTAGENS', 'RESERVADO_ATE'),
      c1 = DB.col('FILA_CONTAGENS', 'C1_OP'), c2 = DB.col('FILA_CONTAGENS', 'C2_OP'), c3 = DB.col('FILA_CONTAGENS', 'C3_OP'), tar = DB.col('FILA_CONTAGENS', 'TAREFA_ID'), uid = DB.col('FILA_CONTAGENS', 'UNIDADE_ID');
    var agora = Util.now().getTime(), mapa = {}, minha = null, ficU = Fic.unidades();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== inv.ID || ficU[uid[i]]) continue;
      var f = { STATUS: st[i], RESERVADO_POR: rp[i], RESERVADO_ATE: ra[i], C1_OP: c1[i], C2_OP: c2[i], C3_OP: c3[i] };
      if (!Cnt.elegivel(f, user.ID, agora)) continue;
      var o = mapa[pos[i]] || (mapa[pos[i]] = { posicao: pos[i], unidades: 0, minha: false });
      o.unidades++;
      if (f.STATUS === 'RESERVADO' && f.RESERVADO_POR === user.ID && Number(f.RESERVADO_ATE) >= agora) { o.minha = true; minha = { tarefaId: tar[i], posicao: pos[i] }; }
    }
    var lista = Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return (b.minha ? 1 : 0) - (a.minha ? 1 : 0) || (a.posicao < b.posicao ? -1 : 1); });
    return { posicoes: lista.slice(0, 400), total: lista.length, minhaTarefa: minha };
  },

  minhaTarefaAtiva: function (user) {
    var agora = Util.now().getTime();
    var rows = DB.find('FILA_CONTAGENS', 'RESERVADO_POR', user.ID).filter(function (f) { return f.STATUS === 'RESERVADO' && Number(f.RESERVADO_ATE) >= agora; });
    return rows.length ? rows : null;
  },

  assumir: function (user, p) {
    var inv = Cnt.checarInventario(p.invId, false, user);
    var agora = Util.now().getTime();
    var posicao = Util.s(p.posicao);
    var atual = Cnt.minhaTarefaAtiva(user);
    if (atual && atual[0].POSICAO !== posicao) throw new AppError('TAREFA_ABERTA', 'Conclua ou libere sua tarefa atual (posição ' + atual[0].POSICAO + ') antes de assumir outra.');
    var linhas = DB.find('FILA_CONTAGENS', 'POSICAO', posicao).filter(function (f) { return f.INV_ID === inv.ID; });
    var elegiveis = linhas.filter(function (f) { return Cnt.elegivel(f, user.ID, agora); });
    if (!elegiveis.length) throw new AppError('INDISPONIVEL', 'Esta posição não está mais disponível para você.');
    // bipagem da posição: aceita o código da posição ou o dígito verificador
    var base = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', elegiveis[0].UNIDADE_ID)[0];
    var lido = Util.s(p.leitura).toUpperCase();
    if (!(Util.normPosicao(lido) === Util.normPosicao(posicao) || (base && base.VERIF && lido === String(base.VERIF).toUpperCase())))
      throw new AppError('POSICAO_ERRADA', 'A posição lida não confere. Bipe novamente a posição correta.');
    var tarefa = (atual && atual[0].POSICAO === posicao) ? atual[0].TAREFA_ID : Util.id('TAR');
    var ate = agora + Cnt.ttlMs(), ts = Util.data(Util.now()) + ' ' + Util.hora(Util.now());
    elegiveis.forEach(function (f) {
      DB.update('FILA_CONTAGENS', f._row, { STATUS: 'RESERVADO', RESERVADO_POR: user.ID, RESERVADO_ATE: ate, TAREFA_ID: tarefa, VERSAO: Number(f.VERSAO) + 1, ATUALIZADO_EM: ts });
    });
    return { tarefaId: tarefa, posicao: posicao, invId: inv.ID, pendentes: elegiveis.length, expiraEm: ate };
  },

  unidadesDaTarefa: function (user, tarefaId) {
    var rows = DB.find('FILA_CONTAGENS', 'TAREFA_ID', tarefaId).filter(function (f) { return f.RESERVADO_POR === user.ID && f.STATUS === 'RESERVADO'; });
    return rows;
  },

  liberar: function (user, p) {
    var rows = Cnt.unidadesDaTarefa(user, p.tarefaId);
    var ts = Util.data(Util.now()) + ' ' + Util.hora(Util.now());
    rows.forEach(function (f) { DB.update('FILA_CONTAGENS', f._row, { STATUS: 'DISPONIVEL', RESERVADO_POR: '', RESERVADO_ATE: '', TAREFA_ID: '', VERSAO: Number(f.VERSAO) + 1, ATUALIZADO_EM: ts }); });
    return { liberadas: rows.length };
  },

  /** Libera reservas vencidas (tarefas abandonadas). Executado por gatilho de tempo e antes de listar. */
  recuperarExpiradas: function () {
    var agora = Util.now().getTime(), n = 0, ts = Util.data(Util.now()) + ' ' + Util.hora(Util.now());
    DB.find('FILA_CONTAGENS', 'STATUS', 'RESERVADO').forEach(function (f) {
      if (Number(f.RESERVADO_ATE) < agora) {
        DB.update('FILA_CONTAGENS', f._row, { STATUS: 'DISPONIVEL', RESERVADO_POR: '', RESERVADO_ATE: '', TAREFA_ID: '', VERSAO: Number(f.VERSAO) + 1, ATUALIZADO_EM: ts }); n++;
      }
    });
    return n;
  },

  mensagemFinal: function (etapa, saldo, qtdFinal) {
    if (qtdFinal === saldo) return Msg.get('OK');
    if (etapa === 3) return Msg.get('DIVERGENCIA');
    return qtdFinal < saldo ? Msg.get('FALTA') : Msg.get('SOBRA');
  },

  /** Processa a contagem de uma unidade (chamar SEMPRE dentro de Lock.run). */
  processar: function (user, f, qtd, tarefaId) {
    var base = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', f.UNIDADE_ID)[0];
    var saldo = Number(base.SALDO), etapa = Number(f.ETAPA);
    var c1 = 0;
    if (etapa === 2) {
      var anteriores = DB.find('CONTAGENS', 'UNIDADE_ID', f.UNIDADE_ID).filter(function (c) { return c.ETAPA === 1; });
      c1 = anteriores.length ? Number(anteriores[anteriores.length - 1].QTD) : NaN;
    }
    var dec = decidirContagem(etapa, saldo, c1, qtd);
    var d = Util.now(), ts = Util.data(d) + ' ' + Util.hora(d);
    var resultado = dec.final ? (dec.qtdFinal === saldo ? 'FINALIZADA_SEM_DIVERGENCIA' : 'FINALIZADA_COM_DIVERGENCIA') : 'ENCAMINHADA_C' + dec.proxima;
    DB.append('CONTAGENS', [{ ID: Util.id('CNT'), INV_ID: f.INV_ID, UNIDADE_ID: f.UNIDADE_ID, CLIENTE: f.CLIENTE, SKU: f.SKU, POSICAO: f.POSICAO, QTD: qtd, ETAPA: etapa,
      OPERADOR_ID: user.ID, OPERADOR_NOME: user.NOME, DATA: Util.data(d), HORA: Util.hora(d), EPOCH: d.getTime(), RESULTADO: dec.motivo + '|' + resultado,
      STATUS: dec.final ? 'FINAL' : 'PARCIAL', TAREFA_ID: tarefaId }]);
    var patch = { VERSAO: Number(f.VERSAO) + 1, ATUALIZADO_EM: ts, RESERVADO_POR: '', RESERVADO_ATE: '', TAREFA_ID: '' };
    patch['C' + etapa + '_OP'] = user.ID;
    if (dec.final) {
      patch.STATUS = 'FINALIZADA';
      if (dec.qtdFinal !== saldo) Cnt.registrarDivergencia(f.INV_ID, f.UNIDADE_ID, f.CLIENTE, f.SKU, f.POSICAO, saldo, dec.qtdFinal, etapa, base.FAMILIA, base.VALOR_UNIT);
    } else { patch.STATUS = 'DISPONIVEL'; patch.ETAPA = dec.proxima; }
    DB.update('FILA_CONTAGENS', f._row, patch);
    return { finalizada: dec.final, mensagem: dec.final ? Cnt.mensagemFinal(etapa, saldo, dec.qtdFinal) : Msg.get('REGISTRADA') };
  },

  registrarDivergencia: function (invId, uid, cli, sku, pos, saldo, qtdFinal, etapa, familia, valorUnit) {
    var flags = Regras.montarFlags(cli, sku, qtdFinal, familia);
    var acao = Regras.buscarAcao(flags, invId);
    var d = Util.now();
    DB.append('DIVERGENCIAS', [{ ID: Util.id('DIV'), INV_ID: invId, UNIDADE_ID: uid, CLIENTE: cli, SKU: sku, POSICAO: pos, SALDO: saldo, QTD_FINAL: qtdFinal,
      DIFERENCA: qtdFinal - saldo, TIPO: qtdFinal < saldo ? 'FALTA' : 'SOBRA', ETAPA_FINAL: etapa, FLAGS: JSON.stringify(flags), ACAO: acao.acao,
      STATUS: 'PENDENTE_TRATATIVA', TRATATIVA: '', RESOLVIDO_POR: '', RESOLVIDO_EM: '', CRIADO_EM: Util.data(d) + ' ' + Util.hora(d), VALOR_UNIT: valorUnit === undefined ? '' : valorUnit }]);
  },

  validarQtd: function (q) {
    var n = Number(q);
    if (q === '' || q === null || q === undefined || isNaN(n) || n < 0 || Math.floor(n) !== n || n > 100000000) throw new AppError('DADOS', 'Informe uma quantidade inteira válida (zero ou mais).');
    return n;
  },

  lancar: function (user, p) {
    var qtd = Cnt.validarQtd(p.qtd);
    var unidades = Cnt.unidadesDaTarefa(user, p.tarefaId);
    if (!unidades.length) throw new AppError('TAREFA', 'Tarefa inexistente, expirada ou já concluída. Volte à lista de posições.');
    var invId = unidades[0].INV_ID, posicao = unidades[0].POSICAO;
    var sku = Util.normSku(p.sku);
    if (!sku) throw new AppError('DADOS', 'Bipe o SKU.');
    var alvo = unidades.filter(function (f) { return Util.normSku(f.SKU) === sku; })[0];
    if (!alvo) { // código alternativo (código do item no cliente)
      for (var i = 0; i < unidades.length && !alvo; i++) {
        var b = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', unidades[i].UNIDADE_ID)[0];
        if (b && b.COD_ITEM_CLI && Util.normSku(b.COD_ITEM_CLI) === sku) { alvo = unidades[i]; sku = Util.normSku(alvo.SKU); }
      }
    }
    var ate = Util.now().getTime() + Cnt.ttlMs();
    unidades.forEach(function (f) { DB.update('FILA_CONTAGENS', f._row, { RESERVADO_ATE: ate }); }); // renova reserva
    if (alvo) {
      var r = Cnt.processar(user, alvo, qtd, p.tarefaId);
      return { tipo: 'CONTAGEM', finalizada: r.finalizada, mensagem: r.mensagem, restantes: unidades.length - 1 };
    }
    // já lançado nesta posição por este operador?
    var jaBase = DB.find('FILA_CONTAGENS', 'POSICAO', posicao).filter(function (f) { return f.INV_ID === invId && Util.normSku(f.SKU) === sku && Cnt.jaContou(f, user.ID); });
    if (jaBase.length) throw new AppError('DUPLICADO', 'Este SKU já foi lançado por você nesta posição.');
    if (qtd < 1) throw new AppError('DADOS', 'Informe a quantidade física encontrada (mínimo 1) para registrar a inclusão.');
    return Cnt.registrarInclusao(user, invId, posicao, sku, qtd, unidades.length, false, p.lote, p.validade);
  },

  registrarInclusao: function (user, invId, posicao, sku, qtd, restantes, presenca, lote, validade) {
    var val = Util.validade(validade);
    if (val === null) throw new AppError('DADOS', 'Validade inválida. Use o formato DD/MM/AAAA.');
    lote = Util.s(lote);
    var dup = DB.find('INCLUSOES', 'SKU', sku).filter(function (x) { return x.INV_ID === invId && x.POSICAO_ENCONTRADA === posicao && x.OPERADOR_ID === user.ID; });
    if (dup.length) throw new AppError('DUPLICADO', 'Inclusão deste SKU já registrada por você nesta posição.');
    var versao = Cfg.get('VERSAO_ATIVA'), info = { cliente: '', descricao: '', familia: '', codigo: '', outras: [] };
    var inv = Inv.obter(invId);
    var tab = Schema.versionTab('ARM', inv.VERSAO_BASE);
    if (DB.exists(tab)) {
      var hits = DB.find(tab, 'SKU', sku);
      if (hits.length) {
        info.cliente = hits[0].CLIENTE; info.descricao = hits[0].DESCRICAO; info.familia = hits[0].FAMILIA; info.codigo = hits[0].COD_ITEM_CLI;
        hits.forEach(function (h) { if (info.outras.indexOf(h.POSICAO) < 0) info.outras.push(h.POSICAO); });
      }
    }
    var flags = Regras.montarFlags(info.cliente, sku, presenca ? 1 : qtd, info.familia);
    var acao = Regras.buscarAcao(flags, invId);
    var d = Util.now();
    DB.append('INCLUSOES', [{ ID: Util.id('INC'), INV_ID: invId, CLIENTE: info.cliente, SKU: sku, DESCRICAO: info.descricao, POSICAO_ENCONTRADA: posicao, QTD: presenca ? '' : qtd,
      OUTRAS_POSICOES: JSON.stringify(info.outras), OPERADOR_ID: user.ID, OPERADOR_NOME: user.NOME, DATA: Util.data(d), HORA: Util.hora(d),
      FLAGS: JSON.stringify(flags), ACAO: acao.acao, STATUS: 'PENDENTE_ANALISE', OBS: '', LOTE: lote, VALIDADE: val }]);
    Audit.log(user, 'INCLUSAO_IDENTIFICADA', 'INCLUSAO', sku, { posicao: posicao, qtd: qtd });
    return { tipo: 'INCLUSAO', finalizada: false, mensagem: Msg.get('INCLUSAO'), restantes: restantes,
      detalhe: { sku: sku, descricao: info.descricao, codigoBarras: info.codigo, qtd: presenca ? '' : qtd, posicao: posicao, outrasPosicoes: info.outras, cliente: info.cliente, lote: lote, validade: val } };
  },

  /** Conclui a posição: SKUs não lidos são lançados como zero (não encontrados), mediante confirmação. */
  concluir: function (user, p) {
    var unidades = Cnt.unidadesDaTarefa(user, p.tarefaId);
    if (unidades.length && p.confirmarZero !== true) return { exigeConfirmacao: true, pendentes: unidades.length };
    unidades.forEach(function (f) { Cnt.processar(user, f, 0, p.tarefaId); });
    return { concluida: true, zerados: unidades.length };
  },

  /** Ficha do produto bipado (foto, descrição, lote/validade). Nunca devolve saldo. */
  produto: function (user, p) {
    var unidades = Cnt.unidadesDaTarefa(user, p.tarefaId);
    if (!unidades.length) throw new AppError('TAREFA', 'Tarefa inexistente, expirada ou já concluída.');
    var sku = Util.normSku(p.sku);
    if (!sku) throw new AppError('DADOS', 'Bipe o SKU.');
    var alvo = null, base = null, i;
    for (i = 0; i < unidades.length && !alvo; i++) if (Util.normSku(unidades[i].SKU) === sku) { alvo = unidades[i]; base = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', alvo.UNIDADE_ID)[0]; }
    for (i = 0; i < unidades.length && !alvo; i++) {
      var b = DB.find('BASE_INVENTARIO', 'UNIDADE_ID', unidades[i].UNIDADE_ID)[0];
      if (b && b.COD_ITEM_CLI && Util.normSku(b.COD_ITEM_CLI) === sku) { alvo = unidades[i]; base = b; }
    }
    var lot = Util.lotes;
    if (alvo) return { pertence: true, sku: alvo.SKU, descricao: base.DESCRICAO, cliente: base.CLIENTE, codigoBarras: base.COD_ITEM_CLI, lotes: Inv.lotesDe(Inv.obter(alvo.INV_ID), base) };
    var inv = Inv.obter(unidades[0].INV_ID), info = { pertence: false, sku: sku, descricao: '', cliente: '', codigoBarras: '', lotes: [] };
    var tab = Schema.versionTab('ARM', inv.VERSAO_BASE);
    if (DB.exists(tab)) { var h = DB.find(tab, 'SKU', sku)[0]; if (h) { info.descricao = h.DESCRICAO; info.cliente = h.CLIENTE; info.codigoBarras = h.COD_ITEM_CLI; info.lotes = Util.lotes(h.LOTES_DET); } }
    return info;
  },

  historico: function (user) {
    return DB.find('CONTAGENS', 'OPERADOR_ID', user.ID).slice(-200).reverse().map(function (c) {
      return { inventario: c.INV_ID, sku: c.SKU, posicao: c.POSICAO, qtd: c.QTD, data: c.DATA, hora: c.HORA };
    });
  }
};

/** Check de posição: mostra os SKUs esperados (sem saldos) e registra encontrados, divergências e inclusões. */
var Chk = {
  /** Aceita a posição em minúsculo/com espaços: devolve a grafia cadastrada no inventário. */
  resolverPosicao: function (inv, texto) {
    var alvo = Util.normPosicao(texto), ids = DB.col('BASE_INVENTARIO', 'INV_ID'), pos = DB.col('BASE_INVENTARIO', 'POSICAO');
    for (var i = 0; i < ids.length; i++) if (ids[i] === inv.ID && Util.normPosicao(pos[i]) === alvo) return pos[i];
    return Util.s(texto);
  },

  esperados: function (user, p) {
    var inv = Cnt.checarInventario(p.invId, true, user);
    var posicao = Chk.resolverPosicao(inv, p.posicao);
    var rows = DB.find('BASE_INVENTARIO', 'POSICAO', posicao).filter(function (b) { return b.INV_ID === inv.ID; });
    if (!rows.length) throw new AppError('POSICAO', 'Posição não pertence a este inventário.');
    var lido = Util.s(p.leitura).toUpperCase();
    if (!(Util.normPosicao(lido) === Util.normPosicao(posicao) || (rows[0].VERIF && lido === String(rows[0].VERIF).toUpperCase())))
      throw new AppError('POSICAO_ERRADA', 'A posição lida não confere.');
    var feito = DB.find('CHECK_POSICAO', 'POSICAO', posicao).filter(function (c) { return c.INV_ID === inv.ID; });
    if (feito.length) throw new AppError('DUPLICADO', 'Esta posição já foi conferida neste inventário.');
    return { posicao: posicao, modo: Chk.modo(inv), itens: rows.map(function (b) { return { sku: b.SKU, descricao: b.DESCRICAO, cliente: b.CLIENTE, codigoBarras: b.COD_ITEM_CLI, lotes: Inv.lotesDe(inv, b) }; }) };
  },

  /** Posições do inventário de check que ainda não foram conferidas (sem revelar SKUs nem saldos). */
  pendentes: function (inv) {
    var feitas = {}; DB.find('CHECK_POSICAO', 'INV_ID', inv.ID).forEach(function (c) { feitas[c.POSICAO] = 1; });
    var mapa = {}, ordem = [];
    DB.find('BASE_INVENTARIO', 'INV_ID', inv.ID).forEach(function (b) {
      if (feitas[b.POSICAO] || Fic.sim(b.FICTICIO)) return;
      if (!mapa[b.POSICAO]) { mapa[b.POSICAO] = { posicao: b.POSICAO, itens: 0 }; ordem.push(b.POSICAO); }
      mapa[b.POSICAO].itens++;
    });
    return ordem.sort().map(function (k) { return mapa[k]; });
  },

  posicoes: function (user, p) {
    var inv = Cnt.checarInventario(p.invId, true, user);
    var l = Chk.pendentes(inv);
    var total = new Set(DB.find('BASE_INVENTARIO', 'INV_ID', inv.ID).filter(function (b) { return !Fic.sim(b.FICTICIO); }).map(function (b) { return b.POSICAO; })).size;
    return { posicoes: l.slice(0, 400), pendentes: l.length, total: total, feitas: total - l.length, modo: Chk.modo(inv) };
  },

  modo: function (inv) { return Util.json(inv.FILTROS, {}).modoCheck === 'PRESENCA' ? 'PRESENCA' : 'CONTAGEM'; },

  registrar: function (user, p) {
    var inv = Cnt.checarInventario(p.invId, true, user);
    var presenca = Chk.modo(inv) === 'PRESENCA';
    var posicao = Chk.resolverPosicao(inv, p.posicao);
    var base = DB.find('BASE_INVENTARIO', 'POSICAO', posicao).filter(function (b) { return b.INV_ID === inv.ID; });
    if (!base.length) throw new AppError('POSICAO', 'Posição não pertence a este inventário.');
    if (DB.find('CHECK_POSICAO', 'POSICAO', posicao).filter(function (c) { return c.INV_ID === inv.ID; }).length) throw new AppError('DUPLICADO', 'Esta posição já foi conferida neste inventário.');
    (p.inclusoes || []).forEach(function (x) { if (Util.validade(x.validade) === null) throw new AppError('DADOS', 'Validade inválida na inclusão ' + Util.s(x.sku) + '. Use DD/MM/AAAA.'); });
    var enviados = {}; (p.itens || []).forEach(function (i) { enviados[Util.normSku(i.sku)] = i; });
    var d = Util.now(), linhas = [], divergentes = 0;
    base.forEach(function (b) {
      var it = enviados[Util.normSku(b.SKU)];
      var encontrado = !!(it && it.encontrado), qtd = (encontrado && !presenca) ? Cnt.validarQtd(it.qtd) : 0;
      var ok = presenca ? encontrado : qtd === Number(b.SALDO);
      if (!ok) { divergentes++; Cnt.registrarDivergencia(inv.ID, b.UNIDADE_ID, b.CLIENTE, b.SKU, posicao, Number(b.SALDO), qtd, 0, b.FAMILIA, b.VALOR_UNIT); }
      linhas.push({ ID: Util.id('CHK'), INV_ID: inv.ID, POSICAO: posicao, CLIENTE: b.CLIENTE, SKU: b.SKU, ENCONTRADO: encontrado ? 'S' : 'N', QTD: presenca ? '' : qtd,
        RESULTADO: ok ? 'SEM_DIVERGENCIA' : 'DIVERGENTE', OPERADOR_ID: user.ID, OPERADOR_NOME: user.NOME, DATA: Util.data(d), HORA: Util.hora(d) });
    });
    DB.append('CHECK_POSICAO', linhas);
    var incl = 0;
    (p.inclusoes || []).forEach(function (x) {
      var sku = Util.normSku(x.sku); if (!sku) return; var q = presenca ? 0 : Cnt.validarQtd(x.qtd);
      if (base.some(function (b) { return Util.normSku(b.SKU) === sku; })) return; // já esperado nesta posição
      if (!presenca && q < 1) return;
      Cnt.registrarInclusao(user, inv.ID, posicao, sku, q, 0, presenca, x.lote, x.validade); incl++;
    });
    Audit.log(user, 'CHECK_POSICAO', 'POSICAO', posicao, { inventario: inv.ID, itens: base.length, divergentes: divergentes, inclusoes: incl });
    return { itens: base.length, divergentes: divergentes, inclusoes: incl, mensagem: divergentes ? 'Check concluído com divergências registradas.' : 'Check concluído sem divergências.' };
  }
};
