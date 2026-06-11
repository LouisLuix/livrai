# LIVRAI — Estúdio

**Organizador visual de entregas para quem dirige criação.**

Quem dirige criação vive com o trabalho espalhado: referências numa pasta, roteiros em notas soltas, datas de postagem na cabeça e entregas de cada cliente em dez lugares diferentes. O LIVRAI junta tudo isso num lugar só — um estúdio visual onde cada projeto é um canvas vivo, com fases de entrega, cronograma de posts, identidade de marca e geração por IA trabalhando dentro do seu processo, e não contra ele.

**Tudo roda no seu computador.** Sem conta, sem nuvem obrigatória, sem mensalidade.

## Funcionalidades

- **Universo** — galeria 3D em 360°: seus projetos numa parede cilíndrica com busca, filtro por época e zoom de câmera
- **Grade e Kanban** — visões clássicas com filtros por fase e cliente, seleção em massa, arquivamento
- **Canvas infinito** por projeto: notas, imagens, vídeos, links, cores, pranchas (16:9, 9:16, 1:1, 4:5, A4) e posts com data e status
- **Notas** — páginas e blocos estilo Notion dentro de cada projeto
- **Marca & Produto** — logo, cores, fontes, diretrizes e referências vivas que alimentam a IA
- **Cronograma** — calendário mensal de posts com drag pra remarcar
- **Geração por IA** — imagem (Gemini, GPT, Seedream), texto (Claude, GPT, Gemini), vídeo (Veo 3, Kling, Seedance via fal.ai) e áudio (ElevenLabs), sempre com a sua identidade criativa
- **Photoshop** — salvar, abrir e sincronizar de volta automaticamente
- **Exportação** — pranchas em PNG ou apresentação HTML num arquivo único
- **Pasta do Estúdio** — salvamento automático num arquivo da sua pasta; aponte o navegador e o aplicativo pra mesma pasta e os dois mostram os mesmos projetos

## Como usar

### No navegador (recomendado: Chrome)

Dê dois cliques em **`ABRIR ESTUDIO.command`** (macOS) — ele liga as pontes locais (Photoshop e proxy da OpenAI) e abre o app. Ou simplesmente abra o `index.html`.

### Como aplicativo

- **macOS**: `desktop/dist/Livrai-darwin-arm64/Livrai.app`
- **Windows**: instalador em `INSTALADORES/` (gere uma versão nova com `GERAR INSTALADOR WINDOWS.command`)

### Chaves de IA (opcional)

Em **Configurações → IA & Identidade**, cole as chaves dos provedores que quiser usar (Anthropic, OpenAI, Google, ElevenLabs, fal.ai). Elas ficam salvas só no seu computador.

## Stack

Vanilla JavaScript, zero build, zero dependências de runtime. HTML + CSS + JS puros, persistência em IndexedDB, File System Access API pra integração com o sistema de arquivos. A versão desktop empacota o mesmo código com Electron.

```
index.html      → shell do app
css/styles.css  → sistema visual "Ateliê Editorial"
js/             → módulos (canvas, galeria, universo, kanban, notas, IA, sync…)
desktop/        → empacotamento Electron (macOS/Windows)
```

## Licença

[MIT](LICENSE) — use, estude, modifique e redistribua livremente.

Criado e desenvolvido por **Luis Gustavo Felix** ([@luisluix](https://instagram.com/luisluix))
