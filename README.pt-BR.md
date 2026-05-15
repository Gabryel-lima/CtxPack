# CtxPack: Empacotador de Contexto de Projeto

`ctxpack.py` é um script Python que compacta o código-fonte e a estrutura de um projeto inteiro em um único arquivo de texto amigável para LLMs. Isso permite colar facilmente todo o contexto de um projeto em uma janela de contexto grande de um modelo de linguagem ou agente.

## Recursos

- **Múltiplos Formatos**: Cria diferentes perfis (Semantic DSL por padrão `.sem.ctx.md`, Legível por Humanos `.ctx.md` com `--readable`, e arquivos de Token/Chunk `.tokens.ctx.md`).
- **Modo Semantic DSL**: Extração semântica estrutural com analisadores em Python puro, indexação de imports/relações e inferência inteligente de estado, papel, convenções e contexto quando faltam metadados explícitos.
- **Árvore de Diretório**: Inclui uma árvore de diretórios ASCII para facilitar a navegação.
- **Filtragem & Exclusão Inteligentes**: Detecção automática da raiz e exclusões de categorias configuráveis (build, vendor, test, doc, etc.). Whitelist de extensões e exclusão de diretórios/arquivos específicos.
- **Remoção de Comentários**: Opção para remover comentários de linha única para economizar tokens.
- **Limites de Tamanho de Arquivo**: Ignora arquivos que sejam muito grandes.
- **Estimativa de Tokens**: Fornece uma estimativa aproximada da contagem de tokens.
- **Extração Polyglot**: Suporte semântico embutido para Python, JavaScript, TypeScript, Rust, Go, Java, Kotlin, C, C++, C#, PHP, Ruby, Lua, Swift, Dart, Shell e mais via plugins.
- **Fallback para Metadados**: Se tags como `@role`, `@state` ou `@ctx` não existirem, o CtxPack infere contexto útil a partir de comentários, símbolos, nomes de arquivo e estrutura do código.

## Uso

```text
uso: ctxpack.py [-h] [-o OUTPUT] [-e EXT [EXT ...]] [-x NAME [NAME ...]]
                  [--setup] [--strip-comments] [--no-tree]
                  [--max-lines MAX_LINES] [--summary] [--chunk]
                  [--chunk-size CHUNK_SIZE] [--chunk-overlap CHUNK_OVERLAP]
                  [--embed] [--embed-dim EMBED_DIM] [--readable]
                  [--readable-output READABLE_OUTPUT] [--update]
                  [--remote-url REMOTE_URL] [--semantic] [--no-semantic]
                  [--semantic-only] [--now TEXT] [--no-output FILE]
                  [project_dir]

ctxpack — Colapsa um projeto em um arquivo de contexto pronto para LLM.

argumentos posicionais:
  project_dir           Diretório raiz do projeto (ex.: ./path ou
                        ../path). O caminho deve ser informado.

opções:
  -h, --help            mostrar esta mensagem de ajuda e sair
  -o OUTPUT, --output OUTPUT
                        Caminho do arquivo de saída para tokens (padrão:
                        <project_name>.tokens.ctx.md se --chunk/--embed
                        estiver habilitado)
  -e EXT [EXT ...], --ext EXT [EXT ...]
                        Lista branca de extensões (sem ponto). Se omitida,
                        usa o conjunto padrão embutido.
  -x NAME [NAME ...], --exclude NAME [NAME ...]
                        Nomes adicionais de arquivos ou diretórios a excluir.
  --setup               Gera um template .packignore no diretório atual e sai.
  --strip-comments      Remove comentários de linha única (// e #) dos arquivos
                        fonte.
  --no-tree             Omite a seção de árvore de diretórios na saída.
  --max-lines MAX_LINES
                        Ignora arquivos com mais de N linhas (padrão: 2000).
  --summary             Imprime apenas o resumo de arquivos/tokens e não grava
                        o arquivo de saída.
  --chunk               Divide arquivos em chunks por linhas para indexação.
  --chunk-size CHUNK_SIZE
                        Linhas por chunk quando --chunk estiver habilitado
                        (padrão: 200).
  --chunk-overlap CHUNK_OVERLAP
                        Sobreposição de linhas entre chunks consecutivos
                        (padrão: 20).
  --embed               Calcula embeddings determinísticos para cada chunk
                        usando Python puro.
  --embed-dim EMBED_DIM
                        Dimensão do vetor de embedding quando --embed estiver
                        habilitado (padrão: 64).
  --readable            Também gera um arquivo completo legível por humanos
                        (desabilitado por padrão).
  --readable-output READABLE_OUTPUT
                        Caminho do arquivo legível (padrão:
                        <project_name>.ctx.md).
  --update              Busca e aplica atualizações do repositório canônico
                        (git@github.com:Gabryel-lima/CtxPack.git).
  --remote-url REMOTE_URL
                        Sobrescreve a URL remota usada por --update.

saída do DSL semântico:
  --semantic            Gera .sem.ctx.md com a saída semântica
                        (habilitado por padrão)
  --no-semantic         Desabilita a geração do .sem.ctx.md
  --semantic-only       Gera apenas o .sem.ctx.md, omitindo o .ctx.md padrão
  --now TEXT            Define manualmente o campo NOW (foco atual do projeto)
  --no-output FILE      Caminho para o arquivo semântico (padrão:
                        <project_name>.sem.ctx.md)
```

