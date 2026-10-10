# Conty. Video Review

API de revisão de peças de campanha: a campanha declara quais peças exige (`roteiro | video | capa | legenda`), cada peça recebe versões, e a entrega só é aprovada quando toda peça exigida tem a versão atual aprovada. Versão nova em peça exigida desfaz a aprovação até ser aprovada; o upload pode ser URL ou arquivo real — a regra nunca é flexibilizada.

## Regras principais

- `requiredPieces` é dado da campanha, não condicional: a regra itera o array; peça não exigida nunca bloqueia nem desfaz aprovação.
- Aprovação é derivada da versão atual de cada peça: criação sempre nasce `pending` (campo `status` do cliente é ignorado) e só o endpoint de aprovar transiciona para `approved`.
- Versão nova em peça exigida revoga a entrega; versões são append-only (antigas seguem legíveis).
- Comentário pertence a uma versão + `second >= 0`; nunca migra sozinho para a versão nova.
- Fio em português (`roteiro|video|capa|legenda`, case-insensitive, acento opcional); `second: 0` vale; re-aprovar é idempotente.

## Como rodar

Requer Node 18+. Sem banco e sem seed: tudo em memória, IDs recomeçam a cada boot.

```bash
npm ci
npm test      # Vitest + supertest
npm run dev   # http://localhost:3000 (PORT=3101 para trocar a porta)
```

```bash
B=http://localhost:3000
curl -X POST $B/campaigns -H 'Content-Type: application/json' \
  -d '{"requiredPieces":["video","legenda"]}'
# → 201 {"id":"1","requiredPieces":["video","legenda"]}
```

Os testes descrevem o comportamento esperado.

## Contrato da API

Precedência de erros: recurso inexistente → `404` antes de qualquer validação; validação → `400`; regra de aprovação → `422`.

| Rota | Sucesso | Erros (em ordem) |
| ---- | ------- | ---------------- |
| `POST /campaigns` `{requiredPieces}` | `201` | `400` ausente/vazio/duplicado/fora do enum |
| `POST /deliveries` `{campaignId}` | `201 {approved:false, missing:[...]}` | `404` campanha |
| `GET /deliveries/:id` | `200 {approved, missing, currentVersions}` | `404` entrega |
| `POST /deliveries/:id/versions` JSON `{piece, contentUrl}` ou multipart (`piece` + `file`) | `201 {status:"pending"}` (upload: `contentUrl:/files/:nome`) | `404` entrega → `400` piece → `400` contentUrl; erro do multer → `400` |
| `GET /versions/:id` | `200` | `404` versão |
| `POST /versions/:id/approve` | `200` (idempotente) | `404` versão → `422 {error:"superseded"}` (não atual) |
| `POST /deliveries/:id/approve` | `200 {approved:true, missing:[]}` | `404` entrega → `422 {missing:[...]}` |
| `POST /versions/:id/comments` `{second, body}` | `201` | `404` versão → `400` second/body |
| `GET /versions/:id/comments` | `200` (`[]` em versão nova) | `404` versão |
| `GET /files/:nome` | `200` bytes do arquivo | `404` arquivo |

Normalização: `piece` case-insensitive com acento opcional, canônico minúsculo sem acento. Uploads em `./uploads` (`UPLOAD_DIR` sobrescreve); `basename` bloqueia path traversal.

## Exemplos

Fluxo de sucesso (IDs de servidor zerado; cada passo usa os IDs dos anteriores):

