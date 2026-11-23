# Estrutura do Discordo

Reorganização local feita em 21/11/2026, usando como referência a separação de
frontend e backend da pasta `oficina vibe coding`. O projeto continua usando Vite,
TypeScript, PHP e Node.js; não houve troca de framework nem migração de dados.

## Pastas e responsabilidades

| Pasta | Conteúdo |
| --- | --- |
| `frontend/src/` | Interface, estilos, chamadas, câmera, compartilhamento, perfis e tutorial. |
| `frontend/public/` | Somente as imagens otimizadas usadas pelo site e o ZIP público da extensão. |
| `backend/src/` | Endpoints PHP, regras de acesso, persistência e servidor Node.js de voz. |
| `shared/` | Canais de voz usados tanto pelo frontend quanto pelo backend. |
| `database/` | Esquema consolidado atual. |
| `database/migrations/` | Cinco migrações para bancos que ainda não receberam essas alterações. |
| `database/historico/` | Esquemas SQL anteriores, preservados para consulta. |
| `database/modelos/` | Modelo do MySQL Workbench e seu backup anterior. |
| `Imagens/` | Originais, referências e artes antigas reunidas. Não é uma pasta pública. |
| `extensions/` | Código da extensão de atalhos globais. |
| `scripts/` | Publicação na hospedagem e recompilação do filtro RNNoise. |
| `tests/` | Testes de interface, backend, som, voz, estrutura e extensão. |
| `vendor/rnnoise/` | Código original, modelos e licença do RNNoise. |
| `prototypes/animations/` | Simulações e prévias de animações, com seus testes e exportações. |
| `docs/` | Este documento e o manifesto de arquivos movidos. |
| `dist/` | Build atual. Gerado pelo Vite; não deve ser editado manualmente. |

Os arquivos de configuração, o `package.json`, o lockfile, o README e o `AGENTS.md`
continuam na raiz. Os comandos npm são executados nessa pasta.

## Caminhos alterados

- `src/`, `public/` e `index.html` foram reunidos em `frontend/`.
- `server/` passou a `backend/src/`; os SQL saíram dela para `database/migrations/`.
- `voice-channels.json` passou a `shared/voice-channels.json`.
- `publish-hostgator.py` passou a `scripts/publish-hostgator.py`.
- `rnnoise-main/` passou a `vendor/rnnoise/`.
- `extension/` passou a `extensions/`.
- `previas-animacoes/` passou a `prototypes/animations/`.
- Os 15 arquivos de `Referencias/` foram reunidos aos quatro originais de `Imagens/`.
- Seis artes WebP sem uso no aplicativo atual saíram da pasta pública e foram
  preservadas em `Imagens/`: breaker, cactus, caramelo, mural e as duas placas antigas.

`docs/reorganizacao-manifesto.json` registra o caminho original, o destino e o
SHA-256 original de cada um dos 235 arquivos movidos. Os oito arquivos que
precisaram de ajustes de caminho ou comentários estão registrados no campo
`arquivos_ajustados`. Os demais mantêm seus hashes originais.

## Comandos

```powershell
npm run dev
npm run check
npm run build
npm start
npm run test:structure
npm run test:servers
npm run deploy
```

O PHP local agora é iniciado com:

```powershell
$env:DISCORDO_DB_CONFIG = 'C:/caminho/privado/discordo-db.php'
php -S 127.0.0.1:8081 -t backend/src
```

O deploy continua enviando somente o conteúdo público compilado e os arquivos PHP
necessários, com os mesmos URLs. As pastas de imagens originais, banco, testes,
prototypes e vendor não são publicadas. A reorganização não foi enviada à
hospedagem, pois o código público compilado não mudou.

O build está configurado para não apagar arquivos preexistentes de `dist/`
automaticamente. Uma limpeza dessa pasta deve ser feita de forma explícita.
As credenciais de publicação e de banco continuam fora dos arquivos públicos.

## O que foi preservado por ter utilidade

- `node_modules/`: dependências do desenvolvimento e da compilação.
- `vendor/rnnoise/`: necessário para recompilar e manter a origem e a licença do
  filtro. A pasta completa também preserva opções de treinamento e outros modelos.
- `extensions/`: permite os atalhos fora da aba do Discordo.
- `prototypes/animations/`: permite consultar as simulações; uma prévia ainda é
  coberta por teste, e o simulador é compartilhado com o código do efeito atual.
- Modelos e SQL históricos: material anterior do banco. O backup `.mwb.bak` é
  diferente do `.mwb` atual, portanto não foi tratado como cópia idêntica.

## Limpeza autorizada e concluída

Após autorização explícita do usuário, foram removidos:

- `Referencias/`: pasta vazia após a união das imagens.
- `archive/build-anterior/`: 20 arquivos da compilação anterior, totalizando
  7.869.436 bytes (7,50 MiB). A compilação atual permanece em `dist/`.
- `archive/`: removida depois de ficar vazia.

Nenhum outro arquivo foi excluído. O manifesto mantém o histórico dos movimentos e
registra os 20 arquivos gerados removidos no campo `exclusoes_autorizadas`.

## Verificações

- TypeScript e build de produção passaram.
- O JavaScript e o CSS compilados coincidem byte a byte com o build anterior.
- Antes da limpeza, os 235 destinos do manifesto foram conferidos. Após a exclusão
  autorizada dos 20 arquivos do build antigo, os outros 215 continuam presentes.
  Todas as imagens originais e os fontes de terceiros foram preservados.
- Passaram testes de estrutura, múltiplos servidores, interface, atalhos, voz HTTP,
  recuperação da chamada, câmera, transmissão, áudio, RNNoise, servidor compilado,
  prévias de animação, simulador de fumaça e anexos de chat.
- Passaram seis verificações PHP sem banco real: código por e-mail, data do
  Gameplay, aparência, áudios personalizados, hierarquia e estado da voz.
- Os 21 arquivos PHP do backend passaram na checagem de sintaxe.
- Os três testes PHP que exigem um banco MariaDB isolado (exclusão de conta,
  convites e histórico do Gameplay) não foram executados. Nenhum banco de dados
  foi acessado ou alterado nesta reorganização.
- Um teste antigo foi atualizado para esperar barras laterais finas com transição,
  acompanhando a mudança de aparência já implementada anteriormente.