## Exemplos

* Primeiro, gere um template `.packignore` no diretório do seu projeto para especificar quais arquivos/diretórios devem ser excluídos:
```bash
python ctxpack.py --setup
```

**Formatos de caminho**

CtxPack aceita estilos de caminho tanto Unix quanto Windows. Exemplos que funcionam em ambas as plataformas:

- Diretório atual: `.`
- Caminho relativo: `../myproject`
- Absoluto Unix: `/home/user/projects/myproj`
- Absoluto Windows (barra para frente): `C:/Users/You/Projects/MyProj`
- Absoluto Windows (barra invertida): `C:\\Users\\You\\Projects\\MyProj`

---

**Empacote o diretório atual:**
```bash
python ctxpack.py .
```

**Empacote um projeto específico (`./AlmaOS`) e salve em um arquivo personalizado:**
```bash
python ctxpack.py ./AlmaOS -o AlmaOS_context.md
```

**Empacote um projeto com extensões de arquivo específicas e remova comentários:**
```bash
python ctxpack.py ./MyProject -e c h asm --strip-comments
```

**Exemplo empacotando um caminho no estilo Windows:**
```bash
python ctxpack.py "C:\\Users\\You\\Projects\\MyProject" -o MyProject_context.md
```

**Empacote um projeto gráfico, limitando o tamanho dos arquivos e especificando um arquivo de saída:**
```bash
python ctxpack.py ./gfx -e c h --max-lines 500 -o gfx_context.ctx.md
```

**Rode os fixtures polyglot embutidos:**
```bash
python3 ctxpack.py tests/prototypes --semantic-only --no-output tests/prototypes/prototypes.sem.ctx.md
```

**Rode a suíte completa de smoke tests:**
```bash
python3 tests/run_smoke.py
```

## Extensão VS Code (Context Cache)

O CtxPack inclui uma extensão VS Code em [vscode-extension/README.md](vscode-extension/README.md) que mantém um buffer de contexto em memória de sessão e expõe o participante de chat `@ctx`.

A divisão de responsabilidade é intencional:

- A extensão serve para contexto local, específico e orientado ao chat dentro do VS Code.
- O script Python serve para exportar o projeto inteiro em formatos semântico e legível.
- Agora a extensão gera os pacotes de projeto internamente, então esses comandos funcionam sem Python e sem um `ctxpack.py` local.

Referência visual rápida do fluxo: veja a imagem em [vscode-extension/README.md](vscode-extension/README.md).

Comportamento importante:

- `@ctx` não coleta arquivos sozinho.
- `@ctx` injeta no prompt apenas o que já está no buffer.
- O buffer só muda quando você faz push, remove slots, ou limpa a sessão.
- Agora é possível manter o `@ctx` fixado em um subconjunto específico de slots ao longo de várias iterações.
- `@ctx` não deve ser usado por padrão em todo prompt.

