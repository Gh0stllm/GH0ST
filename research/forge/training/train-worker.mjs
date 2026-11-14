import { trainModel, TrainingCancelledError } from './core.mjs';

let active = null;
self.addEventListener('message', async ({ data }) => {
  if (data?.type === 'cancel') {
    if (active && (data.requestId === undefined || active.requestId === data.requestId)) active.cancelled = true;
    return;
  }
  if (data?.type !== 'train') return;
  if (active) {
    self.postMessage({ type: 'error', requestId: data.requestId, error: { name: 'BusyError', message: 'A training run is already active. Cancel it before starting another.' } });
    return;
  }
  const run = active = { requestId: data.requestId, cancelled: false };
  try {
    const result = await trainModel(data.dataset, data.options, {
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId: run.requestId, progress }),
      shouldCancel: () => run.cancelled,
    });
    if (!run.cancelled) self.postMessage({ type: 'result', requestId: run.requestId, result });
    else self.postMessage({ type: 'cancelled', requestId: run.requestId });
  } catch (error) {
    if (error instanceof TrainingCancelledError || run.cancelled) self.postMessage({ type: 'cancelled', requestId: run.requestId });
    else self.postMessage({ type: 'error', requestId: run.requestId, error: { name: error.name ?? 'Error', message: error.message ?? 'Training failed.' } });
  } finally {
    if (active === run) active = null;
  }
});
