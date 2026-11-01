# Protocolo SysEx da Yamaha 01V96 (engenharia reversa)

Este documento registra o que foi descoberto e **verificado na mesa real** (01V96 V2 via USB-MIDI, porta `Yamaha 01V96-1`).

## Fontes

| Fonte | Ferramenta | O que forneceu |
|---|---|---|
| `ref - airfader/AirFader.exe` (.NET) | REA `inspect-managed-members` + ILSpy | Formato das mensagens, handshake, medidores, cenas, nomes |
| `ref - airfader/AirControls.dll` (.NET) | ILSpy | Tabelas de exibição: fader→dB, freq/Q de EQ, ratio, hold, decay, knee |
| `ref - studio manager/01V96/01V96.dll` (nativo x86) | REA + Ghidra 12.1.4, parsing do PE | Tabela completa de elementos/parâmetros (416 elementos), catálogo de efeitos (61 tipos), faixas e formatação |

Os scripts usados ficam em `re/scripts/`.

## Formato das mensagens

```
mudança : F0 43 1n 3E <modelo> <grupo> <elem> <param> <canal> d0 d1 d2 d3 F7
pedido  : F0 43 3n 3E <modelo> <grupo> <elem> <param> <canal> F7
```

- `n` = device ID (0 = canal MIDI 1).
- Valor = inteiro de 28 bits em complemento de dois, em 4 bytes de 7 bits (`d0` mais significativo).
- **Grupo 1** (cena/canais) usa o modelo `7F`. Os outros grupos usam o modelo `0D` (01V96) ou `1A` (01V96i).
  - grupo 2: patch e nomes (`elem` = índice na tabela do Studio Manager − 0x69)
  - grupo 3: setup (`2D` = modo de cue, `2E` = cue por canal)
  - grupo 4: funções (`09` = canal selecionado, `0A` = cena atual)
- **Canal `7F` no pedido = todos os canais.** A resposta traz `10 + 4·N` bytes, um valor por canal. Isso reduz a sincronização completa de ~5.400 para ~300 pedidos.
- A mesa descarta pedidos "todos os canais" que chegam enquanto ela ainda está respondendo, por isso o servidor mantém no máximo 2 em voo.

## Numeração de canais (grupo 1)

| Faixa | Canais |
|---|---|
| Entradas | 0–31 = CH1–32, 32–39 = ST IN 1L…4R |
| AUX / BUS | 0–7 |
| Stereo | 0 (e 1 para R nos parâmetros espelhados) |
| Efeitos | 0–3 = FX1–FX4 |

## Elementos principais (grupo 1)

A tabela do Studio Manager fica em `.data:0x102ED150` (elemento 0 = `kInputPhase` − 0x17 entradas), com 8 bytes por entrada (`ponteiro do nome`, `ponteiro da sub-tabela`). Cada sub-tabela tem 12 bytes por entrada: `{nome, (param<<16)|(elem−1), contagem}`. O mapa completo está em `app/data/elements.json`.

| Elem | Nome | Parâmetros |
|---|---|---|
| 17 | kInputPhase | 0 |
| 19 | kInputInsert | 0 on |
| 1A | kInputChannelOn | 0 |
| 1B | kInputChannelPan | 0 (−63…63) |
| 1C | kInputFader | 0 (0…1023) |
| 1D | kInputAttenuator | 0 (−960…120, ×0,1 dB) |
| 1E | kInputGate | on, link, keyIn, keyAux, keyCh, type, attack, range, hold, decay, threshold |
| 1F | kInputComp | loc, on, link, type, attack, release, ratio, gain, knee, threshold |
| 20 | kInputEQ | mode, LowQ/F/G, HPF, LMidQ/F/G, HMidQ/F/G, HiQ/F/G, LPF, on |
| 21 | kInputDelay | on, mix, fb, time |
| 22 | kInputRouting | stereo, panLink, direct, bus1…8 |
| 23 | kInputAUX | AUXn: on = 3n, pre = 3n+1, level = 3n+2 |
| 24 | kInputAUXPan | pares 1-2, 3-4, 5-6, 7-8 |
| 26 | kInputGroup | fader A–H (0–7), mute I–P (8–15) |
| 27–33 | kBus… | pair, insert, on, balance, fader, att, comp, EQ, delay, toMatrix, toStereo, outGroup |
| 34–40 | kAUX… | idem, mais AUXType |
| 4B–56 | kStereo… | idem |
| 58 | kEffect | 0–15 título, 16–47 parâmetros, 48 mix, 49 type, 50 BPM, 51 mode, 52 bypass |
| 5C–5F | grupos master | fader/mute de entradas e saídas |

## Efeitos

- Os registros de tipo ficam em `0x1023A0C0`, com 23 bytes cada: `nome[16]`, `+0x11` id do algoritmo, `+0x12` número de parâmetros. Isso foi confirmado no Ghidra (`FUN_100ba780`).
- O mapa algoritmo × slot → descritor fica em `0x1023A6E0` (`u16[32]` por algoritmo).
- Os descritores ficam em `0x10237CD8`, com 24 bytes cada: `nome[8]`, `unidade[4]`, `max u32`, `offset s16`, `flags u16`, `curva u16`.
  - `flags & 7`: 0 = sem sinal, 1 = com sinal, 2/3 = string ou formatador, 5/6 = especiais. `flags & 8` = tabela numérica. `(flags >> 8) & 0xF` = casas decimais.
  - Valor exibido = `raw + offset`. A mesa troca o valor `raw` (0…max).
  - Valores maiores que `0x3FFF` ocupam **dois slots** de 14 bits (alto, baixo). Por isso "DELAY" aparece duas vezes.
- Os enums e formatadores vêm do switch em `FUN_100be6b0` (id da curva → tabela de strings de 7 bytes ou função de formatação).

## Outros

- **Medidores:** `F0 43 3n 3E 0D 21 <tipo> 00 00 00 01 F7`, onde tipo 0 = entradas, 1 = bus, 2 = aux, 4 = stereo, e `7F` para parar. A resposta tem palavras de 14 bits: entradas com 6 por canal, saídas com 4. Escala: `(v − 37) × 0,03117` → 0…127.
- **Cenas:** recall `F0 43 1n 3E 7F 10 00 hi lo 02 00 F7`, store `… 10 20 hi lo 02 00`, título `… 10 40 hi lo <16 chars>`.
- **Nomes:** grupo 2, elem `04` (canais 1–32), `17` (ST IN), `0F` (bus), `10` (aux), `12` (stereo). Os params 0–3 são os 4 caracteres ASCII.