### Quando usar `@ctx`

Use `@ctx` quando a resposta depender de contexto já preparado no buffer, por exemplo:

- a seleção ou o arquivo que você acabou de enviar
- vários trechos acumulados para a mesma tarefa
- um resumo semântico do workspace gerado pelo CtxPack
- contexto específico do repositório que você não quer colar manualmente

Evite `@ctx` quando:

- a pergunta for genérica
- o buffer ainda estiver carregando contexto de outra tarefa
- você quiser uma resposta limpa, sem hipóteses extras baseadas em contexto antigo

Regra prática: se o contexto muda materialmente a resposta, use `@ctx`; se só vai adicionar ruído, não use.

O `@ctx` agora funciona em dois modos:

- modo buffer completo: injeta todos os slots armazenados
- modo slots ativos: injeta apenas os slots escolhidos pelo usuário, e reaproveita esse mesmo subconjunto em cada nova iteração até que ele seja alterado

### Fluxo recomendado de uso

1. Decida se você precisa de um trecho local ou de um panorama do projeto.
2. Para trabalho local, faça push da seleção ou do arquivo.
3. Para contexto do workspace inteiro, rode `CtxPack: Generate semantic pack and push to buffer`.
4. Se quiser que a IA enxergue apenas um arquivo, diretório, ou grupo específico de slots em toda iteração, rode `CtxPack: Choose active slots for @ctx`.
5. Inspecione ou remova slots antigos se necessário.
6. Use `@ctx` no Copilot Chat somente depois que o buffer e o escopo ativo refletirem a tarefa atual.
7. Ao trocar de assunto/tarefa, limpe com `ctxpack.clear` ou remova o filtro ativo.

### Comandos da extensão

### Como abrir o painel de comandos do VS Code

Para executar os comandos do CtxPack dentro do VS Code:

1. Abra a Paleta de Comandos com `Ctrl+Shift+P` no Linux/Windows ou `Cmd+Shift+P` no macOS.
2. Digite `CtxPack`.
3. Escolha o comando desejado.

Se quiser um ponto de entrada guiado, execute `CtxPack: Open context workflow wizard` nessa mesma paleta.

- `ctxpack.push`: envia a seleção, ou o arquivo inteiro se não houver seleção.
- `ctxpack.pushFile`: envia o arquivo ativo inteiro.
- `ctxpack.pushPath`: envia um arquivo ou diretório como um slot reutilizável. Também pode ser acionado pelo menu de contexto do Explorer.
- `ctxpack.status`: inspeciona os slots armazenados e o uso estimado de tokens.
- `ctxpack.selectActiveSlots`: escolhe quais slots ficam ativos para o `@ctx` em todas as iterações seguintes.
- `ctxpack.clearActiveSelection`: volta o `@ctx` para o modo de buffer completo.
- `ctxpack.slotScopeStatus`: mostra qual é o escopo atual que o `@ctx` vai injetar.
- `ctxpack.inspectSlot`: abre uma prévia de um slot antes de usar `@ctx`.
- `ctxpack.removeSlot`: remove um slot antigo sem limpar o buffer inteiro.
- `ctxpack.clear`: limpa o buffer da sessão atual.
- `ctxpack.exportSemantic`: gera `<workspace>.sem.ctx.md` dentro da extensão.
- `ctxpack.exportReadable`: gera `<workspace>.ctx.md` dentro da extensão.
- `ctxpack.pushWorkspaceSemantic`: gera um pacote semântico do projeto e envia o resultado ao buffer via IPC.
- `ctxpack.createPackignore`: gera um template `.packignore` dentro da extensão.
- `ctxpack.wizard`: abre um menu único com os principais fluxos de push, escopo, exportação e limpeza.

### Atalhos pelo Explorer

Também é possível usar o CtxPack diretamente no Explorer do VS Code:

- clique com o botão direito em um arquivo e use `CtxPack: Push this file to buffer`
- clique com o botão direito em uma pasta e use `CtxPack: Push this folder to buffer`

