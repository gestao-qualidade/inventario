# Inventário Logístico — Google Planilhas + Apps Script + Vercel

Aplicativo exclusivo de inventário: contagem cega 1ª/2ª/3ª, regras fiscais/cliente, check de posição,
Central de Atualização das Bases (3 relatórios Excel) e painel por inventário.
**O Google Planilhas é a única base de dados.**

```
Navegador ──► Vercel (Next.js) ──► /api/rpc (servidor, cookie de sessão) ──► Apps Script (Web App) ──► Google Planilhas
                                    segredo e URL só no servidor              trava de concorrência, regras
```

* O navegador **nunca** vê a URL do Apps Script nem o segredo. Ele só fala com `/api/rpc`.
* Perfil e permissões são conferidos **no Apps Script a cada chamada**, lendo a aba USUARIOS (o cliente não define perfil).
* Senhas: hash SHA‑256 salgado com 1.000 iterações; nada em texto aberto. 5 erros bloqueiam o login por 15 min.

---

## Passo a passo de implantação (≈ 20 minutos)

### 1) Criar a planilha e instalar o backend

1. Em <https://sheets.new> crie uma planilha em branco e dê o nome **Inventário Logístico – Base**.
2. Menu **Extensões → Apps Script**. Apague o conteúdo padrão.
3. Para **cada arquivo** da pasta `apps-script/` (Schema, Util, Db, Auth, Regras, RegrasSeed, Importacao, Inventario, Contagem, Code):
   clique em **+ → Script**, nomeie igual (sem `.gs`) e cole o conteúdo.
   > A ordem não importa. O arquivo padrão `Código.gs` pode ser apagado depois que `Code` existir.
4. No topo escolha a função **`setupInicial`** e clique em **Executar**. Autorize o acesso quando o Google pedir.
5. Abra **Execuções → setupInicial → Registro**. Copie:
   * `API_SECRET` (será o `APPS_SCRIPT_SECRET` da Vercel);
   * usuário **admin** e a **senha inicial** (a troca é exigida no primeiro acesso).

### 2) Publicar o backend como Web App

1. **Implantar → Nova implantação → Tipo: App da Web**.
2. *Executar como*: **Eu**. *Quem pode acessar*: **Qualquer pessoa**.
   (A proteção é o segredo da API; sem ele, toda chamada é recusada.)
3. Copie a **URL** que termina em `/exec` (será o `APPS_SCRIPT_URL`).

> Sempre que alterar o código do Apps Script: **Implantar → Gerenciar implantações → ✏️ → Nova versão**.

### 3) Publicar o front na Vercel

1. Suba a pasta `web/` para um repositório no GitHub (a raiz do repositório = conteúdo de `web/`; ou, num monorepo, defina **Root Directory = `web`** na Vercel).
2. Na Vercel: **Add New → Project →** escolha o repositório. Framework: Next.js (automático).
3. Em **Environment Variables** crie:

| Nome | Valor |
|---|---|
| `APPS_SCRIPT_URL` | URL `/exec` do passo 2 |
| `APPS_SCRIPT_SECRET` | `API_SECRET` do passo 1 |
| `SESSION_SECRET` | texto aleatório longo (ex.: `openssl rand -base64 32`) |

4. **Deploy**. Abra o endereço, entre com `admin` + senha inicial e defina a nova senha.

### 4) Primeiro uso (ordem recomendada)

1. **Usuários**: crie Gestor, Analista, Supervisor, Operadores…
2. **Configurações**: confira nome/aba/colunas esperados dos 3 arquivos (já vêm com `armazenado.xls`, `cliente_fiscal.xls`, `base.xls`).
3. **Atualização das bases** (Analista/Admin): envie os 3 relatórios → *Gerar prévia* → confirmar e publicar.
4. **Inventários** (Gestor/Admin): *Novo inventário* → escolher clientes/ruas/curva → criar e publicar.
5. **Contagem** (Operador): escolher inventário → tocar na posição → bipar a posição → bipar SKU + quantidade.

---

## Como a confiabilidade da contagem é garantida

