/**
 * Mapa.gs — dados do mapa 3D do armazém (somente gestores/administradores).
 * Cobertura calculada sobre POSIÇÕES ÚNICAS, somando todos os inventários (sem duplicar).
 */
var ST_MAPA = { NAO: 0, ANDAMENTO: 1, OK: 2, DIVERGENTE: 3, PENDENTE: 4 };

var Mapa = {
  dados: function (user, p) {
    var versao = Cfg.get('VERSAO_ATIVA');
    if (!versao) throw new AppError('SEM_BASE', 'Nenhuma base publicada.');
    var chave = 'mapa2_' + versao + '_' + (p.invId || 'todos');
    if (!p.forcar) { var guardado = Cache.get(chave); if (guardado) return guardado; }
    var res = Mapa.calcular(p, versao); Cache.put(chave, res, 60); return res;
  },

  calcular: function (p, versao) {
    var arm = Schema.versionTab('ARM', versao);
    var pos = DB.col(arm, 'POSICAO'), gal = DB.col(arm, 'GALPAO');
    var sem = Fic.filtrar(DB.col(arm, 'FICTICIO'), [pos, gal]); pos = sem[0]; gal = sem[1]; // sem posição fictícia
    var unicas = {}, ordem = [];
    for (var i = 0; i < pos.length; i++) if (!unicas[pos[i]]) { unicas[pos[i]] = { gal: gal[i], t: 0, f: 0, a: 0, div: 0, pend: 0, chk: false }; ordem.push(pos[i]); }

    var validos = {};
    DB.all('INVENTARIOS').forEach(function (inv) {
      if (['ATIVO', 'ENCERRADO'].indexOf(inv.STATUS) >= 0 && (!p.invId || p.invId === inv.ID)) validos[inv.ID] = 1;
    });
    var fi = DB.col('FILA_CONTAGENS', 'INV_ID'), fp = DB.col('FILA_CONTAGENS', 'POSICAO'), fs = DB.col('FILA_CONTAGENS', 'STATUS');
    for (var j = 0; j < fi.length; j++) {
      if (!validos[fi[j]]) continue;
      var o = unicas[fp[j]]; if (!o) continue;
      o.t++; if (fs[j] === 'FINALIZADA') o.f++; if (fs[j] === 'RESERVADO') o.a++;
    }
    var ci = DB.col('CHECK_POSICAO', 'INV_ID'), cp = DB.col('CHECK_POSICAO', 'POSICAO');
    for (var k = 0; k < ci.length; k++) if (validos[ci[k]] && unicas[cp[k]]) unicas[cp[k]].chk = true;
    var di = DB.col('DIVERGENCIAS', 'INV_ID'), dp = DB.col('DIVERGENCIAS', 'POSICAO'), ds = DB.col('DIVERGENCIAS', 'STATUS');
    for (var m = 0; m < di.length; m++) {
      if (!validos[di[m]] || !unicas[dp[m]]) continue;
      unicas[dp[m]].div++; if (ST_ABERTAS.indexOf(ds[m]) >= 0) unicas[dp[m]].pend++;
    }
    // inventário específico: posições que não fazem parte dele ficam como "fora" (status 5)
    var dentro = null, totalInv = 0;
    if (p.invId) {
      dentro = {}; var bi = DB.col('BASE_INVENTARIO', 'INV_ID'), bp = DB.col('BASE_INVENTARIO', 'POSICAO');
      for (var q = 0; q < bi.length; q++) if (bi[q] === p.invId) dentro[bp[q]] = 1;
    }
    var cont = [0, 0, 0, 0, 0], galIdx = {}, galNomes = [];
    var lista = ordem.map(function (pp) {
      var o = unicas[pp], st;
      if (o.pend > 0) st = ST_MAPA.PENDENTE;
      else if ((o.t > 0 && o.f === o.t) || o.chk) st = o.div > 0 ? ST_MAPA.DIVERGENTE : ST_MAPA.OK;
      else if (o.a > 0 || o.f > 0) st = ST_MAPA.ANDAMENTO;
      else st = ST_MAPA.NAO;
      if (dentro && !dentro[pp]) st = 5; else { cont[st]++; totalInv++; }
      var gi = galIdx[o.gal]; if (gi === undefined) { gi = galNomes.length; galIdx[o.gal] = gi; galNomes.push(o.gal); }
      return [pp, gi, st];
    });
    var feitas = cont[2] + cont[3] + cont[4];
    return { versao: versao, galpoes: galNomes, posicoes: lista, contagem: { nao: cont[0], andamento: cont[1], ok: cont[2], divergente: cont[3], pendente: cont[4] },
      cobertura: { total: dentro ? totalInv : lista.length, inventariadas: feitas, percentual: (dentro ? totalInv : lista.length) ? Math.round(feitas / (dentro ? totalInv : lista.length) * 1000) / 10 : 0 } };
  },

  posicao: function (user, p) {
    var posicao = Util.s(p.posicao);
    var invs = {}; DB.all('INVENTARIOS').forEach(function (i) { invs[i.ID] = i.NOME; });
    var base = DB.find('BASE_INVENTARIO', 'POSICAO', posicao);
    var fila = DB.find('FILA_CONTAGENS', 'POSICAO', posicao);
    var stPorUnid = {}; fila.forEach(function (f) { stPorUnid[f.UNIDADE_ID] = f.STATUS; });
    var itens = base.map(function (b) {
      return { inventario: invs[b.INV_ID] || b.INV_ID, cliente: b.CLIENTE, sku: b.SKU, descricao: b.DESCRICAO, saldo: b.SALDO, curva: b.CURVA,
        lotes: Util.lotes(b.LOTES_DET), status: stPorUnid[b.UNIDADE_ID] || 'CHECK' };
    });
    var historico = DB.find('CONTAGENS', 'POSICAO', posicao).map(function (c) {
      return { data: c.DATA, hora: c.HORA, operador: c.OPERADOR_NOME, sku: c.SKU, qtd: c.QTD, etapa: c.ETAPA, inventario: invs[c.INV_ID] || c.INV_ID };
    });
    var diverg = DB.find('DIVERGENCIAS', 'POSICAO', posicao).map(function (d) {
      return { sku: d.SKU, saldo: d.SALDO, final: d.QTD_FINAL, tipo: d.TIPO, acao: d.ACAO, status: d.STATUS, inventario: invs[d.INV_ID] || d.INV_ID };
    });
    return { posicao: posicao, itens: itens, historico: historico, divergencias: diverg };
  }
};