Isso é útil quando você quer que o `@ctx` fique preso a um caminho específico sem precisar abrir o arquivo antes.

### Requisitos para os comandos de projeto

Os comandos de projeto agora rodam dentro da própria extensão.

- Abra a pasta do workspace no VS Code.
- Garanta que a extensão possa ler os arquivos relevantes desse workspace.

### IPC do CLI para a extensão

Use as flags de push para alimentar o buffer da extensão diretamente pelo terminal:

```bash
python3 ctxpack.py . --semantic --push --push-tag estado-atual
```

Se o workspace alvo for diferente do diretório usado no terminal:

```bash
python3 ctxpack.py . --semantic --push --push-workspace /caminho/do/workspace
```

Os novos comandos da extensão apenas deixam esse mesmo fluxo mais acessível dentro do VS Code.

### Instalar a extensão (duas formas)

#### 1) Instalar por VSIX (recomendado para uso diário)

No diretório da extensão:

```bash
cd vscode-extension
npm install
npm run compile
npm test
npm run package
code --install-extension ctxpack-context-0.1.3.vsix
```

Também é possível instalar pela interface do VS Code: Extensões -> menu `...` -> Install from VSIX...

#### 2) Executar pela fonte (recomendado para desenvolvimento)

1. Abra a pasta `vscode-extension` no VS Code.
2. Rode `npm install` e `npm run compile`.
3. Pressione `F5` para abrir um Extension Development Host.
4. Teste os comandos e o participante `@ctx` nessa janela.

### Gerar VSIX

```bash
cd vscode-extension
npm install
npm run compile
npm test
npm run package
```

Isso gera o arquivo `ctxpack-context-0.1.3.vsix`.

### Dúvidas comuns

1. Preciso começar todo prompt com `@ctx`?
  Não. Só use `@ctx` nos prompts que precisam do contexto acumulado.
2. O contexto atualiza sozinho a cada prompt?
  Não. Faça novo push sempre que quiser refletir mudanças recentes.
3. O buffer fica salvo para sempre?
  Não. É memória de sessão e pode ser limpa com `ctxpack.clear`.
4. O que acontece se o limite de tokens for atingido?
  O buffer aplica FIFO e remove entradas antigas primeiro.
5. Como envio o contexto semântico do projeto inteiro para o chat sem fazer push arquivo por arquivo?
  Rode `CtxPack: Generate semantic pack and push to buffer` e depois use `@ctx`.
6. Como exporto contexto para outra LLM em vez de usar só o chat do Copilot?
  Rode `CtxPack: Generate semantic project pack` ou `CtxPack: Generate readable project pack`.
7. Como garantir que a IA enxergue sempre só um arquivo, um diretório, ou alguns slots específicos em cada iteração?
  Faça push desse conteúdo e depois use `CtxPack: Choose active slots for @ctx`.

## Atualizar o próprio script

O CtxPack pode verificar o repositório canônico por atualizações e aplicá-las na instalação local.

- **Verificação automática:** Quando você executa `ctxpack.py`, ele fará uma checagem leve em segundo plano e mostrará um aviso curto se houver um commit mais recente no repositório canônico.
- **Aplicar atualizações:** Rode o comando de atualização para buscar e aplicar mudanças na sua cópia local:

```bash
python ctxpack.py --update
```

Se a sua instalação usa uma URL remota diferente, você pode sobrescrevê-la com `--remote-url`:

```bash
python ctxpack.py --update --remote-url git@github.com:Gabryel-lima/CtxPack.git
```

## Como Funciona

O script percorre o diretório do projeto, filtra arquivos com base nos seus critérios e concatena-os em um único arquivo Markdown. O conteúdo de cada arquivo é colocado dentro de um bloco de código cercado por fences, tornando-o fácil de ser analisado por modelos de linguagem.

Na saída semântica, o CtxPack combina múltiplos analisadores: detecção de linguagem, extração de dependências, mapeamento de módulos, inferência de relações, extração de símbolos e enriquecimento de metadados/contexto. Quando tags explícitas não existem, ele deriva contexto a partir de comentários iniciais, estrutura de símbolos, nomes de arquivo e heurísticas do projeto.

