// Gera um token de acesso assinado com a SUA chave privada
// (minha-chave-privada.json, criada por gerar-chaves.js).
//
// O token e' um texto no formato "payload.assinatura": o payload contem sua
// chave publica e a data de criacao; a assinatura prova que voce e' dono da
// chave privada correspondente, sem que ela nunca saia deste computador -
// so o token (payload + assinatura) e' colado na pagina do app.
//
// Rode com: node gerar-token.js

import { webcrypto } from 'node:crypto';
import fs from 'node:fs';

const { subtle } = webcrypto;
const ARQUIVO_CHAVE_PRIVADA = 'minha-chave-privada.json';

if (!fs.existsSync(ARQUIVO_CHAVE_PRIVADA)) {
  console.error(`Nao encontrei ${ARQUIVO_CHAVE_PRIVADA} nesta pasta. Rode "node gerar-chaves.js" primeiro.`);
  process.exit(1);
}

const chavePrivadaJwk = JSON.parse(fs.readFileSync(ARQUIVO_CHAVE_PRIVADA, 'utf-8'));

const chavePrivada = await subtle.importKey(
  'jwk',
  chavePrivadaJwk,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
);

// A chave publica correspondente e derivada da mesma JWK, so que sem o
// campo "d" (que e o segredo da chave privada) - ela vai dentro do token
// para o servidor saber contra qual chave conferir a assinatura.
const chavePublicaJwk = { ...chavePrivadaJwk, key_ops: ['verify'] };
delete chavePublicaJwk.d;
const chavePublica = await subtle.importKey(
  'jwk',
  chavePublicaJwk,
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['verify'],
);
const chavePublicaBruta = await subtle.exportKey('raw', chavePublica);
const chavePublicaBase64 = Buffer.from(chavePublicaBruta).toString('base64');

const payload = {
  chavePublica: chavePublicaBase64,
  criadoEm: new Date().toISOString(),
};
const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');

const assinatura = await subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  chavePrivada,
  Buffer.from(payloadBase64),
);
const assinaturaBase64 = Buffer.from(assinatura).toString('base64');

const token = `${payloadBase64}.${assinaturaBase64}`;

console.log('Seu token de acesso (cole no campo "Token de acesso" da pagina do app):');
console.log('');
console.log(token);
