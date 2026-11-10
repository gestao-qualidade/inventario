/**
 * Schema.gs — estrutura das abas da planilha central.
 * Toda aba tem cabeçalho padronizado e IDs únicos (nunca depende da posição da linha).
 */
var SCHEMA = {
  USUARIOS: ['ID', 'NOME', 'EMAIL', 'LOGIN', 'PERFIL', 'STATUS', 'SENHA_HASH', 'SALT', 'TENTATIVAS', 'BLOQUEADO_ATE', 'PERMISSOES_EXTRA', 'TROCAR_SENHA', 'CRIADO_EM', 'ULTIMO_ACESSO', 'CRIADO_POR', 'TIPOS_INV'],
  INVENTARIOS: ['ID', 'NOME', 'TIPO', 'STATUS', 'CLIENTES', 'FILTROS', 'VERSAO_BASE', 'PROGRESSO', 'TOTAL_UNIDADES', 'TOTAL_POSICOES', 'PERIODICIDADE', 'RESPONSAVEIS', 'CRIADO_POR', 'CRIADO_EM', 'PUBLICADO_EM', 'ENCERRADO_EM', 'INICIO_PREVISTO', 'INICIO_EPOCH', 'FIM_PREVISTO'],
  BASE_INVENTARIO: ['INV_ID', 'UNIDADE_ID', 'CLIENTE', 'SKU', 'DESCRICAO', 'POSICAO', 'VERIF', 'GALPAO', 'SALDO', 'FAMILIA', 'CURVA', 'COD_ITEM_CLI', 'FICTICIO', 'VALOR_UNIT', 'LOTES_DET'],
  FILA_CONTAGENS: ['UNIDADE_ID', 'INV_ID', 'POSICAO', 'CLIENTE', 'SKU', 'ETAPA', 'STATUS', 'RESERVADO_POR', 'RESERVADO_ATE', 'TAREFA_ID', 'C1_OP', 'C2_OP', 'C3_OP', 'VERSAO', 'ATUALIZADO_EM'],
  CONTAGENS: ['ID', 'INV_ID', 'UNIDADE_ID', 'CLIENTE', 'SKU', 'POSICAO', 'QTD', 'ETAPA', 'OPERADOR_ID', 'OPERADOR_NOME', 'DATA', 'HORA', 'EPOCH', 'RESULTADO', 'STATUS', 'TAREFA_ID'],
  INCLUSOES: ['ID', 'INV_ID', 'CLIENTE', 'SKU', 'DESCRICAO', 'POSICAO_ENCONTRADA', 'QTD', 'OUTRAS_POSICOES', 'OPERADOR_ID', 'OPERADOR_NOME', 'DATA', 'HORA', 'FLAGS', 'ACAO', 'STATUS', 'OBS', 'DECISAO', 'RESPONSAVEL', 'PRAZO', 'REF_AJUSTE', 'DECIDIDO_POR', 'DECIDIDO_EM', 'HISTORICO', 'LOTE', 'VALIDADE'],
  DIVERGENCIAS: ['ID', 'INV_ID', 'UNIDADE_ID', 'CLIENTE', 'SKU', 'POSICAO', 'SALDO', 'QTD_FINAL', 'DIFERENCA', 'TIPO', 'ETAPA_FINAL', 'FLAGS', 'ACAO', 'STATUS', 'TRATATIVA', 'RESOLVIDO_POR', 'RESOLVIDO_EM', 'CRIADO_EM', 'VALOR_UNIT', 'DECISAO', 'RESPONSAVEL', 'PRAZO', 'REF_AJUSTE', 'DECIDIDO_POR', 'DECIDIDO_EM', 'HISTORICO'],
  CHECK_POSICAO: ['ID', 'INV_ID', 'POSICAO', 'CLIENTE', 'SKU', 'ENCONTRADO', 'QTD', 'RESULTADO', 'OPERADOR_ID', 'OPERADOR_NOME', 'DATA', 'HORA'],
  REGRAS: ['ID', 'CLIENTE', 'FISCAL', 'FISICO', 'PROMOCIONAL', 'PRODUTO', 'BRINDE', 'FALTA_BASE', 'ACAO', 'ATIVA', 'INVENTARIOS', 'MENSAGEM', 'VERSAO', 'ATUALIZADO_EM', 'ATUALIZADO_POR'],
  HISTORICO_REGRAS: ['ID', 'REGRA_ID', 'VERSAO', 'DADOS', 'ALTERADO_POR', 'ALTERADO_EM', 'MOTIVO'],
  MENSAGENS: ['CHAVE', 'TEXTO'],
  AUDITORIA: ['ID', 'DATA_HORA', 'USUARIO_ID', 'USUARIO_NOME', 'ACAO', 'ENTIDADE', 'ENTIDADE_ID', 'DETALHE'],
  CONFIGURACOES: ['CHAVE', 'VALOR'],
  HISTORICO_IMPORTACOES: ['ID', 'ANALISTA_ID', 'ANALISTA_NOME', 'DATA', 'HORA', 'ARQ_ARM', 'ARQ_CF', 'ARQ_BASE', 'REG_ARM', 'REG_CF', 'REG_BASE', 'REJ_ARM', 'REJ_CF', 'REJ_BASE', 'VERSAO_ANTERIOR', 'NOVA_VERSAO', 'STATUS', 'RESULTADO', 'JUSTIFICATIVA', 'CONFIRMADO_POR', 'CONFIRMADO_EM', 'RESUMO']
};

