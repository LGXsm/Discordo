# Discordo

Discordo é um aplicativo web em desenvolvimento para conversar em servidores,
trocar mensagens privadas e fazer chamadas de voz com compartilhamento de tela.
A interface usa TypeScript e Vite, com PHP e Node.js no backend.

## Organização

Os comandos npm continuam sendo executados na raiz. A estrutura separa a aplicação,
o backend e os arquivos de apoio, seguindo a organização da pasta de referência.

```text
frontend/       Interface: src/, public/ e index.html
backend/src/    API PHP e servidor Node.js de voz
shared/         Configuração compartilhada dos canais de voz
database/       Esquema atual, migrações, modelos e histórico SQL
Imagens/        Imagens originais e referências visuais reunidas
extensions/     Extensão de atalhos globais do Chrome
scripts/        Compilação do RNNoise e publicação
tests/          Testes do frontend, backend, voz e extensão
vendor/rnnoise/ Código e licença do RNNoise para recompilar o filtro de ruído
prototypes/     Simulações e prévias de animações, fora do aplicativo publicado
docs/           Detalhes da estrutura e registro da reorganização
dist/           Build atual gerado pelo Vite
```

As imagens otimizadas utilizadas pelo aplicativo ficam em `frontend/public/art/`.
Os originais não são publicados. Veja `docs/ESTRUTURA.md` para os destinos dos
arquivos e os itens que podem ser removidos mediante autorização.

## Discordo para Windows

