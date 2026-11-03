# Sala de Voz P2P

App web simples de sala de voz com compartilhamento de tela, para usar com amigos. As conexões de áudio e vídeo (WebRTC) acontecem diretamente entre os navegadores (P2P, topologia *mesh*); o servidor Node.js só faz o papel de "sinalização" (signaling), apresentando os participantes uns aos outros.

Pensado para grupos pequenos (2 a 5 pessoas).

## Linguagem e tecnologias escolhidas

- **Servidor: Node.js + JavaScript puro (ESM)**, usando `express` (para servir a página) e `ws` (WebSocket para o signaling). Foram escolhidas por serem as bibliotecas mais simples e maduras para esse tipo de servidor leve, exigindo apenas a instalação do Node — sem toolchain de build.
- **Cliente: HTML/CSS/JS puro, sem framework**. A API de WebRTC (`RTCPeerConnection`, `getUserMedia`, `getDisplayMedia`) só existe nativamente via JavaScript no navegador — qualquer outra linguagem no cliente precisaria compilar para JS de qualquer forma (ex. TypeScript), o que seria complexidade desnecessária para um projeto desse tamanho.
- **Sem framework/bundler** (React, Vite, etc.): o app cabe inteiro em um único `index.html`, então não há passo de build — basta editar o arquivo e recarregar a página no navegador.

## Requisitos