/** Abas de dados versionadas (uma aba por versão de carga: ARM_V0001, CF_V0001, BASE_V0001). */
var VSCHEMA = {
  ARM: ['KEY', 'GALPAO', 'POSICAO', 'VERIF', 'CLIENTE', 'SKU', 'DESCRICAO', 'FAMILIA', 'QTD', 'COD_ITEM_CLI', 'FICTICIO', 'VALOR_UNIT', 'CURVA', 'LOTES', 'LOTES_DET'],
  CF: ['KEY', 'CLIENTE', 'SKU', 'DESCRICAO', 'SALDO_CLIENTE', 'SALDO_FISCAL', 'SALDO_FISICO', 'PROMOCIONAL', 'GRUPO', 'DEPTO', 'VALOR_UNIT'],
  BASE: ['KEY', 'CLIENTE', 'SKU', 'DESCRICAO', 'TIPO', 'QTD', 'QTD_NFS', 'ULTIMA_OCORRENCIA', 'ORIGEM']
};

var NUMCOLS = ['ETAPA', 'QTD', 'SALDO', 'QTD_FINAL', 'DIFERENCA', 'TENTATIVAS', 'BLOQUEADO_ATE', 'RESERVADO_ATE', 'TOTAL_UNIDADES',
  'TOTAL_POSICOES', 'PROGRESSO', 'VALOR_UNIT', 'LOTES', 'SALDO_CLIENTE', 'SALDO_FISCAL', 'SALDO_FISICO', 'QTD_NFS', 'VERSAO', 'EPOCH',
  'REG_ARM', 'REG_CF', 'REG_BASE', 'REJ_ARM', 'REJ_CF', 'REJ_BASE'];

var Schema = {
  cols: function (tab) {
    if (SCHEMA[tab]) return SCHEMA[tab];
    var m = /^(ARM|CF|BASE)_V\d+$/.exec(tab);
    if (m) return VSCHEMA[m[1]];
    throw new Error('Aba desconhecida: ' + tab);
  },
  versionTab: function (tipo, versao) { return tipo + '_' + versao; }
};

var PERFIS = ['ADMINISTRADOR', 'GESTOR', 'SUPERVISOR', 'OPERADOR', 'AUDITOR', 'ANALISTA'];

var MENSAGENS_PADRAO = {
  OK: 'Contagem finalizada e bateu com o sistema.',
  FALTA: 'Sua contagem se refere a uma falta.',
  SOBRA: 'Sua contagem se refere a uma sobra.',
  DIVERGENCIA: 'Sua contagem foi finalizada com divergência.',
  REGISTRADA: 'Contagem registrada.',
  INCLUSAO: 'Produto não cadastrado nesta posição. Inclusão identificada.',
  ARQUIVO_NAO_RECONHECIDO: 'Arquivo não reconhecido. Verifique se o nome está exatamente igual ao relatório oficial esperado.'
};

var CONFIG_PADRAO = {
  VERSAO_ATIVA: '',
  CONTADOR_VERSAO: '0',
  VERSOES_MANTIDAS: '3',
  RESERVA_MINUTOS: '30',
  POLITICA_ATUALIZACAO: 'TRES_ARQUIVOS',
  REJEICAO_MAX_PERCENT: '1',
  APROVACAO_VALOR_MIN: '0',
  ARQUIVO_ARM: 'armazenado.xls',
  ARQUIVO_CF: 'cliente_fiscal.xls',
  ARQUIVO_BASE: 'base.xls',
  ABA_ARM: 'armazenagem',
  ABA_CF: 'cliente',
  ABA_BASE: 'base',
  // Layout esperado (cabeçalhos obrigatórios) de cada relatório — editável pelo administrador.
  LAYOUT_ARM: JSON.stringify(['id_posicao', 'galpao_en', 'Divito_Verificador', 'Ficticio', 'cod_cli', 'Codigo', 'descricao', 'Familia', 'Qtde', 'cod_it_cli', 'VALOR UNITARIO MEDIO']),
  LAYOUT_CF: JSON.stringify(['CLIENTE', 'SKU', 'DESCRIÇÃO', 'SALDO CLIENTE', 'SALDO BOLSAO FISCAL', 'SALDO FISICO', 'DEPTO', 'GRUPO', 'DAT VALIDADE CAMPANHA', 'VALOR UNIT']),
  LAYOUT_BASE: JSON.stringify(['Cliente', 'Item', 'Descricao', 'Qtde', 'Depto', 'Numero NF', 'Data_Ocorrencia', 'Origem'])
};
