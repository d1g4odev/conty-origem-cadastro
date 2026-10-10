# Origem do cadastro

API (Fastify + TypeScript estrito) que decide de onde veio um cadastro: link de campanha, link de indicação ou orgânico. A resposta de cada cadastro lista todos os toques e explica por que cada um ganhou ou perdeu.

## Como rodar

```bash
npm install
npm test          # 31 testes (vitest)
npm run typecheck
npm start         # http://localhost:3000 (PORT para mudar)
npm run demo      # roda o cenário completo em memória com relógio fixo e imprime requests/responses
```

Node 22+.

## Contrato

### 1. O que viaja no link

| Link | Exemplo |
|---|---|
| Campanha | `https://go.conty.app/l/verao26-ig?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao26` |
| Indicação | `https://go.conty.app/l/ref-ana42` |

Só o **código** (`verao26-ig`, `ref-ana42`) tem valor. Os `utm_*` são cópia legível para ferramentas de analytics; o servidor ignora a query e usa os dados gravados na criação do link, então editar a URL não troca a campanha nem o indicador.

Ao abrir o link (`GET /l/:code`) o servidor grava um clique (`clickId`, `clickedAt` do relógio do servidor, `sequence` crescente) e redireciona para `https://conty.app/open?click_id=<clickId>`. O `click_id` chega ao app pelo deep link (app instalado) ou pela camada de deferred deep link / install referrer (app não instalado).

### 2. O que o app grava ao abrir

`POST /app-opens { installId, clickId? }`

- `installId`: UUID gerado pelo app na primeira execução e guardado localmente.
- Na primeira chamada para um `installId` o servidor grava `firstOpenAt`. Aberturas seguintes só atualizam `lastOpenAt`; `firstOpenAt` nunca muda.
- Se veio `clickId`, o clique é vinculado ao install (`boundAt`). Mesmo clique enviado de novo é idempotente. Clique já vinculado a outro install retorna 409; clique inexistente, 404.

### 3. Como o cadastro consome

`POST /signups { userId, installId? }` congela o estado do install no momento (`absent`, `never_opened`, `consumed`, `already_consumed`) e devolve a atribuição. `GET /signups/:userId/attribution` recalcula com o mesmo `signupAt` e o mesmo estado congelado, por isso o resultado não muda depois do cadastro.

Um install é consumido pelo primeiro cadastro. Um segundo usuário cadastrado no mesmo aparelho sai orgânico com `install_consumed_by_previous_signup`, para a mesma indicação não render duas vezes.

## Regras

**Vencedor:** último toque elegível (last touch).
**Empate de `clickedAt`:** indicação vence campanha; persistindo o empate, vence o clique com maior `sequence` (gravado depois pelo servidor). Os timestamps vêm sempre do relógio do servidor, nunca do cliente.

**Clique repetido = uma origem:** cliques elegíveis no mesmo link são agrupados; o mais recente representa o link e os outros saem como `duplicate_click`.

**Janela** (padrão, configurável em `AttributionService({ policy })`):
- `windowMs` = 7 dias **a partir da primeira abertura do app**. Cadastro depois de `firstOpenAt + 7d` não é atribuído (limite inclusivo).
- `clickLookbackMs` = 24 h antes da primeira abertura: clique mais antigo que isso não é tratado como o que trouxe o install.

**Motivos por toque** (os quatro primeiros são checados nessa ordem, antes do ranking):

| reason | quando |
|---|---|
| `clicked_after_signup` | clique depois do cadastro |
| `bound_after_signup` | clique anterior, mas o app só reportou depois do cadastro |
| `signup_after_window` | cadastro depois do fim da janela |
| `clicked_before_lookback` | clique antes de `firstOpenAt - lookback` |
| `duplicate_click` | outro clique do mesmo link representa a origem |
| `superseded_by_later_touch` | outro link tem clique mais recente |
| `lost_tie_by_kind` / `won_tie_by_kind` | empate de horário, indicação x campanha |
| `lost_tie_by_sequence` / `won_tie_by_sequence` | empate de horário e tipo |
| `last_eligible_touch` | vencedor sem empate |
| `install_consumed_by_previous_signup` | install já usado por outro cadastro |

**Orgânico** sempre traz `reason`: `no_install`, `install_never_opened`, `no_touches`, `no_eligible_touches`, `install_consumed_by_previous_signup`.

## Exemplo

Clique duas vezes na campanha, instala, depois clica na indicação e se cadastra; uma hora depois clica de novo na campanha (saída real do `npm run demo`, campos repetidos cortados):

