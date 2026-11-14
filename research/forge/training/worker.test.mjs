import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { generateNpcDataset } from './core.mjs';

test('real worker reports progress, rejects concurrent jobs, cancels, and accepts a subsequent run', async () => {
  const moduleUrl = new URL('./train-worker.mjs', import.meta.url).href;
  const bridge = `import {parentPort} from 'node:worker_threads'; globalThis.self = {addEventListener(type, listener) { if(type === 'message') parentPort.on('message', data => listener({data})); },postMessage(message) { parentPort.postMessage(message); }}; await import(${JSON.stringify(moduleUrl)});`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bridge)}`));
  const dataset = generateNpcDataset({ rows: 180 });
  const messages = [];
  let timeout;
  try {
    await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Worker cancellation test timed out.')), 10_000);
      worker.on('error', reject);
      worker.on('message', (message) => {
        messages.push(message);
        if (message.type === 'progress' && message.requestId === 'cancel-me') worker.postMessage({ type: 'cancel', requestId: 'cancel-me' });
        if (message.type === 'cancelled' && message.requestId === 'cancel-me') worker.postMessage({ type: 'train', requestId: 'finish-me', dataset, options: { epochs: 2 } });
        if (message.type === 'error' && message.requestId === 'finish-me') reject(new Error(message.error.message));
        if (message.type === 'result' && message.requestId === 'finish-me') resolve();
      });
      worker.postMessage({ type: 'train', requestId: 'cancel-me', dataset, options: { epochs: 300 } });
      worker.postMessage({ type: 'train', requestId: 'busy', dataset, options: { epochs: 1 } });
    });
    assert.ok(messages.some((message) => message.type === 'progress' && message.requestId === 'cancel-me'));
    assert.ok(messages.some((message) => message.type === 'error' && message.requestId === 'busy' && message.error.name === 'BusyError'));
    assert.ok(messages.some((message) => message.type === 'cancelled' && message.requestId === 'cancel-me'));
    assert.equal(messages.some((message) => message.type === 'result' && message.requestId === 'cancel-me'), false);
    const result = messages.find((message) => message.type === 'result' && message.requestId === 'finish-me');
    assert.ok(result.result.model.modelHash.startsWith('0x'));
    assert.equal(result.result.model.training.epochs, 2);
  } finally {
    clearTimeout(timeout);
    await worker.terminate();
  }
});