O cliente em `desktop/` abre o Discordo hospedado em uma janela própria, com
armazenamento de sessão separado do navegador. Ele usa o mesmo backend e as
mesmas contas do site. A beta para Windows x64 pode ser baixada nas
[Releases do Discordo](https://github.com/LGXsm/Discordo/releases).
O instalador beta é distribuído sem assinatura digital e pode exibir um aviso do Windows.

```powershell
npm --prefix desktop ci
npm --prefix desktop start
npm --prefix desktop run make
```

O npm instala o Electron como dependência. O comando `make` gera
`Discordo-Setup.exe` em `desktop/out/make/squirrel.windows/x64/`.

Quem está na Beta 1 deve executar o instalador da Beta 2 por cima da versão
instalada uma vez. A partir da Beta 2, o app verifica novas versões do
cliente Windows ao abrir e em segundo plano. Quando termina o download,
ele oferece a opção de reiniciar. As mudanças do site chegam pelo próprio site.

Para lançar uma versão desktop, atualize a versão em `desktop/package.json`
e no lockfile. Envie a tag `desktop-v<versão>` do commit que será lançado.
O GitHub Actions gera o instalador e prepara uma release em rascunho com
`Discordo-Setup.exe`, `RELEASES` e o pacote `.nupkg`. Ao publicar a release,
ela passa a ser elegível para o atualizador. Versões estáveis recebem versões
estáveis e instalações beta também podem receber pré-releases.
Se precisar repetir a geração, execute o workflow manualmente informando a
mesma tag antes de publicar a release.

Durante uma chamada, use **Tela** para escolher um monitor ou janela.
O áudio do sistema é opcional e está disponível ao compartilhar um monitor.
Em **Configurações de usuário → Atalhos**, use Ctrl + Alt + uma letra, número
ou tecla de função (F1–F24) para controlar microfone e áudio com outro aplicativo
em foco, desde que a combinação esteja livre no Windows.

## Banco de dados

As contas, sessões, perfis e mensagens são gravados no MySQL ou MariaDB. O PHP guarda as imagens de perfil em `discordo-profile-media` e os anexos do chat em `discordo-chat-videos`, ao lado do arquivo privado de configuração do banco. As preferências de voz e os atalhos ficam no navegador, separados por conta.

A hierarquia de cargos fica em `discordo-role-order`, também ao lado da configuração privada do banco, e dispensa migração SQL. A administração organiza os cargos personalizados em **Configurações do servidor → Cargos**. A lista de membros usa o cargo mais alto de cada pessoa e mostra Criador e ADM antes dos cargos personalizados.

Para preparar um banco local vazio, selecione-o no MariaDB e importe
`database/discordo-esquema-atual.sql`, seguido de `database/migrations/friends.sql`.
O esquema consolidado contém a estrutura das demais migrações.
Em seguida, cadastre o servidor de entrada e dois canais para testar o app.

```sql
INSERT INTO Servidor (srv_nome, srv_entrada) VALUES ('Discordo Brasil', 1);
SET @servidor_entrada = LAST_INSERT_ID();
INSERT INTO Canal (Servidor_srv_id, cnl_nome, cnl_tipo) VALUES
    (@servidor_entrada, 'geral', 'TEXTO'),
    (@servidor_entrada, 'Resenha', 'VOZ');
```

Em um banco existente, aplique somente as migrações pendentes de
`database/migrations/`. Os arquivos antigos em `database/historico/` ficam
preservados para consulta. A reorganização não exige migração no banco atual.
Para anexos de até 20 MB, o PHP precisa permitir uploads de 20 MB e requisições
de pelo menos 21 MB.

Crie um arquivo PHP de configuração fora da pasta do site e preencha os dados do seu banco local.

```php
<?php
return [
    'host' => '127.0.0.1',
    'database' => 'discordo_multiservidor',
    'user' => 'seu_usuario_local',
    'password' => 'sua_senha_local',
];
```

Com PHP e a extensão `pdo_mysql` disponíveis, execute em um terminal na pasta do Discordo.

```powershell
$env:DISCORDO_DB_CONFIG = 'C:/caminho/privado/discordo-db.php'
php -S 127.0.0.1:8081 -t backend/src
```

Em outro terminal, execute `npm run dev` e abra o endereço exibido. O Vite encaminha as requisições de conta para o PHP.

## Testar voz e tela

1. Execute `npm install` e inicie o site local seguindo a seção **Banco de dados**.
2. Abra a URL exibida no terminal em dois perfis de navegador ou em uma janela normal e outra privativa. Crie uma conta em cada janela.
3. Clique em **Resenha** ou **Lan house** para entrar e autorize o microfone. Os participantes e controles de voz ficam na barra lateral, enquanto o canal de texto continua aberto. Use **Compartilhar tela** para iniciar uma transmissão e **Ver transmissão** para exibi-la acima das mensagens.

O compartilhamento pode incluir o áudio quando o navegador e a fonte capturada oferecem essa opção. A conversa continua pelo microfone. Os canais de voz ficam sem limite por padrão. A administração pode definir a lotação nas configurações do canal.

O botão de microfone silencia sua entrada. O botão de fone silencia a saída e o microfone juntos. Ao reativar o fone, o microfone volta ao estado em que estava antes.

Você pode entrar e ouvir enquanto a autorização do microfone está pendente. Em **Configurações de usuário → Voz**, escolha os dispositivos, ajuste os volumes e clique em **Salvar voz**. Se a saída específica não estiver disponível no navegador, use a saída padrão definida no sistema.

Se a solicitação de microfone não aparecer, use **Permitir microfone** na sala ou em **Voz**. Abra o Discordo em uma aba normal do navegador se a prévia integrada bloquear o pedido. Nos controles do site, junto à barra de endereço, confira se **Microfone** está em **Permitir**. O botão **Selecionar fone** aparece quando o navegador oferece um seletor de saída.

## Rodar a versão compilada

Com o PHP iniciado, execute `npm run build` e `npm start`. O servidor Node.js atende a página e encaminha as requisições dos canais cadastrados ao PHP. Por padrão, escuta em `127.0.0.1:5173`. As variáveis `HOST` e `PORT` mudam o endereço interno.

Para abrir em outros computadores, coloque o servidor atrás de um proxy HTTPS que preserve o cabeçalho `Host`. Todos devem abrir o mesmo endereço HTTPS.

O PHP usa STUN por padrão. Se redes diferentes bloquearem conexões diretas, configure o TURN em um arquivo PHP privado fora da raiz pública. O backend procura `.discordo-voice.php` na pasta inicial da conta cPanel ou aceita o caminho configurado em `DISCORDO_VOICE_CONFIG`.

```php
<?php
return [
    'turn_urls' => ['turn:turn.exemplo.com:3478'],
    'turn_secret' => 'segredo-compartilhado-com-o-servidor-turn',
];
```

## Publicar na HostGator

Execute `npm run deploy` na pasta do Discordo. O comando compila a versão para hospedagem compartilhada e publica via FTPS em `discordo.lgmartinez.com`. O endereço antigo `lgmartinez.com/discordo/` redireciona para o subdomínio. O script lê o acesso da configuração local de publicação fora do projeto.

### Verificação por e-mail

O cadastro e o login usam o código de seis dígitos enviado pelo PHP da hospedagem. O remetente padrão é `discordo@lgmartinez.com` e pode ser configurado com `DISCORDO_MAIL_FROM`. A hospedagem precisa aceitar o remetente e encaminhar os e-mails transacionais.

Os desafios ficam na pasta privada `.discordo-verification`, ao lado do arquivo privado de configuração do banco. A pasta precisa ser gravável pelo PHP e deve ficar fora da raiz pública. Os desafios expiram após dez minutos e são removidos na próxima operação de verificação. A alteração usa as tabelas atuais e dispensa migração SQL.

As sessões anteriores à adoção do hash com prefixo `discordo:email-verified:v1` deixam de autenticar. As sessões emitidas depois da confirmação do código usam o novo hash e permanecem válidas normalmente.

Na HostGator, o backend lê `.discordo-db.php` na pasta inicial da conta cPanel, fora das pastas públicas. O áudio e a tela continuam pelo WebRTC.

## Categorias de canais

O menu do servidor oferece **Criar categoria** a quem possui a permissão
**Gerenciar canais e categorias**. A permissão usa o mesmo bit de gerenciamento
já existente; os cargos que gerenciavam canais continuam autorizados.

Cada categoria pode reunir texto e voz. Arraste canais para outra categoria ou
para cima/baixo de outro canal; arraste o título de uma categoria para reorganizar
os grupos. As setas nos títulos das categorias oferecem uma alternativa ao arraste. Em **Editar canal**,
use **Categoria** para escolher o grupo. A engrenagem do título permite renomear
ou excluir uma categoria. Excluir a categoria mantém seus canais em **Sem categoria**.
As permissões dos canais privados não são alteradas por essa organização.

A organização fica em `discordo-channel-layout/<servidor>.json`, ao lado da
configuração privada do banco, fora da pasta pública. A gravação é atômica e as
operações usam o bloqueio da linha do servidor para serializar alterações.
Os vínculos são validados usando os canais do servidor ativo e a visibilidade de
quem está editando. Não é necessária migração SQL.

Os canais anteriores começam nas categorias **Canais de texto** e **Canais de voz**,
que podem ser renomeadas, movidas e excluídas. Recolher uma categoria é uma
preferência local de cada conta e servidor. Para testar a interface, execute
`npm run test:categories`; o teste PHP de armazenamento e permissões fica em
`tests/channel-categories.php` e usa somente uma pasta temporária isolada.
