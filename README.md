# Video Review

API de revisão de peças de campanha: a campanha declara quais peças exige, cada peça recebe versões, e a entrega só é aprovada quando toda peça exigida tem a versão atual aprovada. Versão nova em peça exigida desfaz a aprovação até ser aprovada.

## Setup e execução

Requer Node 18+.

```bash
npm ci
npm test      # suíte completa (Vitest + supertest)
npm run dev   # sobe a API em http://localhost:3000 (PORT para trocar a porta)
```

## Peças (`piece`)

Enum no fio (português), case-insensitive e com acento opcional (`VÍDEO` vale como `video`):

`roteiro | video | capa | legenda`

Valor fora do enum → `400`. `Version.status`: `pending | approved` — criação sempre nasce `pending` (campo `status` do cliente é ignorado); só o endpoint de aprovar transiciona para `approved`.

## Códigos de status

| Código | Quando |
| ------ | ------ |
| 200 | Aprovar versão (inclusive re-aprovar, idempotente); aprovar entrega com tudo pronto; GETs de entrega, versão, comentários e arquivo |
| 201 | Criar campanha, criar entrega, submeter versão, postar comentário |
| 400 | `requiredPieces` ausente/vazio/duplicado/inválido; `piece` inválida; `contentUrl` ausente/vazio; comentário com `second < 0` ou `body` vazio |
| 404 | Campanha, entrega, versão ou arquivo inexistente (inclui comentar/listar comentários de versão inexistente) |
| 422 | Aprovar entrega com peças pendentes (`{ "missing": [...] }`); aprovar versão que não é a atual (`{ "error": "superseded" }`) |

## Ciclo completo (curl)

Rode na ordem — cada passo usa os IDs dos anteriores. Todos os comandos abaixo foram executados contra um servidor local antes de entrar aqui.

```bash
B=http://localhost:3000

# 1. Cria a campanha exigindo vídeo + legenda (roteiro e capa nunca bloqueiam esta campanha)
curl -X POST $B/campaigns -H 'Content-Type: application/json' \
  -d '{"requiredPieces":["video","legenda"]}'
# → 201 {"id":"1","requiredPieces":["video","legenda"]}
CID=1

# 2. Cria a entrega para a campanha
curl -X POST $B/deliveries -H 'Content-Type: application/json' \
  -d "{\"campaignId\":\"$CID\"}"
# → 201 {"id":"2","campaignId":"1","approved":false,"missing":["video","legenda"]}
DID=2

# 3. Submete a versão do vídeo (por URL)
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"video","contentUrl":"https://cdn.example.com/v1.mp4"}'
# → 201 {"id":"3",...,"piece":"video","status":"pending"}
V1=3

# 4. Aprova a versão do vídeo
curl -X POST $B/versions/$V1/approve
# → 200 {"id":"3",...,"status":"approved"}

# 5. Tenta aprovar a entrega — falha listando o que falta
curl -X POST $B/deliveries/$DID/approve
# → 422 {"missing":["legenda"]}

# 6. Submete e aprova a legenda
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"legenda","contentUrl":"https://cdn.example.com/leg.srt"}'
# → 201 {"id":"4",...,"status":"pending"}
L1=4
curl -X POST $B/versions/$L1/approve
# → 200 {"id":"4",...,"status":"approved"}

# 7. Aprova a entrega — agora passa
curl -X POST $B/deliveries/$DID/approve
# → 200 {"id":"2","campaignId":"1","approved":true,"missing":[]}

# 8. Versão nova do vídeo desfaz a aprovação da entrega
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"video","contentUrl":"https://cdn.example.com/v2.mp4"}'
# → 201 {"id":"5",...,"piece":"video","status":"pending"}
V2=5
curl $B/deliveries/$DID
# → 200 {"id":"2",...,"approved":false,"missing":["video"],...}

# 9. Re-aprova a nova versão e a entrega volta a aprovar
curl -X POST $B/versions/$V2/approve
# → 200 {"id":"5",...,"status":"approved"}
curl -X POST $B/deliveries/$DID/approve
# → 200 {"id":"2","campaignId":"1","approved":true,"missing":[]}
```

## Upload de arquivo (multipart)

Submete uma versão com o binário real em vez de URL; `contentUrl` passa a apontar para o arquivo servido em `/files/:nome`:

```bash
echo 'dados do clipe' > clip.txt
curl -X POST $B/deliveries/$DID/versions -F 'piece=capa' -F 'file=@clip.txt'
# → 201 {"id":"6",...,"piece":"capa","contentUrl":"/files/<nome>","status":"pending"}
curl $B/files/<nome>   # → 200, devolve o arquivo; nome desconhecido → 404
```

Peça não exigida (`capa` aqui) é aceita com 200/201 mas nunca bloqueia nem desfaz a aprovação.

## Comentário ancorado a um segundo da versão

```bash
curl -X POST $B/versions/$V2/comments -H 'Content-Type: application/json' \
  -d '{"second":12.5,"body":"corte aqui"}'
# → 201 {"id":"7","versionId":"5","second":12.5,"body":"corte aqui"}
curl $B/versions/$V2/comments
# → 200 [{"id":"7","versionId":"5","second":12.5,"body":"corte aqui"}]
```

Comentários aparecem só na versão onde foram feitos (versão nova lista `[]` com 200); versões antigas seguem legíveis via `GET /versions/:id`.

## Nota de divulgação de IA

O design e a implementação deste repositório foram produzidos por agentes de codificação por IA sob a direção do dono do repositório, e revisados pelo dono (Heldinhow), que também executou a suíte de testes e o fluxo manual de ponta a ponta descritos acima.
