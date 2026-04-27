# CtxPack: Empacotador de Contexto de Projeto

`ctxpack.py` é um script Python que compacta o código-fonte e a estrutura de um projeto inteiro em um único arquivo de texto amigável para LLMs. Isso permite colar facilmente todo o contexto de um projeto em uma janela de contexto grande de um modelo de linguagem ou agente.

## Recursos

- **Múltiplos Formatos**: Cria diferentes perfis (Semantic DSL por padrão `.sem.ctx.md`, Legível por Humanos `.ctx.md` com `--readable`, e arquivos de Token/Chunk `.tokens.ctx.md`).
- **Modo Semantic DSL**: AST semântico avançado e indexação de imports do seu projeto prontos para uso, com inferência heurística inteligente (estado, papel, convenções).
- **Árvore de Diretório**: Inclui uma árvore de diretórios ASCII para facilitar a navegação.
- **Filtragem & Exclusão Inteligentes**: Detecção automática da raiz e exclusões de categorias configuráveis (build, vendor, test, doc, etc.). Whitelist de extensões e exclusão de diretórios/arquivos específicos.
- **Remoção de Comentários**: Opção para remover comentários de linha única para economizar tokens.
- **Limites de Tamanho de Arquivo**: Ignora arquivos que sejam muito grandes.
- **Estimativa de Tokens**: Fornece uma estimativa aproximada da contagem de tokens.

## Uso

