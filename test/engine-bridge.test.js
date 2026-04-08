import { test } from 'node:test';
import assert from 'node:assert';
import { createEngineBridge } from '../engine/engine-bridge.js';

class FakeWorker {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }
  postMessage(line) {
    this.sent.push(line);
    // Simulate Stockfish responses for the lines we care about.
    queueMicrotask(() => {
      if (line === 'uci') {
        this._send('id name Fakefish');
        this._send('uciok');
      } else if (line === 'isready') {
        this._send('readyok');
      } else if (line.startsWith('go ')) {
        this._send('info depth 5 score cp 23 pv e2e4 e7e5 g1f3');
        this._send('info depth 6 score cp 27 pv e2e4 e7e5 g1f3 b8c6');
        this._send('bestmove e2e4 ponder e7e5');
      }
    });
  }
  _send(text) {
    if (this.onmessage) this.onmessage({ data: text });
  }
  terminate() {}
}

test('bridge exposes setOptions / analyze / stop', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  assert.ok(w.sent.includes('uci'));
  assert.ok(w.sent.includes('isready'));
});

test('setOptions sends LimitStrength + Elo when limited', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.setOptions({ elo: 1800, limitStrength: true });
  assert.ok(w.sent.includes('setoption name UCI_LimitStrength value true'));
  assert.ok(w.sent.includes('setoption name UCI_Elo value 1800'));
});

test('setOptions disables LimitStrength when unlimited', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.setOptions({ limitStrength: false });
  assert.ok(w.sent.includes('setoption name UCI_LimitStrength value false'));
});

test('analyze emits info events and resolves with bestmove', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  const infos = [];
  const result = await bridge.analyze(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    { mode: 'time', value: 100 },
    info => infos.push(info)
  );
  assert.ok(infos.length >= 2);
  assert.equal(infos.at(-1).depth, 6);
  assert.equal(infos.at(-1).scoreCp, 27);
  assert.deepEqual(infos.at(-1).pv, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
  assert.equal(result.bestmove, 'e2e4');
});

test('stop sends stop command', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  bridge.stop();
  assert.ok(w.sent.includes('stop'));
});

test('analyze with depth mode sends go depth', async () => {
  const w = new FakeWorker();
  const bridge = createEngineBridge(w);
  await bridge.ready();
  await bridge.analyze(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    { mode: 'depth', value: 12 },
    () => {}
  );
  assert.ok(w.sent.some(l => l === 'go depth 12'));
});