```bash
B=http://localhost:3000

# 1. Campanha exigindo vídeo + legenda
curl -X POST $B/campaigns -H 'Content-Type: application/json' \
  -d '{"requiredPieces":["video","legenda"]}'
# → 201 {"id":"1","requiredPieces":["video","legenda"]}
CID=1

# 2. Entrega nasce não-aprovada, listando o que falta
curl -X POST $B/deliveries -H 'Content-Type: application/json' \
  -d "{\"campaignId\":\"$CID\"}"
# → 201 {"id":"2","campaignId":"1","approved":false,"missing":["video","legenda"]}
DID=2

# 3. Submete e aprova o vídeo
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"video","contentUrl":"https://cdn.example.com/v1.mp4"}'
# → 201 {"id":"3",...,"piece":"video","status":"pending"}
V1=3
curl -X POST $B/versions/$V1/approve
# → 200 {"id":"3",...,"status":"approved"}

# 4. Submete e aprova a legenda, aprova a entrega
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"legenda","contentUrl":"https://cdn.example.com/leg.srt"}'
# → 201 {"id":"4",...,"status":"pending"}
L1=4
curl -X POST $B/versions/$L1/approve
# → 200 {"id":"4",...,"status":"approved"}
curl -X POST $B/deliveries/$DID/approve
# → 200 {"id":"2","campaignId":"1","approved":true,"missing":[]}

# 5. Versão nova do vídeo desfaz a aprovação; re-aprovar restaura
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"video","contentUrl":"https://cdn.example.com/v2.mp4"}'
# → 201 {"id":"5",...,"piece":"video","status":"pending"}
V2=5
curl $B/deliveries/$DID
# → 200 {"id":"2",...,"approved":false,"missing":["video"],...}
curl -X POST $B/versions/$V2/approve
# → 200 {"id":"5",...,"status":"approved"}
curl -X POST $B/deliveries/$DID/approve
# → 200 {"id":"2","campaignId":"1","approved":true,"missing":[]}
```

Upload real e comentário:

```bash
# Versão com binário em vez de URL (peça não exigida: aceita, nunca bloqueia)
curl -X POST "$B/deliveries/$DID/versions" -F 'piece=capa' -F 'file=@clip.txt'
# → 201 {"id":"6",...,"piece":"capa","contentUrl":"/files/NOME","status":"pending"}
# Troque NOME pelo nome devolvido em contentUrl (entre aspas por causa da barra):
curl "$B/files/NOME"   # → 200, devolve o arquivo; nome desconhecido → 404

# Comentário preso ao segundo 12.5 da versão 5
curl -X POST $B/versions/$V2/comments -H 'Content-Type: application/json' \
  -d '{"second":12.5,"body":"corte aqui"}'
# → 201 {"id":"7","versionId":"5","second":12.5,"body":"corte aqui"}
curl $B/versions/$V2/comments
# → 200 [{"id":"7","versionId":"5","second":12.5,"body":"corte aqui"}]
```

Erros (literais):

```bash
# Aprovar com peça obrigatória pendente
curl -X POST $B/deliveries/$DID/approve
# → 422 {"missing":["legenda"]}

# Peça fora do enum
curl -X POST $B/deliveries/$DID/versions -H 'Content-Type: application/json' \
  -d '{"piece":"trailer","contentUrl":"https://cdn.example.com/x"}'
# → 400 {"error":"invalid piece"}

# Comentar versão inexistente
curl -X POST $B/versions/999/comments -H 'Content-Type: application/json' \
  -d '{"second":5,"body":"x"}'
# → 404 {"error":"version not found"}
```

## Fora de escopo

Sem banco (tudo em memória), sem auth, sem S3/transcodificação, sem limites de tipo/tamanho de arquivo, sem paginação, sem workflow de rejeição, sem migração de comentários entre versões, sem frontend.

## Uso de IA

### Feito com IA

- Design (spec e tickets), implementação (código + testes), auditoria da spec contra o enunciado e code-review final com seus fixes, todos gerados por agentes de codificação sob direção do dono do repositório.

### Revisado por humano

- Heldinhow revisou a spec, corrigiu os gaps (revogação só em peça exigida, contrato em português, validações 400/404, histórico append-only), analisou o código gerado e executou `npm ci && npm test` (39/39) mais o fluxo curl de ponta a ponta descritos acima.

O contrato é este README e os testes.
