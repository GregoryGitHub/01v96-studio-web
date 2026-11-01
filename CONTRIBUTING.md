# Contribuindo com o 01V96 Studio Web

Que bom que você quer ajudar! 🎛️ Este guia explica como rodar o projeto, como ele está organizado e, principalmente, como adicionar suporte a outras mesas Yamaha.

## Regra de ouro 🔴

**Nunca teste escrita de parâmetros numa mesa que está em uso ao vivo.** Qualquer arrasto na interface altera a mesa de verdade. Para mexer na interface sem mesa, use o modo sandbox:

```bash
cd app
PORT=8097 MIDI_PORT=__nenhuma__ NO_SUPERVISOR=1 node server.js   # servidor sem MIDI
```

Quando precisar validar uma escrita na mesa, escolha um parâmetro inaudível (por exemplo, o mix do delay de um canal com o delay desligado) e restaure o valor original depois.

## Ambiente

```bash
git clone https://github.com/GregoryGitHub/01v96-studio-web.git
cd 01v96-studio-web/app
npm install
npm start            # http://localhost:8096
```

Não há etapa de build: o front-end é JavaScript puro com ES modules. Edite e recarregue a página. O service worker usa *network first*, então as mudanças aparecem na hora.

### Ferramentas úteis (`app/tools/`)

| Script | O que faz |
|---|---|
| `touch-test.js` | Arrasta faders, knobs, o gráfico de EQ e as barras do EQ gráfico com toques reais num Edge/Chrome headless (celular e tablet). Rode contra o sandbox, com `USERDATA` apontando para um arquivo temporário. |
| `sniff.js` | Envia pedidos de leitura pela conexão do servidor e mostra os quadros SysEx não reconhecidos. Use para investigar o protocolo. |
| `screenshots.js` | Gera as imagens do README a partir de um servidor rodando. |
| `pwa-check.js` | Confere service worker, instalabilidade e modo offline. |
| `make-icons.js` | Gera os ícones PNG/ICO sem dependências. |

## Estrutura

```
app/
  server.js          HTTP + WebSocket + supervisor (auto-restart)
  lib/protocol.js    SysEx Yamaha: encode/decode, bulk, meters
  lib/model.js       elementos/parâmetros da 01V96 e plano de sincronização
  lib/console.js     porta MIDI, fila com controle de fluxo, estado, cenas
  data/              tabelas extraídas por engenharia reversa
  public/js/
    store.js         estado no cliente + WebSocket (reconexão, heartbeat)
    controls.js      fader, knob, toggle: mouse, caneta e touch
    format.js        valor bruto → texto exibido (dB, Hz, ms…)
    model.js         faixas (CH, ST IN, AUX, BUS, STEREO) → endereços
    views/           mixer, channel, effects, scenes
docs/protocol.md     o protocolo documentado
re/scripts/          scripts de extração (PE, tabelas, enums, formatadores)
launcher/            atalho e start/stop no Windows
```

### Endereços

Todo parâmetro é um endereço `grupo:elemento:parâmetro:canal`, a mesma chave usada no estado do servidor, no WebSocket e no cliente (`S.key(g, e, p, c)`). O servidor não conhece a interface: ele só sincroniza endereços e repassa mudanças.

## Adicionando uma nova mesa

As mesas digitais Yamaha da geração 01V96 (02R96, DM1000, DM2000, LS9, M7CL, PM5D, 01V96i) usam o mesmo esquema de SysEx `F0 43 1n 3E <modelo> …` e Studio Managers com a mesma estrutura de tabelas. O caminho:

### 1. Descubra a porta e o modelo

Conecte a mesa e rode `re/scripts/probe.js`. Ele lista as portas e mostra as respostas. O byte de modelo aparece no handshake (`F0 43 10 3E <modelo> 7F F7`): `0D` = 01V96, `1A` = 01V96i, `12` = LS9, `11` = M7CL…

### 2. Extraia a tabela de parâmetros do Studio Manager

Você precisa da DLL do editor da sua mesa (por exemplo `DM1000.dll`), da sua própria instalação do Studio Manager. **Não faça commit da DLL.**

1. Rode `node re/scripts/strings.js <dll> 4 > strings.txt` e procure nomes como `kInputFader`, `kInputPhase`.
2. Ache o array de ponteiros que aponta para esses nomes (`node re/scripts/pe.js <dll> <offset da string>`) e ajuste a base em `eltable.js`/`dumpmap.js`.
3. Rode `dumpmap.js` para gerar o `elements.json` da mesa.
4. Para efeitos: `effects.js`, `enums.js` e `formatters.js`. Esses dois últimos usam a saída do Ghidra (via [REA](https://github.com/morluto/rea)) das funções de formatação. O [docs/protocol.md](docs/protocol.md) explica cada estrutura.

Os endereços mudam entre mesas, mas a forma das estruturas tende a se repetir. Documente no PR o que for diferente.

### 3. Valide na mesa

Com o modelo e o `elements.json` em mãos, confira leituras (só pedidos!) com `re/scripts/probe2.js` e `probe3.js` antes de escrever qualquer coisa.

### 4. Integre

Hoje o código assume a 01V96 em `lib/model.js`, `public/js/model.js` e no número de canais. O próximo passo do roadmap é mover isso para `app/consoles/<mesa>/` (definição de faixas, plano de sync, dados). Se você for a primeira pessoa a adicionar uma mesa, essa refatoração pode fazer parte do seu PR. Abra uma issue antes para combinarmos o formato.

## Padrões de código

- JavaScript puro, sem framework e sem build. Node ≥ 20.
- Comentários explicam o *porquê* (especialmente descobertas do protocolo), não o óbvio.
- Siga o estilo do arquivo que você está editando: 2 espaços, aspas simples, ponto e vírgula.
- Interface em português por enquanto; textos novos devem ficar fáceis de extrair para tradução.
- Toda funcionalidade de interface precisa funcionar com mouse **e** com touch. Rode `node tools/touch-test.js` antes do PR.

## Pull requests

1. Faça um fork e crie um branch descritivo (`feat/geq`, `fix/meter-scale`, `console/dm1000`).
2. Descreva **o que** mudou, **como** você testou (com ou sem mesa? qual modelo e firmware?) e inclua screenshots para mudanças visuais.
3. Descobertas de protocolo vão para `docs/protocol.md`, com a fonte (log de MIDI, função do Ghidra, endereço).
4. Mantenha o PR focado; PRs pequenos são revisados mais rápido.

## Engenharia reversa: limites

- Trabalhe só com software que você possui licença para usar.
- Não faça commit de binários, DLLs, instaladores ou código descompilado de terceiros.
- Tabelas de interoperabilidade (endereços, faixas, rótulos de parâmetros) são bem-vindas, sempre com a origem documentada.

Obrigado por ajudar a manter essas mesas clássicas vivas! 🎶
