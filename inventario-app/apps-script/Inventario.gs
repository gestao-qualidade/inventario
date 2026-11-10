/**
 * Inventario.gs — criação/publicação de inventários (fotografia congelada da base),
 * dashboard, tratativas e inclusões.
 */
var TIPOS_INV = ['GERAL', 'CICLICO', 'CHECK', 'ESPECIAL'];

var Inv = {
  obter: function (id) {
    var r = DB.find('INVENTARIOS', 'ID', id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Inventário não encontrado.');
    return r;
  },
  publico: function (r) {
    return { id: r.ID, nome: r.NOME, tipo: r.TIPO, status: r.STATUS, clientes: Util.json(r.CLIENTES, []), filtros: Util.json(r.FILTROS, {}),
      versaoBase: r.VERSAO_BASE, totalUnidades: r.TOTAL_UNIDADES, totalPosicoes: r.TOTAL_POSICOES, periodicidade: r.PERIODICIDADE,
      responsaveis: Util.json(r.RESPONSAVEIS, []), criadoPor: r.CRIADO_POR, criadoEm: r.CRIADO_EM, publicadoEm: r.PUBLICADO_EM, encerradoEm: r.ENCERRADO_EM,
      modoCheck: r.TIPO === 'CHECK' ? (Util.json(r.FILTROS, {}).modoCheck || 'CONTAGEM') : '', inicioPrevisto: r.INICIO_PREVISTO || '', fimPrevisto: r.FIM_PREVISTO || '' };
  },
  unidadeId: function (inv, cli, sku, pos) { return [inv, cli, sku, pos].join('|'); },

  /** Lê início/fim previstos ("AAAA-MM-DDTHH:MM", horário de Brasília). Início no futuro = agendado. */
  lerAgenda: function (p, agora) {
    var out = { inicio: '', epoch: '', fim: '' };
    if (p.inicio) {
      var e = Date.parse(String(p.inicio).slice(0, 16) + ':00-03:00');
      if (isNaN(e)) throw new AppError('DADOS', 'Data de início inválida.');
      out.inicio = String(p.inicio).slice(0, 16); out.epoch = e;
    }
    if (p.fim) {
      var f = Date.parse(String(p.fim).slice(0, 16) + ':00-03:00');
      if (isNaN(f)) throw new AppError('DADOS', 'Data de término inválida.');
      if (out.epoch !== '' && f <= out.epoch) throw new AppError('DADOS', 'O término deve ser depois do início.');
      out.fim = String(p.fim).slice(0, 16);
    }
    return out;
  },

  /** Inventários AGENDADOS cuja hora chegou passam a ATIVO (idempotente; chamado pelo gatilho e ao listar). */
  ativarAgendados: function () {
    var agora = Util.now().getTime(), n = 0;
    DB.find('INVENTARIOS', 'STATUS', 'AGENDADO').forEach(function (i) {
      if (i.INICIO_EPOCH !== '' && Number(i.INICIO_EPOCH) <= agora) {
        var d = Util.now();
        DB.update('INVENTARIOS', i._row, { STATUS: 'ATIVO', PUBLICADO_EM: Util.data(d) + ' ' + Util.hora(d) });
        Audit.log(null, 'INVENTARIO_INICIADO_AGENDA', 'INVENTARIO', i.ID, {}); n++;
      }
    });
    return n;
  },

  criar: function (user, p) {
    if (!Util.s(p.nome)) throw new AppError('DADOS', 'Informe o nome do inventário.');
    if (TIPOS_INV.indexOf(p.tipo) < 0) throw new AppError('DADOS', 'Tipo de inventário inválido.');
    var modoCheck = '';
    if (p.tipo === 'CHECK') {
      modoCheck = p.modoCheck === 'PRESENCA' ? 'PRESENCA' : 'CONTAGEM';
      if (modoCheck === 'PRESENCA' && user.PERFIL !== 'ADMINISTRADOR') throw new AppError('NEGADO', 'Só o administrador escolhe o check somente de presença (sem contagem).');
    }
    var versao = Cfg.get('VERSAO_ATIVA');
    if (!versao) throw new AppError('SEM_BASE', 'Nenhuma base publicada. Atualize as bases antes de criar o inventário.');
    var d = Util.now();
    var rec = { ID: Util.id('INV'), NOME: Util.s(p.nome), TIPO: p.tipo, STATUS: 'PREPARANDO', CLIENTES: JSON.stringify(p.clientes || []),
      FILTROS: JSON.stringify({ galpoes: p.galpoes || [], ruas: p.ruas || [], colunas: p.colunas || [], alturas: p.alturas || [], curvas: p.curvas || [], posicoes: p.posicoes || [], skus: (p.skus || []).map(Util.normSku), modoCheck: modoCheck }),
      VERSAO_BASE: versao, PROGRESSO: 0, TOTAL_UNIDADES: 0, TOTAL_POSICOES: 0, PERIODICIDADE: Util.s(p.periodicidade),
      RESPONSAVEIS: JSON.stringify(p.responsaveis || []), CRIADO_POR: user.ID, CRIADO_EM: Util.data(d) + ' ' + Util.hora(d),
      INICIO_PREVISTO: '', INICIO_EPOCH: '', FIM_PREVISTO: '' };
    var ag = Inv.lerAgenda(p, d); rec.INICIO_PREVISTO = ag.inicio; rec.INICIO_EPOCH = ag.epoch; rec.FIM_PREVISTO = ag.fim;
    DB.append('INVENTARIOS', [rec]);
    Audit.log(user, 'INVENTARIO_CRIADO', 'INVENTARIO', rec.ID, { nome: rec.NOME, tipo: rec.TIPO, versao: versao });
    return { id: rec.ID, linhasBase: DB.count(Schema.versionTab('ARM', versao)) };
  },

  /** Copia a fotografia da base (versão ativa no momento da criação) em lotes. Idempotente por offset. */
  prepararLote: function (user, p) {
    var inv = Inv.obter(p.id);
    if (inv.STATUS !== 'PREPARANDO') throw new AppError('STATUS', 'Inventário não está em preparação.');
    var offset = Number(p.offset) || 0, limite = Math.min(Number(p.limite) || 3000, 5000);
    var tab = Schema.versionTab('ARM', inv.VERSAO_BASE);
    var total = DB.count(tab);
    if (offset !== Number(inv.PROGRESSO)) return { proximo: Number(inv.PROGRESSO), total: total, fim: Number(inv.PROGRESSO) >= total, ignorado: true };
    var f = Util.json(inv.FILTROS, {}), clientes = Util.json(inv.CLIENTES, []);
    var linhas = DB.slice(tab, offset, limite);
    var d = Util.now(), ts = Util.data(d) + ' ' + Util.hora(d);
    var base = [], fila = [];
    linhas.forEach(function (r) {
      if (Fic.sim(r.FICTICIO)) return; // posição fictícia não entra no inventário
      if (clientes.length && clientes.indexOf(r.CLIENTE) < 0) return;
      if (f.galpoes && f.galpoes.length && f.galpoes.indexOf(r.GALPAO) < 0) return;
      var pp = Util.partesPosicao(r.POSICAO);
      if (f.ruas && f.ruas.length && f.ruas.indexOf(pp.rua) < 0) return;
      if (f.colunas && f.colunas.length && f.colunas.indexOf(pp.coluna) < 0) return;
      if (f.alturas && f.alturas.length && f.alturas.indexOf(pp.altura) < 0) return;
      if (f.skus && f.skus.length && f.skus.indexOf(Util.normSku(r.SKU)) < 0) return;
      if (f.curvas && f.curvas.length && f.curvas.indexOf(r.CURVA) < 0) return;
      if (f.posicoes && f.posicoes.length && f.posicoes.indexOf(r.POSICAO) < 0) return;
      var uid = Inv.unidadeId(inv.ID, r.CLIENTE, r.SKU, r.POSICAO);
      base.push({ INV_ID: inv.ID, UNIDADE_ID: uid, CLIENTE: r.CLIENTE, SKU: r.SKU, DESCRICAO: r.DESCRICAO, POSICAO: r.POSICAO, VERIF: r.VERIF,
        GALPAO: r.GALPAO, SALDO: r.QTD, FAMILIA: r.FAMILIA, CURVA: r.CURVA, COD_ITEM_CLI: r.COD_ITEM_CLI, FICTICIO: r.FICTICIO, VALOR_UNIT: r.VALOR_UNIT, LOTES_DET: r.LOTES_DET });
      if (inv.TIPO !== 'CHECK') fila.push({ UNIDADE_ID: uid, INV_ID: inv.ID, POSICAO: r.POSICAO, CLIENTE: r.CLIENTE, SKU: r.SKU, ETAPA: 1, STATUS: 'DISPONIVEL',
        RESERVADO_POR: '', RESERVADO_ATE: '', TAREFA_ID: '', C1_OP: '', C2_OP: '', C3_OP: '', VERSAO: 1, ATUALIZADO_EM: ts });
    });
    DB.append('BASE_INVENTARIO', base);
    DB.append('FILA_CONTAGENS', fila);
    var prox = offset + linhas.length;
    DB.update('INVENTARIOS', inv._row, { PROGRESSO: prox });
    return { proximo: prox, total: total, fim: prox >= total, gravadas: base.length };
  },

  publicar: function (user, p) {
    var inv = Inv.obter(p.id);
    if (inv.STATUS !== 'PREPARANDO') throw new AppError('STATUS', 'Inventário já publicado ou cancelado.');
    var total = DB.count(Schema.versionTab('ARM', inv.VERSAO_BASE));
    if (Number(inv.PROGRESSO) < total) throw new AppError('INCOMPLETO', 'A cópia da base ainda não terminou.');
    var ids = DB.col('BASE_INVENTARIO', 'INV_ID'), uids = DB.col('BASE_INVENTARIO', 'UNIDADE_ID');
    var n = 0, vistos = {}, pos = {};
    for (var i = 0; i < ids.length; i++) if (ids[i] === inv.ID) { n++; if (vistos[uids[i]]) throw new AppError('DUPLICIDADE', 'Unidades duplicadas detectadas. Cancele e recrie o inventário.'); vistos[uids[i]] = 1; }
    if (n === 0) throw new AppError('VAZIO', 'Nenhuma unidade atende aos filtros escolhidos.');
    if (inv.TIPO !== 'CHECK') {
      var fi = DB.col('FILA_CONTAGENS', 'INV_ID'), nf = 0;
      for (var j = 0; j < fi.length; j++) if (fi[j] === inv.ID) nf++;
      if (nf !== n) throw new AppError('DUPLICIDADE', 'Fila e base divergem. Cancele e recrie o inventário.');
    }
    var pcol = DB.col('BASE_INVENTARIO', 'POSICAO');
    for (var k = 0; k < ids.length; k++) if (ids[k] === inv.ID) pos[pcol[k]] = 1;
    var d = Util.now();
    var futuro = inv.INICIO_EPOCH !== '' && Number(inv.INICIO_EPOCH) > d.getTime();
    DB.update('INVENTARIOS', inv._row, { STATUS: futuro ? 'AGENDADO' : 'ATIVO', TOTAL_UNIDADES: n, TOTAL_POSICOES: Object.keys(pos).length, PUBLICADO_EM: futuro ? '' : Util.data(d) + ' ' + Util.hora(d) });
    Audit.log(user, futuro ? 'INVENTARIO_AGENDADO' : 'INVENTARIO_PUBLICADO', 'INVENTARIO', inv.ID, { unidades: n, inicio: inv.INICIO_PREVISTO });
    return Inv.publico(Inv.obter(inv.ID));
  },

  encerrar: function (user, p) {
    var inv = Inv.obter(p.id);
    if (inv.STATUS !== 'ATIVO') throw new AppError('STATUS', 'Só é possível encerrar inventários ativos.');
    var d = Util.now();
    DB.update('INVENTARIOS', inv._row, { STATUS: 'ENCERRADO', ENCERRADO_EM: Util.data(d) + ' ' + Util.hora(d) });
    Audit.log(user, 'INVENTARIO_ENCERRADO', 'INVENTARIO', inv.ID, {});
    return Inv.publico(Inv.obter(inv.ID));
  },

  /** Muda início/término de um inventário agendado (ou só o término de um ativo). "iniciarAgora" ativa na hora. */
  reagendar: function (user, p) {
    var inv = Inv.obter(p.id);
    if (['AGENDADO', 'ATIVO'].indexOf(inv.STATUS) < 0) throw new AppError('STATUS', 'Só dá para reagendar inventários agendados ou ativos.');
    var d = Util.now(), patch = {};
    if (p.iniciarAgora) {
      if (inv.STATUS !== 'AGENDADO') throw new AppError('STATUS', 'O inventário já está ativo.');
      patch = { STATUS: 'ATIVO', PUBLICADO_EM: Util.data(d) + ' ' + Util.hora(d), INICIO_PREVISTO: '', INICIO_EPOCH: '' };
    } else {
      var ag = Inv.lerAgenda(p, d);
      if (inv.STATUS === 'AGENDADO') {
        if (ag.epoch === '') throw new AppError('DADOS', 'Informe a data de início.');
        if (ag.epoch <= d.getTime()) throw new AppError('DADOS', 'Para iniciar agora use "Iniciar agora".');
        patch.INICIO_PREVISTO = ag.inicio; patch.INICIO_EPOCH = ag.epoch;
      }
      patch.FIM_PREVISTO = ag.fim;
    }
    DB.update('INVENTARIOS', inv._row, patch);
    Audit.log(user, 'INVENTARIO_REAGENDADO', 'INVENTARIO', inv.ID, patch);
    return Inv.publico(Inv.obter(inv.ID));
  },

  /**
   * Exclui o inventário: some das listas, libera o espaço da planilha (apaga base congelada e fila) e registra na auditoria.
   * Contagens, divergências e inclusões ficam guardadas para auditoria. Inventário ATIVO/ENCERRADO só o ADMINISTRADOR exclui,
   * digitando o nome para confirmar.
   */
  excluir: function (user, p) {
    var inv = Inv.obter(p.id);
    if (inv.STATUS === 'EXCLUIDO') throw new AppError('STATUS', 'Inventário já excluído.');
    var comDados = ['ATIVO', 'ENCERRADO'].indexOf(inv.STATUS) >= 0;
    if (comDados) {
      if (user.PERFIL !== 'ADMINISTRADOR') throw new AppError('NEGADO', 'Só o administrador exclui inventário ativo ou encerrado.');
      if (Util.s(p.confirmar) !== Util.s(inv.NOME)) throw new AppError('CONFIRMACAO', 'Digite o nome exato do inventário para confirmar.');
    }
    var res = { base: DB.removeWhere('BASE_INVENTARIO', 'INV_ID', inv.ID), fila: DB.removeWhere('FILA_CONTAGENS', 'INV_ID', inv.ID) };
    DB.update('INVENTARIOS', inv._row, { STATUS: 'EXCLUIDO' });
    Audit.log(user, 'INVENTARIO_EXCLUIDO', 'INVENTARIO', inv.ID, { nome: inv.NOME, statusAnterior: inv.STATUS, linhasRemovidas: res });
    return { ok: true };
  },

  cancelar: function (user, p) {
    var inv = Inv.obter(p.id);
    if (['PREPARANDO', 'AGENDADO'].indexOf(inv.STATUS) < 0) throw new AppError('STATUS', 'Só é possível cancelar inventários em preparação ou agendados.');
    DB.update('INVENTARIOS', inv._row, { STATUS: 'CANCELADO' });
    Audit.log(user, 'INVENTARIO_CANCELADO', 'INVENTARIO', inv.ID, {});
    return { ok: true };
  },

  /** Catálogo compacto da base ativa para os filtros em cascata do navegador (índices em dicionários). */
  catalogo: function () {
    var v = Cfg.get('VERSAO_ATIVA');
    if (!v) throw new AppError('SEM_BASE', 'Nenhuma base publicada. Use a Central de Atualização das Bases.');
    var guardado = Cache.get('cat2_' + v); if (guardado) return guardado;
    var tab = Schema.versionTab('ARM', v);
    var cli = DB.col(tab, 'CLIENTE'), gal = DB.col(tab, 'GALPAO'), pos = DB.col(tab, 'POSICAO'), cur = DB.col(tab, 'CURVA'), sku = DB.col(tab, 'SKU');
    var sem = Fic.filtrar(DB.col(tab, 'FICTICIO'), [cli, gal, pos, cur, sku]); cli = sem[0]; gal = sem[1]; pos = sem[2]; cur = sem[3]; sku = sem[4];
    var dims = { clientes: {}, galpoes: {}, ruas: {}, colunas: {}, alturas: {}, curvas: {}, skus: {} };
    var partes = new Array(pos.length), i;
    for (i = 0; i < pos.length; i++) {
      var pp = Util.partesPosicao(pos[i]); partes[i] = pp;
      dims.clientes[cli[i]] = 1; dims.galpoes[gal[i]] = 1; dims.ruas[pp.rua] = 1; dims.colunas[pp.coluna] = 1; dims.alturas[pp.altura] = 1; dims.curvas[cur[i]] = 1; dims.skus[sku[i]] = 1;
    }
    var num = function (a, b) { var x = Number(a), y = Number(b); return (isNaN(x) || isNaN(y)) ? (a < b ? -1 : 1) : x - y; };
    var arr = {}, idx = {};
    Object.keys(dims).forEach(function (k) {
      arr[k] = Object.keys(dims[k]).sort(k === 'colunas' || k === 'alturas' ? num : undefined);
      idx[k] = {}; arr[k].forEach(function (x, n) { idx[k][x] = n; });
    });
    var linhas = new Array(pos.length);
    for (i = 0; i < pos.length; i++) linhas[i] = [idx.clientes[cli[i]], idx.galpoes[gal[i]], idx.ruas[partes[i].rua], idx.colunas[partes[i].coluna], idx.alturas[partes[i].altura], idx.curvas[cur[i]], idx.skus[sku[i]]];
    var out = { versao: v, total: pos.length, dims: arr, linhas: linhas };
    Cache.put('cat2_' + v, out, 21600);
    return out;
  },

  listar: function () { Inv.ativarAgendados(); return DB.all('INVENTARIOS').filter(function (i) { return i.STATUS !== 'EXCLUIDO'; }).reverse().map(Inv.publico); },

  /** Indicadores calculados sempre a partir dos dados reais gravados na planilha. */
  dashboard: function (user, p) {
    var chave = 'dash_' + p.id;
    if (!p.forcar) { var g = Cache.get(chave); if (g) return g; }
    var r = Inv.calcularDashboard(user, p); Cache.put(chave, r, 30); return r;
  },

  calcularDashboard: function (user, p) {
    var inv = Inv.obter(p.id), id = inv.ID;
    var cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;
    if (cache && !p.fresh) { var c = cache.get('dash_' + id); if (c) return JSON.parse(c); }

    var fIds = DB.col('FILA_CONTAGENS', 'INV_ID');
    var fPos = DB.col('FILA_CONTAGENS', 'POSICAO'), fCli = DB.col('FILA_CONTAGENS', 'CLIENTE'), fSt = DB.col('FILA_CONTAGENS', 'STATUS'), fUid = DB.col('FILA_CONTAGENS', 'UNIDADE_ID');
    var bIds = DB.col('BASE_INVENTARIO', 'INV_ID'), bUid = DB.col('BASE_INVENTARIO', 'UNIDADE_ID'), bCur = DB.col('BASE_INVENTARIO', 'CURVA');
    var curva = {};
    for (var b = 0; b < bIds.length; b++) if (bIds[b] === id) curva[bUid[b]] = bCur[b];

    var unidades = [], ficU = Fic.unidades();
    for (var i = 0; i < fIds.length; i++) if (fIds[i] === id && !ficU[fUid[i]]) unidades.push({ uid: fUid[i], pos: fPos[i], cli: fCli[i], st: fSt[i] });
    var contagens = DB.find('CONTAGENS', 'INV_ID', id);
    var diverg = DB.find('DIVERGENCIAS', 'INV_ID', id).filter(function (d) { return !ficU[d.UNIDADE_ID]; });
    var incl = DB.find('INCLUSOES', 'INV_ID', id);

    var posMap = {};
    unidades.forEach(function (u) { var o = posMap[u.pos] || (posMap[u.pos] = { t: 0, f: 0, a: 0 }); o.t++; if (u.st === 'FINALIZADA') o.f++; if (u.st === 'RESERVADO' || u.st === 'FINALIZADA') o.a++; });
    var posTotal = Object.keys(posMap).length, posFeitas = 0, posAndamento = 0;
    Object.keys(posMap).forEach(function (k) { var o = posMap[k]; if (o.f === o.t) posFeitas++; else if (o.a > 0 || o.f > 0) posAndamento++; });

    var finalizadas = unidades.filter(function (u) { return u.st === 'FINALIZADA'; }).length;
    var porEtapa = { 1: 0, 2: 0, 3: 0 };
    contagens.forEach(function (c) { porEtapa[c.ETAPA] = (porEtapa[c.ETAPA] || 0) + 1; });
    var c1 = contagens.filter(function (c) { return c.ETAPA === 1; });
    var c1ok = c1.filter(function (c) { return c.RESULTADO === 'IGUAL_SISTEMA'; }).length;
    var faltas = diverg.filter(function (d) { return d.TIPO === 'FALTA'; }).length, sobras = diverg.filter(function (d) { return d.TIPO === 'SOBRA'; }).length;
    var pend = diverg.filter(function (d) { return ST_ABERTAS.indexOf(d.STATUS) >= 0; }).length;
    var divUnid = {}; diverg.forEach(function (d) { divUnid[d.UNIDADE_ID] = d; });

    // produtividade e tempo médio (intervalos de até 10 min entre lançamentos do mesmo operador)
    var ops = {};
    contagens.slice().sort(function (a, b2) { return a.EPOCH - b2.EPOCH; }).forEach(function (c) {
      var o = ops[c.OPERADOR_NOME] || (ops[c.OPERADOR_NOME] = { nome: c.OPERADOR_NOME, contagens: 0, soma: 0, n: 0, ult: 0 });
      o.contagens++;
      if (o.ult && c.EPOCH - o.ult <= 600000) { o.soma += c.EPOCH - o.ult; o.n++; }
      o.ult = c.EPOCH;
    });
    var produtividade = Object.keys(ops).map(function (k) { var o = ops[k]; return { operador: o.nome, contagens: o.contagens, tempoMedioSeg: o.n ? Math.round(o.soma / o.n / 1000) : 0 }; })
      .sort(function (a, b2) { return b2.contagens - a.contagens; });
    var somaTotal = 0, nTotal = 0; Object.keys(ops).forEach(function (k) { somaTotal += ops[k].soma; nTotal += ops[k].n; });

    var evolucao = {}; contagens.forEach(function (c) { evolucao[c.DATA] = (evolucao[c.DATA] || 0) + 1; });
    function agrupa(items, chave) { var m = {}; items.forEach(function (x) { var k = chave(x); m[k] = (m[k] || 0) + 1; }); return Object.keys(m).map(function (k) { return { nome: k, valor: m[k] }; }).sort(function (a, b2) { return b2.valor - a.valor; }); }
    var rua = function (pos) { return String(pos).split('.')[0]; };
    var areas = {};
    unidades.forEach(function (u) { var a = areas[rua(u.pos)] || (areas[rua(u.pos)] = { area: rua(u.pos), unidades: 0, finalizadas: 0, divergentes: 0 }); a.unidades++; if (u.st === 'FINALIZADA') a.finalizadas++; if (divUnid[u.uid]) a.divergentes++; });
    var curvas = {};
    unidades.forEach(function (u) { var k = curva[u.uid] || '-'; var a = curvas[k] || (curvas[k] = { curva: k, unidades: 0, finalizadas: 0, divergentes: 0 }); a.unidades++; if (u.st === 'FINALIZADA') a.finalizadas++; if (divUnid[u.uid]) a.divergentes++; });

    var out = {
      inventario: Inv.publico(inv),
      kpis: { posicoesPlanejadas: posTotal, posicoesInventariadas: posFeitas, posicoesEmAndamento: posAndamento, percentualConclusao: posTotal ? Math.round(posFeitas / posTotal * 1000) / 10 : 0,
        posicoesPendentes: posTotal - posFeitas, totalSkus: unidades.length, unidadesFinalizadas: finalizadas, percentualUnidades: unidades.length ? Math.round(finalizadas / unidades.length * 1000) / 10 : 0,
        primeiras: porEtapa[1], segundas: porEtapa[2], terceiras: porEtapa[3], semDivergencia: finalizadas - diverg.length, faltas: faltas, sobras: sobras,
        inclusoes: incl.length, divergencias: diverg.length, pendenciasTratativa: pend,
        acuracidadePrimeira: c1.length ? Math.round(c1ok / c1.length * 1000) / 10 : 0,
        acuracidadeFinal: finalizadas ? Math.round((finalizadas - diverg.length) / finalizadas * 1000) / 10 : 0,
        tempoMedioSeg: nTotal ? Math.round(somaTotal / nTotal / 1000) : 0 },
      evolucao: Object.keys(evolucao).map(function (k) { return { data: k, contagens: evolucao[k] }; }),
      produtividade: produtividade,
      distribuicao: [{ nome: '1ª contagem', valor: porEtapa[1] }, { nome: '2ª contagem', valor: porEtapa[2] }, { nome: '3ª contagem', valor: porEtapa[3] }],
      divergenciasPorCliente: agrupa(diverg, function (d) { return d.CLIENTE; }).slice(0, 15),
      divergenciasPorPosicao: agrupa(diverg, function (d) { return d.POSICAO; }).slice(0, 15),
      resultadosPorArea: Object.keys(areas).sort().map(function (k) { return areas[k]; }),
      resultadosPorCurva: Object.keys(curvas).sort().map(function (k) { return curvas[k]; })
    };
    if (cache) { try { cache.put('dash_' + id, JSON.stringify(out), 20); } catch (e) {} }
    return out;
  },

  /** Lotes/validades de uma linha da fotografia. Se a fotografia não os tem (inventário antigo), busca na aba de armazenagem da versão da base. */
  lotesDe: function (inv, b) {
    if (b.LOTES_DET) return Util.lotes(b.LOTES_DET);
    try {
      var tab = Schema.versionTab('ARM', inv.VERSAO_BASE);
      if (DB.exists(tab)) { var h = DB.find(tab, 'KEY', b.POSICAO + '|' + b.CLIENTE + '|' + Util.normSku(b.SKU))[0]; if (h && h.LOTES_DET) return Util.lotes(h.LOTES_DET); }
    } catch (e) { /* sem lote */ }
    return [];
  },

  tratativas: function (user, p) {
    var rows = p.invId ? DB.find('DIVERGENCIAS', 'INV_ID', p.invId) : DB.all('DIVERGENCIAS');
    if (p.status) rows = rows.filter(function (r) { return r.STATUS === p.status; });
    var lm = Dv.lotesMapa();
    rows = rows.filter(function (r) { return !(lm[r.UNIDADE_ID] && lm[r.UNIDADE_ID].fic); });
    return rows.slice(-500).reverse().map(function (r) { delete r._row; r.LOTES = (lm[r.UNIDADE_ID] && lm[r.UNIDADE_ID].lotes) || []; r.DESCRICAO = (lm[r.UNIDADE_ID] && lm[r.UNIDADE_ID].descricao) || ''; return r; });
  },

  resolverTratativa: function (user, p) {
    if (!Util.s(p.tratativa)) throw new AppError('DADOS', 'Informe a tratativa aplicada (justificativa).');
    var tab = p.tipo === 'INCLUSAO' ? 'INCLUSOES' : 'DIVERGENCIAS';
    var r = DB.find(tab, 'ID', p.id)[0];
    if (!r) throw new AppError('NAO_ENCONTRADO', 'Registro não encontrado.');
    var d = Util.now(), ts = Util.data(d) + ' ' + Util.hora(d);
    if (tab === 'DIVERGENCIAS') {
      if (r.STATUS === 'RESOLVIDA') throw new AppError('STATUS', 'Divergência já tratada.');
      DB.update(tab, r._row, { STATUS: 'RESOLVIDA', TRATATIVA: Util.s(p.tratativa), RESOLVIDO_POR: user.ID, RESOLVIDO_EM: ts });
    } else {
      if (r.STATUS === 'RESOLVIDA') throw new AppError('STATUS', 'Inclusão já tratada.');
      DB.update(tab, r._row, { STATUS: 'RESOLVIDA', OBS: Util.s(p.tratativa) });
    }
    Audit.log(user, 'TRATATIVA_RESOLVIDA', tab, r.ID, { tratativa: p.tratativa });
    return { ok: true };
  },

  inclusoes: function (user, p) {
    var rows = p.invId ? DB.find('INCLUSOES', 'INV_ID', p.invId) : DB.all('INCLUSOES');
    return rows.slice(-500).reverse().map(function (r) { delete r._row; return r; });
  }
};
