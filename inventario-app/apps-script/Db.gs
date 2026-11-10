/**
 * Db.gs — camada de acesso ao Google Planilhas (fonte oficial de dados).
 * Interface usada por todos os serviços (e substituída por um banco em memória nos testes).
 */
var DB = (function () {
  function ss() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  function sheet(tab) {
    var s = ss().getSheetByName(tab);
    if (!s) throw new AppError('ABA', 'Aba inexistente: ' + tab);
    return s;
  }
  function toObj(cols, row, nrow) {
    var o = { _row: nrow };
    for (var i = 0; i < cols.length; i++) {
      var v = row[i];
      o[cols[i]] = (NUMCOLS.indexOf(cols[i]) >= 0 && v !== '') ? Number(v) : v;
    }
    return o;
  }
  function nc(s, cols) { return Math.max(1, Math.min(cols.length, s.getLastColumn())); }
  function ensureRows(s, ate) {
    var max = s.getMaxRows();
    if (ate > max) s.insertRowsAfter(max, ate - max + 500);
  }

  return {
    exists: function (tab) { return !!ss().getSheetByName(tab); },
    ensure: function (tab) {
      var cols = Schema.cols(tab);
      var s = ss().getSheetByName(tab);
      if (s) { // migração: acrescenta colunas novas ao fim, sem tocar nos dados
        var tem = s.getLastColumn();
        if (tem < cols.length) {
          if (s.getMaxColumns() < cols.length) s.insertColumnsAfter(s.getMaxColumns(), cols.length - s.getMaxColumns());
          s.getRange(1, tem + 1, 1, cols.length - tem).setValues([cols.slice(tem)]).setFontWeight('bold').setBackground('#e8eef7');
        }
        return s;
      }
      s = ss().insertSheet(tab);
      var maxC = s.getMaxColumns();
      if (maxC > cols.length) s.deleteColumns(cols.length + 1, maxC - cols.length);
      var maxR = s.getMaxRows();
      if (maxR > 2) s.deleteRows(3, maxR - 2);
      cols.forEach(function (c, i) {
        if (NUMCOLS.indexOf(c) < 0) s.getRange(1, i + 1, 2, 1).setNumberFormat('@');
      });
      s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eef7');
      s.setFrozenRows(1);
      return s;
    },
    drop: function (tab) { var s = ss().getSheetByName(tab); if (s) ss().deleteSheet(s); },
    count: function (tab) { return Math.max(sheet(tab).getLastRow() - 1, 0); },
    all: function (tab) {
      var s = sheet(tab), cols = Schema.cols(tab), last = s.getLastRow();
      if (last < 2) return [];
      var vals = s.getRange(2, 1, last - 1, nc(s, cols)).getValues();
      return vals.map(function (r, i) { return toObj(cols, r, i + 2); });
    },
    slice: function (tab, offset, limite) {
      var s = sheet(tab), cols = Schema.cols(tab), last = s.getLastRow();
      var ini = 2 + offset; if (ini > last) return [];
      var n = Math.min(limite, last - ini + 1);
      var vals = s.getRange(ini, 1, n, nc(s, cols)).getValues();
      return vals.map(function (r, i) { return toObj(cols, r, ini + i); });
    },
    col: function (tab, nome) {
      var s = sheet(tab), cols = Schema.cols(tab), last = s.getLastRow();
      if (last < 2) return [];
      var idx = cols.indexOf(nome) + 1;
      if (idx > s.getLastColumn()) { var v = []; for (var i = 0; i < last - 1; i++) v.push(''); return v; }
      return s.getRange(2, idx, last - 1, 1).getValues().map(function (r) { return r[0]; });
    },
    append: function (tab, objs) {
      if (!objs.length) return;
      var s = sheet(tab), cols = Schema.cols(tab);
      var vals = objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : o[c]; }); });
      var ini = s.getLastRow() + 1;
      ensureRows(s, ini + vals.length - 1);
      s.getRange(ini, 1, vals.length, cols.length).setValues(vals);
    },
    /** Apaga fisicamente as linhas cuja coluna == valor (em blocos contíguos, de baixo para cima). */
    removeWhere: function (tab, nome, valor) {
      var s = sheet(tab), col = DB.col(tab, nome), fim = -1, n = 0, i;
      if (s.getMaxRows() - s.getLastRow() < 2) s.insertRowsAfter(s.getMaxRows(), 5); // o Sheets não deixa apagar todas as linhas não congeladas
      for (i = col.length - 1; i >= -1; i--) {
        var casa = i >= 0 && String(col[i]) === String(valor);
        if (casa && fim < 0) fim = i;
        if (!casa && fim >= 0) { s.deleteRows(i + 3, fim - i); n += fim - i; fim = -1; }
      }
      return n;
    },
    /** Apaga fisicamente as linhas cuja coluna satisfaz fn(valor) (em blocos contíguos, de baixo para cima). */
    removeIf: function (tab, nome, fn) {
      var s = sheet(tab), col = DB.col(tab, nome), fim = -1, n = 0, i;
      if (s.getMaxRows() - s.getLastRow() < 2) s.insertRowsAfter(s.getMaxRows(), 5); // o Sheets não deixa apagar todas as linhas não congeladas
      for (i = col.length - 1; i >= -1; i--) {
        var casa = i >= 0 && !!fn(col[i]);
        if (casa && fim < 0) fim = i;
        if (!casa && fim >= 0) { s.deleteRows(i + 3, fim - i); n += fim - i; fim = -1; }
      }
      return n;
    },
    find: function (tab, nome, valor) {
      var s = sheet(tab), cols = Schema.cols(tab), last = s.getLastRow();
      if (last < 2) return [];
      var idx = cols.indexOf(nome) + 1;
      if (idx > s.getLastColumn()) return [];
      var achados = s.getRange(2, idx, last - 1, 1).createTextFinder(String(valor)).matchEntireCell(true).matchCase(true).findAll();
      return achados.map(function (r) {
        var n = r.getRow();
        return toObj(cols, s.getRange(n, 1, 1, nc(s, cols)).getValues()[0], n);
      });
    },
    update: function (tab, row, patch) {
      var s = sheet(tab), cols = Schema.cols(tab);
      var rng = s.getRange(row, 1, 1, nc(s, cols));
      var vals = rng.getValues()[0];
      Object.keys(patch).forEach(function (k) {
        var i = cols.indexOf(k); if (i >= 0 && i < vals.length) vals[i] = patch[k];
      });
      rng.setValues([vals]);
    }
  };
})();