```text
uso: ctxpack.py [-h] [-o OUTPUT] [-e EXT [EXT ...]] [-x NAME [NAME ...]]
                  [--setup] [--strip-comments] [--no-tree]
                  [--max-lines N] [--summary] [--chunk]
                  [--chunk-size N] [--chunk-overlap N]
                  [--embed] [--embed-dim N] [--readable]
                  [--readable-output FILE] [--no-semantic]
                  [--no-semantic] [--no-semantic-only] [--now TEXT]
                  [--no-output FILE]
                  project_dir

ctxpack.py — Empacotador de Contexto para consumo por LLM/Agentes
Colapsa um projeto inteiro em um único ou em múltiplos arquivos .ctx.md.

argumentos posicionais:
  project_dir           Diretório raiz do projeto (ex.: . para o diretório atual)

opções:
  -h, --help            mostrar esta mensagem de ajuda e sair
  -o, --output OUTPUT   Caminho do arquivo de saída para a saída de tokens (padrão:
                        <project_name>.tokens.ctx.md se chunk/embed estiver habilitado)
  -e, --ext EXT [EXT ...]
                        Lista branca de extensões de arquivo (sem ponto)
  -x, --exclude NAME [NAME ...]
                        Nomes adicionais de diretórios ou arquivos a excluir
  --setup               Gerar um template .packignore no diretório atual e sair
  --strip-comments      Remover comentários de linha única (// e #) de arquivos fonte
  --no-tree             Omitir a seção de árvore de diretórios no arquivo de saída
  --max-lines N         Ignorar arquivos com mais de N linhas (padrão: 2000)
  --summary             Imprimir apenas o resumo de tokens/arquivos — não escrever o arquivo de saída
  --chunk               Dividir arquivos em trechos (chunks) por linhas para indexação
  --chunk-size N        Linhas por trecho quando --chunk estiver habilitado (padrão: 200)
  --chunk-overlap N     Linhas de sobreposição entre trechos consecutivos (padrão: 20)
  --embed               Calcular embeddings determinísticos para cada trecho
  --embed-dim N         Dimensão do vetor de embedding quando --embed estiver habilitado (padrão: 64)
  --readable            Gerar um arquivo de contexto completo legível por humanos (desativado por padrão)
  --readable-output FILE
                        Caminho para o arquivo de saída legível (padrão: <project_name>.ctx.md)

Saída do DSL semântico:
  --semantic            Gerar .sem.ctx.md com saída em DSL semântico (ativado por padrão)
  --no-semantic         Desabilitar a geração de .sem.ctx.md com saída em DSL semântico
  --semantic-only       Gerar apenas o arquivo .sem.ctx.md e sair
  --now TEXT            Definir manualmente o campo NOW (foco atual do projeto)
  --no-output FILE      Caminho para o arquivo DSL semântico (padrão: <project_name>.sem.ctx.md)
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

## Atualizar o próprio script

O CtxPack pode verificar o repositório canônico por atualizações e aplicá-las na instalação local.

- **Verificação automática:** Quando você executa `ctxpack.py`, ele fará uma checagem leve em segundo plano e mostrará um aviso curto se houver um commit mais recente no repositório canônico.
- **Aplicar atualizações:** Rode o comando de atualização para buscar e aplicar mudanças na sua cópia local:

```bash
python ctxpack.py --update
```

Se a sua instalação usa uma URL remota diferente, você pode sobrescrevê-la com `--remote-url`:

```bash
python ctxpack.py --update --remote-url git@github.com:seu/repo.git
```

## Como Funciona

O script percorre o diretório do projeto, filtra arquivos com base nos seus critérios e concatena-os em um único arquivo Markdown. O conteúdo de cada arquivo é colocado dentro de um bloco de código cercado por fences, tornando-o fácil de ser analisado por modelos de linguagem.

## Sistema de Plugins de Linguagem (Extensibilidade)

O CtxPack agora inclui um sistema de plugins de linguagem para detecção e extração de símbolos. Isso permite adicionar suporte a novas linguagens de programação sem modificar o código principal.

- Onde adicionar plugins: coloque um módulo em `analyzers/plugins/` que exponha uma fábrica de plugin `get_plugin()` (ou o símbolo `plugin`/`Plugin`). O pacote é descoberto automaticamente em tempo de execução.
- Interface do plugin: implemente a classe abstrata `LanguagePlugin` em `analyzers/language_plugin.py`. Partes requeridas:
  - `file_extensions() -> list[str]`: extensões tratadas pelo plugin (sem ponto).
  - `detect(content: str, path: Path) -> float`: pontuação heurística opcional (0.0-1.0) para desambiguação.
  - `extract_symbols(module, project_dir: Path) -> None`: popula `module.symbols` com entradas `SymbolNode`.

Exemplo: `analyzers/plugins/python_plugin.py` está incluído como implementação de referência que usa o `ast` do Python para extrair funções, classes e métodos.

Como a detecção funciona:
- O `SymbolExtractor` primeiro corresponde plugins pela extensão do arquivo. Se múltiplos plugins registrarem a mesma extensão, ele chama `detect()` em cada um para escolher o plugin com maior pontuação.
- Se nenhum plugin registrar uma extensão, o extractor chamará `detect()` em todos os plugins disponíveis como fallback, permitindo detecção baseada no conteúdo para arquivos ambíguos.

Isso extrai semântica para outras linguagens?
- Resposta curta: sim — contanto que um plugin implemente a lógica de extração para a linguagem alvo.

Detalhes e limitações:
- O núcleo fornece apenas a estrutura de plugins e a orquestração (descoberta, registro e seleção). A análise e extração semântica real devem ser implementadas por cada plugin.
- Para algumas linguagens (Python, Java, JavaScript, Rust, etc.) você pode escrever plugins robustos usando suas bibliotecas de AST/parse. Para outras sem um parser adequado, uma abordagem heurística ou baseada em regex ainda pode extrair símbolos úteis, porém com menos precisão.
- Desempenho: parsing custoso deve ser implementado com cuidado (streaming, saídas antecipadas), pois o ctxpack é pensado para rodar em máquinas de desenvolvedor.
- Segurança: o código dos plugins roda no mesmo processo; evite executar código não confiável durante detecção/extração.

Adicionar um novo plugin de linguagem (passos rápidos):
1. Crie `analyzers/plugins/<lang>_plugin.py`.
2. Implemente uma classe que herde `LanguagePlugin` e implemente `file_extensions`, `detect` e `extract_symbols`.
3. Forneça `get_plugin()` que retorne uma instância do seu plugin.
4. Rode `python ctxpack.py <project_dir>` — o plugin será descoberto automaticamente.

Se quiser, posso adicionar templates para plugins C/C++ e Java, ou documentar padrões comuns para construir detectores e parsers robustos.

## Licença

Este projeto é licenciado sob a [MIT License](LICENSE). Veja o arquivo LICENSE para mais detalhes.
