// Gera o SEU par de chaves ECDSA (P-256) para autenticar no servidor da
// sala de voz - o mesmo principio de uma chave SSH.
//
// A chave privada fica salva em minha-chave-privada.json, NESTE computador,
// e nunca precisa sair daqui: quem usa ela e' o script gerar-token.js, que
// roda localmente e so manda para o servidor o token ja assinado.
//
// Rode com: node gerar-chaves.js

import { webcrypto } from 'node:crypto';
import fs from 'node:fs';

const { subtle } = webcrypto;
const ARQUIVO_CHAVE_PRIVADA = 'minha-chave-privada.json';

if (fs.existsSync(ARQUIVO_CHAVE_PRIVADA)) {
  console.error(
    `Ja existe um arquivo ${ARQUIVO_CHAVE_PRIVADA} nesta pasta.\n` +
    'Apague-o manualmente antes de gerar uma chave nova (isso vai invalidar a chave antiga - ' +
    'quem administra o servidor precisaria autorizar a nova chave publica de novo).',
  );
  process.exit(1);
}

const parDeChaves = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true, // extractable: true, porque precisamos escrever a chave privada em disco
  ['sign', 'verify'],
);

const chavePrivadaJwk = await subtle.exportKey('jwk', parDeChaves.privateKey);
const chavePublicaBruta = await subtle.exportKey('raw', parDeChaves.publicKey);
const chavePublicaBase64 = Buffer.from(chavePublicaBruta).toString('base64');

fs.writeFileSync(ARQUIVO_CHAVE_PRIVADA, JSON.stringify(chavePrivadaJwk, null, 2));

console.log(`Chave privada salva em ./${ARQUIVO_CHAVE_PRIVADA}`);
console.log('NUNCA compartilhe esse arquivo nem o cole em nenhum lugar - ele e so seu.');
console.log('');
console.log('Sua chave PUBLICA (envie essa, e so essa, para quem administra o servidor autorizar):');
console.log('');
console.log(chavePublicaBase64);
console.log('');
console.log('Depois de autorizado, rode "node gerar-token.js" para gerar seu token de acesso.');
