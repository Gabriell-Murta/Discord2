// Servidor de signaling para a sala de voz P2P.
//
// Este servidor NAO transporta audio nem video: ele so serve a pagina
// estatica (public/index.html) e repassa mensagens de signaling (offer,
// answer, ICE candidates) entre os navegadores via WebSocket, para que eles
// consigam estabelecer conexoes WebRTC diretas (P2P) entre si.
//
// Autenticacao: em vez de senha, cada pessoa tem seu proprio par de chaves
// ECDSA gerado localmente (scripts gerar-chaves.js / gerar-token.js) - o
// mesmo principio de uma chave SSH. A chave privada nunca sai do computador
// de quem a gerou; o que chega ao servidor e um TOKEN assinado (formato
// "payload.assinatura"), que prova posse da chave privada sem revela-la.
// O servidor confere: (1) a chave publica dentro do token esta na lista de
// chaves autorizadas (chaves-autorizadas.json); (2) a assinatura do token
// realmente bate com essa chave publica.

import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import crypto, { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const { subtle } = webcrypto;

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ARQUIVO_CHAVES_AUTORIZADAS = new URL('./chaves-autorizadas.json', import.meta.url);

const app = express();
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// rooms: nome da sala -> Set de conexoes WebSocket dos clientes presentes.
const rooms = new Map();

// Devolve (criando se preciso) o Set de conexoes de uma sala.
function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  return rooms.get(roomName);
}

// Le o arquivo de chaves autorizadas do zero a cada tentativa de entrada,
// para que o administrador possa adicionar um amigo novo sem reiniciar o
// servidor. E um arquivo pequeno, entao o custo disso e desprezivel.
function carregarChavesAutorizadas() {
  try {
    const conteudo = fs.readFileSync(ARQUIVO_CHAVES_AUTORIZADAS, 'utf-8');
    const lista = JSON.parse(conteudo);
    return Array.isArray(lista) ? lista : [];
  } catch (erro) {
    console.error('Nao foi possivel ler chaves-autorizadas.json:', erro.message);
    return [];
  }
}

// Importa uma chave publica (recebida como base64 do formato "raw" de uma
// curva EC) como um objeto CryptoKey utilizavel para verificar assinaturas.
async function importarChavePublica(base64) {
  const bruto = Buffer.from(base64, 'base64');
  return subtle.importKey('raw', bruto, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

// Confere um token no formato "payloadBase64.assinaturaBase64" (gerado pelo
// script gerar-token.js): o payload contem a chave publica de quem gerou o
// token, e a assinatura prova que essa mesma pessoa possui a chave privada
// correspondente. Devolve a entrada de chaves-autorizadas.json (com o nome
// da pessoa) se tudo bater, ou null caso contrario (token mal formado, chave
// nao autorizada ou assinatura invalida).
async function validarToken(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 2) return null;
  const [payloadBase64, assinaturaBase64] = partes;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
  } catch {
    return null;
  }

  const chavePublicaBase64 = String(payload.chavePublica || '');
  if (!chavePublicaBase64) return null;

  const entradaAutorizada = carregarChavesAutorizadas()
    .find((entrada) => entrada.chavePublica === chavePublicaBase64);
  if (!entradaAutorizada) return null;

  try {
    const chaveCryptoKey = await importarChavePublica(chavePublicaBase64);
    const assinaturaValida = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      chaveCryptoKey,
      Buffer.from(assinaturaBase64, 'base64'),
      Buffer.from(payloadBase64), // mesmos bytes assinados em gerar-token.js
    );
    return assinaturaValida ? entradaAutorizada : null;
  } catch {
    return null;
  }
}

// Envia um objeto como JSON para um cliente, ignorando se a conexao
// ja tiver caido (evita derrubar o servidor por causa de um peer morto).
function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  // Cada conexao recebe um id unico, usado pelos clientes para saber
  // com quem abrir cada RTCPeerConnection e para decidir politeness
  // no "perfect negotiation" (comparando ids).
  ws.id = crypto.randomUUID();
  ws.room = null;

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // mensagem invalida, ignora
    }

    if (message.type === 'join') {
      const roomName = String(message.room || '').trim();
      if (!roomName) return;

      const entradaAutorizada = await validarToken(message.token);
      if (!entradaAutorizada) {
        send(ws, {
          type: 'auth-error',
          message: 'Token invalido ou chave publica nao autorizada. Envie sua chave publica para quem administra o servidor.',
        });
        return;
      }

      ws.room = roomName;
      ws.nome = String(entradaAutorizada.nome || 'Sem nome');
      const peers = getRoom(roomName);

      // Avisa o novo cliente sobre quem ja esta na sala (id + nome de cada
      // um), para que ele inicie a conexao WebRTC e ja mostre o nome
      // correto. Tambem informa o proprio id, que o cliente usa para
      // decidir politeness no "perfect negotiation" (comparando os ids).
      const existingPeers = [...peers].map((peer) => ({ id: peer.id, nome: peer.nome }));
      send(ws, { type: 'peers', self: ws.id, peers: existingPeers });

      // Avisa os demais da sala que um novo peer chegou, com o nome dele.
      for (const peer of peers) {
        send(peer, { type: 'peer-joined', id: ws.id, nome: ws.nome });
      }

      peers.add(ws);
      return;
    }

    if (message.type === 'signal') {
      // Repassa a mensagem de signaling (offer/answer/ICE candidate)
      // para o peer de destino, marcando quem enviou.
      if (!ws.room) return;
      const peers = getRoom(ws.room);
      const target = [...peers].find((peer) => peer.id === message.to);
      if (target) {
        send(target, { type: 'signal', from: ws.id, data: message.data });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const peers = getRoom(ws.room);
    peers.delete(ws);

    // Avisa os que ficaram que esse peer saiu, para removerem o video/audio dele.
    for (const peer of peers) {
      send(peer, { type: 'peer-left', id: ws.id });
    }

    if (peers.size === 0) {
      rooms.delete(ws.room);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});