```http
POST /links {"kind":"campaign","code":"verao26-ig","campaign":{"source":"instagram","medium":"paid_social","campaign":"verao26"}}
201 {"kind":"campaign","code":"verao26-ig","url":"https://go.conty.app/l/verao26-ig?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao26", ...}

POST /links {"kind":"referral","code":"ref-ana42","referrerUserId":"user-ana"}
201 {"kind":"referral","code":"ref-ana42","url":"https://go.conty.app/l/ref-ana42","referrerUserId":"user-ana", ...}

GET /l/verao26-ig      -> 302 Location: https://conty.app/open?click_id=clk-1   (12:00)
GET /l/verao26-ig      -> 302 Location: https://conty.app/open?click_id=clk-2   (12:01)
POST /app-opens {"installId":"inst-7f3a","clickId":"clk-1"}  -> {"isFirstOpen":true,"firstOpenAt":"2026-10-01T12:03:00.000Z", ...}
POST /app-opens {"installId":"inst-7f3a","clickId":"clk-2"}
GET /l/ref-ana42       -> 302 Location: https://conty.app/open?click_id=clk-3   (15:03)
POST /app-opens {"installId":"inst-7f3a","clickId":"clk-3"}
POST /signups {"userId":"user-bruno","installId":"inst-7f3a"}                    (15:13)
GET /l/verao26-ig      -> clk-4, reportado pelo app às 16:13
GET /signups/user-bruno/attribution
```

```json
{
  "userId": "user-bruno",
  "signupAt": "2026-10-01T15:13:00.000Z",
  "installId": "inst-7f3a",
  "origin": { "type": "referral", "linkCode": "ref-ana42", "clickId": "clk-3", "referrerUserId": "user-ana" },
  "rule": {
    "winner": "last eligible touch wins; on equal clickedAt a referral beats a campaign; if still tied, the click recorded later by the server (higher sequence) wins",
    "windowMs": 604800000,
    "clickLookbackMs": 86400000
  },
  "window": {
    "lookbackStartsAt": "2026-09-30T12:03:00.000Z",
    "firstOpenAt": "2026-10-01T12:03:00.000Z",
    "endsAt": "2026-10-08T12:03:00.000Z"
  },
  "touches": [
    { "clickId": "clk-1", "linkCode": "verao26-ig", "kind": "campaign", "clickedAt": "2026-10-01T12:00:00.000Z", "outcome": "lost", "reason": "duplicate_click", "detail": "repeated click on link verao26-ig; counted once as click clk-2", "againstClickId": "clk-2" },
    { "clickId": "clk-2", "linkCode": "verao26-ig", "kind": "campaign", "clickedAt": "2026-10-01T12:01:00.000Z", "outcome": "lost", "reason": "superseded_by_later_touch", "detail": "clicked at 2026-10-01T12:01:00.000Z; click clk-3 at 2026-10-01T15:03:00.000Z is more recent", "againstClickId": "clk-3" },
    { "clickId": "clk-3", "linkCode": "ref-ana42", "kind": "referral", "referrerUserId": "user-ana", "clickedAt": "2026-10-01T15:03:00.000Z", "outcome": "won", "reason": "last_eligible_touch", "detail": "most recent eligible click before signup (2026-10-01T15:03:00.000Z)" },
    { "clickId": "clk-4", "linkCode": "verao26-ig", "kind": "campaign", "clickedAt": "2026-10-01T16:13:00.000Z", "outcome": "lost", "reason": "clicked_after_signup", "detail": "clicked at 2026-10-01T16:13:00.000Z, after signup at 2026-10-01T15:13:00.000Z" }
  ]
}
```

Cadastro sem nada:

```json
POST /signups {"userId":"user-carla"}
{ "origin": { "type": "organic", "reason": "no_install", "detail": "signup did not carry an installId, so no app open or link can be linked to it" }, "window": null, "touches": [] }
```

Erros: 400 (`invalid_request` com `issues` do zod), 404 (`not_found`), 409 (`conflict`).

## Decisões

- **Last touch** porque é o clique mais próximo da decisão de se cadastrar; a regra fica no corpo da resposta (`rule.winner`) para não depender de documentação.
- **Indicação vence no empate** porque é a origem com uma pessoa por trás e normalmente gera recompensa; campanha paga perdendo um empate de milissegundo custa menos que um indicador sem crédito.
- **Relógio injetável** (`Clock`, `ManualClock`) e ids injetáveis: todos os testes de janela e de empate são determinísticos, inclusive limites exatos (`+7d` e `+7d+1ms`).
- **Estado congelado no cadastro** em vez de snapshot da resposta: a regra é pura (`src/domain/attribution.ts`) e qualquer recálculo devolve o mesmo vencedor, porque toque posterior ao cadastro nunca é elegível.
- `bound_after_signup` existe para evitar que um clique antigo, só reportado depois, reescreva a origem.

## O que ficou de fora

- Persistência: o store é em memória (`InMemoryStore`). Em produção seria Postgres com unique em `clicks.click_id`, `signups.user_id` e no consumo do install.
- Matching probabilístico (fingerprint IP/UA) para quando o `click_id` não chega no app: aqui sem `click_id` não há toque.
- Autenticação das rotas, rate limit e antifraude de cliques (bots, click flooding).
- Integração real com deep link (App Links / Universal Links / Play Install Referrer); o contrato assume que o `click_id` é entregue ao app.
- Autoindicação: o indicador ainda não existe como usuário neste serviço, então não há checagem `referrerUserId === userId`.

## Uso de IA

Código gerado com assistência de IA (Claude Code). O que a IA fez:

- Modelagem do contrato (link, abertura do app, cadastro) e das regras de vencedor, desempate, janela e motivos.
- Implementação da regra pura, do serviço, do store em memória e da API Fastify com validação zod.
- Testes de domínio e HTTP (31), script de demo e este README, com exemplos tirados da saída real do demo.

Revisao humana: [Rodrigo completa]