| Risco | Proteção |
|---|---|
| Dois operadores pegarem a mesma tarefa | Toda escrita crítica roda dentro de `LockService.getScriptLock()` (uma por vez). O 2º operador encontra a unidade já `RESERVADO` e não a recebe. |
| Lançamento duplicado / perdido | `CONTAGENS` é **append‑only** (ID único). A unidade só avança de etapa dentro da trava; reenviar o mesmo SKU depois de contado é recusado. |
| Mesmo operador contar de novo | A fila guarda `C1_OP/C2_OP/C3_OP`; quem já contou a unidade não a recebe em nenhuma etapa. |
| Operador ver saldo/etapa | O backend nunca devolve saldo, etapa nem resultado anterior nas rotas de contagem. A lista de posições é neutra. |
| Tarefa abandonada | Reserva expira (padrão 30 min). Gatilho a cada 10 min + checagem na hora de assumir liberam a posição. |
| Base alterada no meio do inventário | A base é **copiada** (fotografia) para `BASE_INVENTARIO` ao criar o inventário. Novas cargas não mexem em inventários existentes. |
| Carga mista de bases | Cada ciclo de carga é uma versão (`ARM_V0003`, `CF_V0003`, `BASE_V0003`). Publicar = trocar **um único ponteiro** (`VERSAO_ATIVA`). Falha no meio = nada muda. Restaurar = voltar o ponteiro. |
| Cache como fonte de verdade | Só o painel usa cache de 20 s; contagem e filas sempre leem a planilha. |

### Regra de decisão (função pura `decidirContagem`)

* 1ª: igual ao sistema → finaliza; senão → 2ª.
* 2ª (outro operador): igual ao sistema **ou** igual à 1ª → finaliza; senão → 3ª.
* 3ª (terceiro operador): **sempre definitiva**.

Mensagens ao operador (editáveis em *Configurações*): OK / FALTA / SOBRA / DIVERGÊNCIA (usada na 3ª contagem) e `REGISTRADA` (neutra, quando a unidade segue para a próxima etapa).

---

## Estrutura da planilha (criada pelo `setupInicial`)

`USUARIOS`, `INVENTARIOS`, `BASE_INVENTARIO`, `FILA_CONTAGENS`, `CONTAGENS`, `INCLUSOES`, `DIVERGENCIAS`, `CHECK_POSICAO`,
`REGRAS` (64 combinações da matriz oficial), `HISTORICO_REGRAS`, `MENSAGENS`, `AUDITORIA`, `CONFIGURACOES`,
`HISTORICO_IMPORTACOES` e, por versão de carga, `ARM_Vxxxx`, `CF_Vxxxx`, `BASE_Vxxxx`.

Clientes, produtos e posições (abas CLIENTES/PRODUTOS/POSICOES/ESTRUTURA_ARMAZEM da sugestão) são **derivados** das abas de versão `ARM_Vxxxx`
(cliente, SKU, posição, galpão/rua) — não há cópia paralela para não divergir.

## Como os 3 relatórios viram dados (conferido com os seus arquivos)

| Arquivo | Linhas lidas | Unidades gravadas | Regra de agregação |
|---|---|---|---|
| `armazenado.xls` (aba `armazenagem`) | 54.670 | 48.963 | soma `Qtde` por **posição + cliente + SKU** (lotes/entradas somados); curva ABC por valor em estoque (80/15/5) |
| `cliente_fiscal.xls` (aba `cliente`) | 34.880 | 21.757 | soma por **cliente + SKU** (uma linha por depto/canal); a linha de **totais** do final é ignorada |
| `base.xls` (aba `base`) | 2.087 | 1.293 | soma por **cliente + item + tipo** (FALTA / SOBRA / AVARIA) |

A leitura do Excel acontece no navegador (Web Worker, biblioteca SheetJS) e o backend revalida tudo.

## Regras: como cada campo da matriz é calculado

| Campo | Origem |
|---|---|
| Saldo Cliente | `SALDO CLIENTE` do cliente+SKU > 0 |
| Saldo Fiscal | `SALDO BOLSAO FISCAL` do cliente+SKU > 0 |
| Saldo Físico | quantidade final contada > 0 |
| É promocional? | `DAT VALIDADE CAMPANHA` preenchida |
| É produto? / Brinde? | `Familia` = PRODUTO / BRINDE no armazenado |
| Falta base? | existe linha **FALTA** do cliente+SKU no relatório de divergência base |

⚠️ **Confirme com a operação** os critérios de *promocional*, *produto/brinde* e *Saldo Fiscal* — foram deduzidos das colunas dos relatórios.
Na matriz enviada a ação só depende de Cliente/Fiscal (ambos = manter; um deles = armazenar e submeter ao atendimento; nenhum = descartar), então esses três critérios não alteram o resultado hoje.
Sem regra correspondente (ou regras conflitantes) a ação é **ENCAMINHAR PARA ANÁLISE ADMINISTRATIVA**.