## Extração Semântica Embutida

O CtxPack já vem com duas estratégias de extração:

- `analyzers/plugins/python_plugin.py`: usa o `ast` embutido do Python para extrair funções, classes e métodos Python com precisão.
- `analyzers/plugins/polyglot_plugin.py`: usa um parser estrutural em Python puro para cobrir várias linguagens sem dependências externas.

O extrator polyglot embutido cobre atualmente:

- JavaScript / JSX / MJS
- TypeScript / TSX
- Rust
- Go
- Java
- Kotlin
- C / C++
- C#
- PHP
- Ruby
- Lua
- Swift
- Dart
- Shell (`sh`, `bash`)

## Sistema de Plugins de Linguagem (Extensibilidade)

O CtxPack agora inclui um sistema de plugins de linguagem para detecção e extração de símbolos. Isso permite adicionar suporte a novas linguagens de programação sem modificar o código principal.

- Onde adicionar plugins: coloque um módulo em `analyzers/plugins/` que exponha uma fábrica de plugin `get_plugin()` (ou o símbolo `plugin`/`Plugin`). O pacote é descoberto automaticamente em tempo de execução.
- Interface do plugin: implemente a classe abstrata `LanguagePlugin` em `analyzers/language_plugin.py`. Partes requeridas:
  - `file_extensions() -> list[str]`: extensões tratadas pelo plugin (sem ponto).
  - `detect(content: str, path: Path) -> float`: pontuação heurística opcional (0.0-1.0) para desambiguação.
  - `extract_symbols(module, project_dir: Path) -> None`: popula `module.symbols` com entradas `SymbolNode`.

Exemplos:

- `analyzers/plugins/python_plugin.py` usa o `ast` embutido do Python para código Python.
- `analyzers/plugins/polyglot_plugin.py` usa um parser estrutural em Python puro para cobrir várias linguagens não-Python sem dependências externas.

Como a detecção funciona:
- O `SymbolExtractor` primeiro corresponde plugins pela extensão do arquivo. Se múltiplos plugins registrarem a mesma extensão, ele chama `detect()` em cada um para escolher o plugin com maior pontuação.
- Se nenhum plugin registrar uma extensão, o extractor chamará `detect()` em todos os plugins disponíveis como fallback, permitindo detecção baseada no conteúdo para arquivos ambíguos.

Isso extrai semântica para outras linguagens?
- Resposta curta: sim — contanto que um plugin implemente a lógica de extração para a linguagem alvo.

Detalhes e limitações:
- O núcleo fornece a orquestração dos plugins e já inclui extratores Python e polyglot, mas a precisão ainda depende da implementação específica de cada linguagem.
- O extrator polyglot embutido é intencionalmente dependency-free e usa parsing estrutural com heurísticas, não parsers de compilador completos. Em linguagens muito dinâmicas ou com muitos macros, alguns casos ainda podem ser aproximados.
- Desempenho: o parsing deve continuar leve, pois o ctxpack é pensado para rodar em máquinas de desenvolvedor.
- Segurança: o código dos plugins roda no mesmo processo; evite executar código não confiável durante detecção/extração.

Adicionar um novo plugin de linguagem (passos rápidos):
1. Crie `analyzers/plugins/<lang>_plugin.py`.
2. Implemente uma classe que herde `LanguagePlugin` e implemente `file_extensions`, `detect` e `extract_symbols`.
3. Forneça `get_plugin()` que retorne uma instância do seu plugin.
4. Rode `python ctxpack.py <project_dir>` — o plugin será descoberto automaticamente.

Se quiser, posso adicionar templates para plugins C/C++ e Java, ou documentar padrões comuns para construir detectores e parsers robustos.

## Fixtures de Validação

O repositório inclui uma suíte de smoke tests semânticos em `tests/prototypes/`. São arquivos pequenos de várias linguagens usados para validar qualidade de extração e detecção de relações entre módulos.

Comando típico de validação:

```bash
python3 tests/run_smoke.py
```

## Licença

Este projeto é licenciado sob a [MIT License](LICENSE). Veja o arquivo LICENSE para mais detalhes.
