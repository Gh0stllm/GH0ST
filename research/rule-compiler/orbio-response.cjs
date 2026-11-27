'use strict';

// The completion token limit does not cover the HTTP envelope or metadata.
const MAX_RESPONSE_BYTES = 32 * 1024;

async function readBoundedJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('Invalid response byte limit.');
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Error('Orbio returned HTTP ' + response.status + '.');
  }
  if (!response.body) throw Error('Orbio returned an empty response.');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw Error('Orbio response exceeded the byte limit.');
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read().catch(() => {
        throw Error('Orbio response could not be read.');
      });
      if (done) break;
      // Fetch exposes decoded bytes. Enforce the cap even without a declared size.
      if (value.byteLength > maxBytes - length) {
        await reader.cancel().catch(() => {});
        throw Error('Orbio response exceeded the byte limit.');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return JSON.parse(text);
  } catch {
    throw Error('Orbio returned an invalid JSON response.');
  }
}

module.exports = { MAX_RESPONSE_BYTES, readBoundedJson };