## Limitações do Google Planilhas (e como são tratadas)

* **10 milhões de células por planilha.** Uma base completa ocupa ≈ 0,9 M células por versão e cada inventário geral ≈ 1,4 M (base + fila). Por isso só as 3 últimas versões são mantidas (configurável) e inventários encerrados devem ser arquivados (copiar abas para outra planilha) periodicamente.
* **Tempo de execução do Apps Script (6 min) e da Vercel (60 s).** Importação e criação de inventário trabalham em lotes de 1.500–3.000 linhas com nova tentativa automática e idempotência (`seq`/`offset`).
* **Sem transações.** Substituídas pela trava de script + gravação append‑only + ponteiro único de versão.
* **Cota de execuções do Apps Script.** O painel faz cache de 20 s e a fila é lida por coluna (não a aba inteira).
* **"Tempo real".** A lista de posições recarrega a cada 10 s e o painel a cada 30 s (atualização controlada, não *push*).

## Testes

```bash
node tests/run.js                 # 42 testes da lógica real (.gs) com banco em memória
node tools/testa-excel.js armazenado.xls cliente_fiscal.xls base.xls   # leitura dos seus Excel reais
node tools/mock-gas.js            # Apps Script simulado local (porta 8787) para testar o front sem Google
cd web && npm install && npm run build
```

Cobertura dos testes: 1ª igual ao sistema; 1ª diferente → 2ª; 2ª igual ao sistema; 2ª igual à 1ª; 3ª definitiva; operador não repete; operadores distintos;
reserva exclusiva; operador sem acesso a saldo/etapa; inclusões; matriz (64 combinações + duplicidade/conflito); indicadores; permissões; gravação append‑only;
recuperação de reservas vencidas; importação (nome, layout, incompleta, publicação, restauração); check de posição; auditoria.

> **O que os testes não cobrem:** a trava real do Google (`LockService`) e o desempenho com a planilha cheia só podem ser verificados no ambiente do Google.
> Faça um inventário‑piloto com 2–3 operadores simultâneos antes da operação.

## Novidades desta versão

* **Novo inventário inteligente**: filtros em cascata (galpão, rua, prateleira, coluna, altura, curva, código/SKU) — só aparecem opções que existem, com contagem de unidades ao vivo.
* **Lote e validade** (da base armazenado) em todos os inventários; **foto do produto** em todo lugar onde o código aparece (https://sil.pslogistica.com.br/imagens/CODIGO.JPG).
* **Mapa 3D** (somente Administrador/Gestor), no estilo de armazém real (estantes, corredores, paletes e caixas; caixa de papelão = ainda não inventariada): por posições ou por áreas, legenda clicável, clique na posição para ver dados e histórico, cobertura de posições únicas.
* **Agendar inventário** (início automático na data/hora, prazo previsto), **reagendar**, **iniciar agora**, **cancelar agendamento** e **excluir** (ativo/encerrado só o administrador, digitando o nome). Lista com filtro por status.
* **Check de posição** com inclusão e dois modos (só o administrador escolhe ao criar): com contagem (código + quantidade) ou só presença (marca se o código está lá).
* **Mapa 3D por galpão/rua**: painel de ruas com barra de status, filtros de colunas e alturas, busca de posição, visão do galpão inteiro; só desenha o que você escolhe. Respostas pesadas ficam em cache (mapa 60 s, painel 30 s, catálogo até a próxima base).
* **Cache no navegador**: as telas de consulta carregam uma vez e só buscam de novo ao clicar em Atualizar (ou ao gravar algo). Botão "Atualizar dados da tela" no menu.
* **Tela de Divergências**: fila única (divergências de contagem, check e inclusões de todos os inventários) com decisão do analista (7 opções + justificativa, responsável, prazo), fluxo Pendente → Em análise → Decidida → Executada → Fechada, aprovação opcional do Gestor por valor (Configurações), exportação em Excel e histórico completo.
* Visual novo com gradiente. Atualizando: recolar o código do Apps Script, rodar `setupInicial`, nova implantação, reenviar as 3 bases.

## Fora desta entrega (próxima fase, conforme a ordem de desenvolvimento)

* Relatórios exportáveis (Excel/CSV) além do relatório de erros da importação.
* Importação CSV (hoje a Central aceita `.xls/.xlsx`).
