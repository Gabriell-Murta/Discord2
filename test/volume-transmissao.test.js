import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tratarTrackRemota = html.slice(
  html.indexOf('function tratarTrackRemota('),
  html.indexOf('// Depois de toda renegociacao'),
);
const controleVolume = html.slice(
  html.indexOf("inputVolumeDestaque.addEventListener('input'"),
  html.indexOf('// ---------------------------------------------------------------------------', html.indexOf("inputVolumeDestaque.addEventListener('input'")),
);

function preparar() {
  const elementos = [];
  const container = {
    querySelector: seletor => elementos.find(e => seletor === `[data-stream-id="${e.dataset.streamId}"]`),
    appendChild: elemento => elementos.push(elemento),
  };
  let alterarVolume;
  const contexto = {
    criarCardParticipante: () => ({ querySelector: () => container }),
    document: {
      createElement: tag => ({
        tag, muted: false, volume: 1, dataset: {},
        classList: { add() {} }, play: () => Promise.resolve(),
      }),
    },
    saidaSelecionada: '', nomesDosPeers: new Map(), telasAtivas: new Map(), focoAtual: 'peer',
    videoDestaque: { volume: 1 },
    inputVolumeDestaque: { value: '100', addEventListener: (_, callback) => { alterarVolume = callback; } },
    removerTelaCompartilhada() {},
  };
  contexto.registrarTelaCompartilhada = (id, nome, stream) => {
    contexto.telasAtivas.set(id, { nome, stream, volume: 1 });
    contexto.videoDestaque.srcObject = stream;
  };
  vm.createContext(contexto);
  vm.runInContext(tratarTrackRemota + '\n' + controleVolume, contexto);
  return { contexto, elementos, alterarVolume: () => alterarVolume() };
}

for (const ordem of [['audio', 'video'], ['video', 'audio']]) {
  test(`volume da tela com chegada ${ordem.join(' → ')}`, () => {
    const { contexto, elementos, alterarVolume } = preparar();
    const tracks = [];
    const stream = { id: 'tela', getVideoTracks: () => tracks.filter(t => t.kind === 'video') };
    for (const kind of ordem) {
      const track = { kind, addEventListener() {} };
      tracks.push(track);
      contexto.tratarTrackRemota('peer', { streams: [stream], track });
    }
    assert.equal(elementos.length, 1);
    assert.equal(elementos[0].muted, true, 'o card nao pode reproduzir o audio da tela');
    for (const volume of [0, 25, 100]) {
      contexto.inputVolumeDestaque.value = String(volume);
      alterarVolume();
      assert.equal(contexto.videoDestaque.volume, volume / 100);
      assert.equal(contexto.telasAtivas.get('peer').volume, volume / 100);
      assert.equal(elementos[0].muted, true);
    }
  });
}

test('microfone separado continua audivel', () => {
  const { contexto, elementos } = preparar();
  contexto.tratarTrackRemota('peer', {
    streams: [{ id: 'microfone', getVideoTracks: () => [] }],
    track: { kind: 'audio', addEventListener() {} },
  });
  assert.equal(elementos[0].muted, false);
});