- [Node.js](https://nodejs.org/) instalado (LTS recente).

## Instalação

```bash
npm install
```

## Configuração

Copie o arquivo de exemplo para `.env` (o repositório já vem com um `.env` padrão pronto para uso local, mas o `.env.example` documenta as variáveis):

```bash
cp .env.example .env
```

Variáveis disponíveis:

| Variável | Padrão    | Descrição                                                                 |
|----------|-----------|----------------------------------------------------------------------------|
| `PORT`   | `3000`    | Porta em que o servidor escuta.                                           |
| `HOST`   | `0.0.0.0` | Endereço de bind. `0.0.0.0` escuta em todas as interfaces de rede da máquina (necessário para acesso pela rede local e para o ngrok). Use `127.0.0.1` para restringir o acesso só à própria máquina. |

Se no futuro você quiser rodar o servidor em **outro computador** (em vez do seu), basta copiar o projeto para lá, rodar `npm install` e ajustar o `.env` dessa máquina — nada precisa ser alterado no código nem no `public/index.html`, porque o cliente sempre se conecta ao mesmo host de onde a página foi carregada.

## Rodando

```bash
npm start
```

Acesse `http://localhost:3000` (ou a porta configurada no `.env`) no navegador.

## Testando localmente (na mesma máquina)

1. Rode `npm start`.
2. Gere sua chave e seu token, e autorize a si mesmo (veja "Segurança: autenticação por chave pública/privada" abaixo) — sem isso, nem você consegue entrar.
3. Abra `http://localhost:3000/#teste` em duas abas do navegador (ou uma aba normal + uma aba anônima, para simular dois usuários diferentes) e cole o mesmo token (ou tokens de chaves diferentes, ambas autorizadas) em cada aba.
4. Em cada aba, permita o acesso ao microfone quando solicitado.
5. Fale em uma aba e confirme que o áudio é ouvido na outra (recomendado usar fones de ouvido para evitar eco/microfonia, já que é a mesma máquina captando e reproduzindo).
6. Clique em "Compartilhar tela" em uma aba e veja o vídeo aparecer na outra.
7. Teste mutar/desmutar, trocar de microfone/alto-falante nos seletores do topo, parar o compartilhamento e sair da sala.

## Segurança: autenticação por chave pública/privada

Em vez de senha, a entrada é controlada por um par de chaves criptográficas (ECDSA P-256) que **cada pessoa gera e guarda no próprio computador**, fora do navegador — o mesmo princípio de uma chave SSH. O navegador nunca vê nem guarda a chave privada; ele só recebe um **token já assinado**, colado manualmente.

### Passo a passo: gerando sua chave e seu token

1. **Gere seu par de chaves**, na raiz do projeto:
   ```bash
   node gerar-chaves.js
   ```
   Isso cria o arquivo `minha-chave-privada.json` **neste computador** (nunca compartilhe esse arquivo, nunca o cole em lugar nenhum) e imprime sua **chave pública** no terminal, algo como:
   ```
   Sua chave PUBLICA (envie essa, e so essa, para quem administra o servidor autorizar):

   BIBkKmgPfWuFTOE2BXQJ3tsmn3RUIjGp5WpILReGeO3vyXj2dvnOsSa3Pq+Nl2ptTyzB5HsFz/w2RTlGyf1wvPw=
   ```

2. **Envie só a chave pública** (a string acima, nunca o arquivo `minha-chave-privada.json`) para quem administra o servidor — por fora do app (WhatsApp, etc.). Se você mesmo administra o servidor, é só você adicionar essa chave no arquivo `chaves-autorizadas.json`, na raiz do projeto:
   ```json
   [
     { "nome": "Gabriel", "chavePublica": "BIBkKmgPfWuFTOE2BXQJ3tsmn3RUIjGp5WpILReGeO3vyXj2dvnOsSa3Pq+Nl2ptTyzB5HsFz/w2RTlGyf1wvPw=" },
     { "nome": "Amigo", "chavePublica": "OUTRA_CHAVE_AQUI" }
   ]
   ```
   Não precisa reiniciar o servidor depois de editar esse arquivo — ele é lido de novo a cada tentativa de entrada.

3. **Gere seu token de acesso**, depois de autorizado:
   ```bash
   node gerar-token.js
   ```
   Isso lê seu `minha-chave-privada.json` e imprime um token (uma string única, formato `payload.assinatura`).

4. **Cole o token** no campo "Token de acesso" da tela inicial do app e clique em "Entrar na sala". O navegador guarda esse token em `localStorage`, então você só precisa colar de novo se limpar os dados do navegador ou usar outro navegador/dispositivo.

### Como o token é assinado e conferido (por baixo dos panos)

`gerar-token.js` monta um payload `{ "chavePublica": "...", "criadoEm": "..." }`, converte para base64, e assina esses bytes com sua chave privada usando ECDSA + SHA-256 (`crypto.subtle.sign`). O token final é `payloadBase64.assinaturaBase64`.

Ao entrar numa sala, o servidor (`server.js`):
1. Separa o token em `payload` e `assinatura`.
2. Decodifica o `payload` e confere se a `chavePublica` nele está na lista de `chaves-autorizadas.json`.
3. Importa essa chave pública e usa `crypto.subtle.verify` para conferir se a `assinatura` realmente corresponde ao `payload`, assinado por quem possui a chave privada correspondente.
4. Só libera a entrada na sala se as duas checagens passarem.

Isso prova que quem está entrando realmente possui a chave privada de uma chave pública autorizada, sem que a chave privada em si jamais trafegue pela rede.

**Importante:**
- **A chave privada (`minha-chave-privada.json`) nunca sai do seu computador.** Trate-a como uma chave SSH: não a compartilhe, não a cole em chats, não a suba para nenhum repositório (ela já está no `.gitignore`).
- **O token, por outro lado, é o que você cola no navegador** — funciona como uma credencial de acesso (parecido com uma senha ou API key): quem tiver o token consegue entrar, então não o compartilhe publicamente. Diferente da chave privada, vazar o token não permite forjar um token novo, mas permite usar aquele token enquanto a chave dele continuar autorizada.
- **Revogar acesso:** remova a entrada correspondente de `chaves-autorizadas.json` — o token dessa pessoa para de funcionar imediatamente na próxima tentativa de entrada (sem precisar reiniciar o servidor).
- **Cada dispositivo pode ter sua própria chave/token**, ou você pode gerar um token e usá-lo em vários navegadores/dispositivos seus (basta colar o mesmo token em cada um) — quem decide isso é você, gerando (ou não) mais de um par de chaves.
- O áudio e o vídeo em si trafegam direto entre os navegadores (P2P, via WebRTC), já criptografados nativamente — eles não passam pelo servidor. A autenticação por token protege apenas a etapa de *entrar na sala* (o signaling), que é o único ponto que passa pelo seu servidor.

## Convidando amigos de fora da sua rede

Como o WebRTC (`getUserMedia`/`getDisplayMedia`) só funciona em **contextos seguros** (HTTPS, ou `localhost`), seus amigos não vão conseguir usar o app se você só compartilhar `http://SEU_IP:3000` — o navegador deles vai bloquear o acesso ao microfone/tela nesse endereço HTTP simples. A solução é criar um túnel HTTPS público apontando para o seu servidor local. Duas opções:

### Opção A: ngrok (requer conta gratuita)

1. Crie uma conta gratuita em [ngrok.com](https://ngrok.com/) e pegue seu authtoken.
2. Instale o ngrok e rode `ngrok config add-authtoken SEU_TOKEN` uma vez.
3. Com o servidor rodando (`npm start`), em outro terminal execute:
   ```bash
   ngrok http 3000
   ```
   (troque `3000` pela porta configurada no seu `.env`, se for diferente)
4. O ngrok vai gerar uma URL pública `https://algumacoisa.ngrok-free.app` (ou similar). Envie esse link para seus amigos.

**Observações:** o túnel só existe enquanto o comando `ngrok http` estiver rodando — se fechar o terminal, o link para de funcionar; e no plano gratuito, a URL muda toda vez que você reinicia o túnel.

### Opção B: Cloudflare Tunnel (sem precisar de conta)

O `cloudflared` da Cloudflare oferece um "quick tunnel" que não exige login para uso pontual:

1. Instale o `cloudflared` (ex. `winget install Cloudflare.cloudflared` no Windows, ou baixe em [developers.cloudflare.com/cloudflare-one/connections/connect-networks](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
2. Com o servidor rodando (`npm start`), em outro terminal execute:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. O cloudflared vai imprimir uma URL pública `https://palavras-aleatorias.trycloudflare.com`. Envie esse link para seus amigos.

**Observações:** assim como o ngrok, o túnel só existe enquanto o comando estiver rodando, e a URL muda a cada vez que você reinicia.

### Depois de abrir o túnel

Cada amigo roda `node gerar-chaves.js` no computador dele, te envia a chave pública impressa (por fora, ex. WhatsApp) para você autorizar em `chaves-autorizadas.json`, depois roda `node gerar-token.js` e cola o token na página (que abre pelo link do túnel, adicionando `#nomedasala` no final ou digitando o nome da sala na tela inicial). Veja o passo a passo completo na seção "Segurança: autenticação por chave pública/privada" acima. Sem o token de uma chave autorizada, o servidor recusa a entrada mesmo que a pessoa tenha o link do túnel.

Como os scripts `gerar-chaves.js`/`gerar-token.js` rodam com Node.js localmente (não dependem do túnel nem do servidor estar no ar), cada amigo precisa ter o Node instalado na própria máquina, ou você pode gerar a chave/token para ele e enviar o token pronto por um canal privado.

## Sobre STUN/TURN

O app usa apenas o servidor STUN público do Google (`stun:stun.l.google.com:19302`) para ajudar os peers a descobrirem seu endereço público e furarem NAT. Isso funciona bem na maioria das redes domésticas.

Em redes com NAT muito restritivo (ex. algumas redes corporativas, NAT simétrico), a conexão direta P2P pode falhar — nesse caso seria necessário um servidor **TURN** (que retransmite a mídia), o que está fora do escopo deste projeto por enquanto.

## Sobre a escolha de alto-falante (saída de áudio)

A troca do dispositivo de saída de áudio usa a API `HTMLMediaElement.setSinkId`, que **não é suportada no Firefox**. Nesse navegador, o seletor de alto-falante fica oculto automaticamente e o áudio sempre sai pelo dispositivo padrão do sistema.
