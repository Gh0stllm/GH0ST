import { createHash } from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";

// X v2 OpenAPI: https://docs.x.com/openapi.json (mediaUpload,
// CreateMediaMetadataMetadataAltText). No redirect or caller-supplied endpoint.
export const X_MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
export const X_MEDIA_METADATA_URL = "https://api.x.com/2/media/metadata";
export const MAX_AFTERIMAGE_BYTES = 5_000_000;
const SCHEMA = "gh0st-x-media-v1";
const SHA = /^[0-9a-f]{64}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const MEDIA_ID = /^[1-9][0-9]{0,18}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = value => createHash("sha256").update(value).digest("hex");
export function afterimageAltText(answer, proofUrl) {
  if (typeof answer !== "string" || !/^[\x20-\x7e]{1,8192}$/.test(answer) || answer.trim() !== answer)
    throw Error("Afterimage requires exact 1-8192 byte ASCII thought text");
  if (answer.length <= 1000) return answer;
  if (typeof proofUrl !== "string" || !/^https:\/\/robin\.etherscan\.io\/tx\/0x[0-9a-f]{64}$/.test(proofUrl))
    throw Error("A canonical RH proof URL is required for a thought longer than X alt text");
  return "GH0ST thought shown in full in this image. Full text on Robinhood: " + proofUrl;
}
const index = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`Invalid ${label}`);
  return value;
};

function pngDimensions(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw Error("Afterimage must contain a PNG image");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096)
    throw Error("Afterimage dimensions are out of bounds");
  let offset = 8, idat = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    if (length > MAX_AFTERIMAGE_BYTES || offset + 12 + length > bytes.length || !/^[A-Za-z]{4}$/.test(type))
      throw Error("Malformed Afterimage PNG");
    if (type === "acTL") throw Error("Afterimage must be a static PNG");
    if (type === "IDAT") idat = true;
    offset += length + 12;
    if (type === "IEND") { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!idat || !ended) throw Error("Malformed Afterimage PNG");
  return { width, height };
}

/** Public, deterministic journal metadata only; never includes PNG bytes or a token. */
export function afterimageMetadata(asset, { requireBytes = false } = {}) {
  if (!asset || asset.mimeType !== "image/png") throw Error("Afterimage must be image/png");
  const pngSha256 = asset.pngSha256 ?? asset.sha256;
  if (typeof pngSha256 !== "string" || !SHA.test(pngSha256) ||
      (asset.sha256 !== undefined && asset.sha256 !== pngSha256)) throw Error("Invalid Afterimage PNG hash");
  if (typeof asset.answerHash !== "string" || !HASH.test(asset.answerHash)) throw Error("Invalid Afterimage answer hash");
  const altText = asset.altText;
  const answer = asset.answer ?? altText;
  if (altText !== afterimageAltText(answer, asset.proofUrl) || keccak256(toUtf8Bytes(answer)) !== asset.answerHash)
    throw Error("Afterimage text differs from its answer hash or canonical accessibility text");
  if (typeof asset.rendererVersion !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(asset.rendererVersion))
    throw Error("Invalid Afterimage renderer version");
  if (typeof asset.fontSha256 !== "string" || !SHA.test(asset.fontSha256)) throw Error("Invalid Afterimage font hash");
  let byteLength = asset.byteLength;
  if (asset.bytes !== undefined) {
    if (!(asset.bytes instanceof Uint8Array)) throw Error("Invalid Afterimage PNG bytes");
    const bytes = Buffer.from(asset.bytes);
    byteLength = bytes.length;
    if (byteLength > MAX_AFTERIMAGE_BYTES) throw Error("Afterimage PNG exceeds 5 MB");
    if (digest(bytes) !== pngSha256) throw Error("Afterimage PNG hash differs from its bytes");
    const dimensions = pngDimensions(bytes);
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw Error("Afterimage PNG dimensions differ from metadata");
    if (asset.byteLength !== undefined && asset.byteLength !== byteLength) throw Error("Afterimage PNG size differs from metadata");
  } else if (requireBytes) throw Error("Afterimage PNG bytes are required");
  if (!Number.isSafeInteger(byteLength) || byteLength < 45 || byteLength > MAX_AFTERIMAGE_BYTES)
    throw Error("Invalid Afterimage PNG size");
  for (const value of [asset.width, asset.height])
    if (!Number.isSafeInteger(value) || value < 1 || value > 4096) throw Error("Invalid Afterimage dimensions");
  return Object.freeze({ mimeType: "image/png", pngSha256, answerHash: asset.answerHash,
    width: asset.width, height: asset.height, byteLength, altText,
    rendererVersion: asset.rendererVersion, fontSha256: asset.fontSha256,
    ...(answer !== altText ? { answer, proofUrl: asset.proofUrl } : {}) });
}

const binding = asset => ({ schema: SCHEMA, assetId: digest(JSON.stringify(asset)), ...asset });

async function request(url, body, token, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { method: "POST", redirect: "error",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: controller.signal });
        const length = response.headers?.get?.("content-length");
        if (length && Number(length) > 65536) throw Error("Oversized X media response");
        let parsed;
        if (response.body?.getReader) {
          const reader = response.body.getReader(); let size = 0; const chunks = [];
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              size += value.length; if (size > 65536) { await reader.cancel(); throw Error("Oversized X media response"); }
              chunks.push(Buffer.from(value));
            }
          } finally { reader.releaseLock(); }
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } else {
          parsed = await response.json();
          if (JSON.stringify(parsed).length > 65536) throw Error("Oversized X media response");
        }
        return { status: response.status, body: parsed };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(Error("X media request timed out"));
      }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** One upload and one metadata request at most. Caller must hold its journal lock;
 * persist must fsync before returning.
 * Resuming an in-flight request always holds for reconciliation; it never retries.
 * A saved upload_received state may attach metadata to that SAME media ID only.
 */
export async function uploadAfterimage({ asset, accessToken, token = accessToken, existing = null,
  persist, enabled = true, fetchImpl = globalThis.fetch, timeoutMs = 20_000, now = Date.now } = {}) {
  const metadata = afterimageMetadata(asset, { requireBytes: true });
  // Snapshot before the first await so caller mutation cannot alter uploaded bytes.
  const bytes = Buffer.from(asset.bytes), base = binding(metadata);
  if (existing) {
    for (const [key, value] of Object.entries(base))
      if (existing[key] !== value) throw Error("Journaled media belongs to a different Afterimage");
    if (!["uploading", "upload_received", "metadata_sending", "uploaded", "blocked", "needs_reconciliation", "disabled"].includes(existing.status))
      throw Error("Unrecognized X media journal state");
    if (["upload_received", "metadata_sending", "uploaded"].includes(existing.status) &&
        (!MEDIA_ID.test(existing.mediaId ?? "") || !Number.isSafeInteger(existing.expiresAt) || existing.expiresAt <= 0))
      throw Error("Invalid saved X media identifier or expiry");
    if (existing.status === "uploaded" && existing.altTextConfirmed !== true)
      throw Error("Saved X media lacks confirmed exact alt text");
    if (enabled !== true || ["blocked", "needs_reconciliation"].includes(existing.status)) return existing;
    if (existing.status === "uploaded" && existing.expiresAt > index(now(), "media timestamp")) return existing;
  }
  if (enabled !== true) return { ...base, status: "disabled" };
  if (typeof persist !== "function") throw Error("A durable media persistence callback is required");
  if (typeof token !== "string" || !token || /\s/.test(token)) throw Error("A user-context X media token is required");
  if (typeof fetchImpl !== "function") throw Error("fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error("Invalid X media timeout");
  const timestamp = index(now(), "media timestamp");
  const save = async state => { await persist(state); return state; };
  if (["uploading", "metadata_sending"].includes(existing?.status))
    return save({ ...existing, status: "needs_reconciliation", updatedAt: timestamp,
      reason: "A previous X media request may have completed; reconcile before retrying" });
  if (existing?.expiresAt !== undefined && existing.expiresAt <= timestamp)
    return save({ ...existing, status: "blocked", updatedAt: timestamp, reason: "Saved X media has expired; no automatic reupload" });
  let received = existing?.status === "upload_received" ? existing : null;
  if (!received) {
    if (existing && existing.status !== "disabled") throw Error("X media upload cannot be retried automatically");
    const intent = { ...base, status: "uploading", attempt: 1, startedAt: timestamp, updatedAt: timestamp };
    await save(intent);
    let response;
    try { response = await request(X_MEDIA_UPLOAD_URL, { media: bytes.toString("base64"), media_category: "tweet_image" }, token, fetchImpl, timeoutMs); }
    catch { return save({ ...intent, status: "needs_reconciliation", updatedAt: index(now(), "media timestamp"),
      reason: "X media upload outcome is unknown; do not reupload blindly" }); }
    const data = response.body?.data, expiry = data?.expires_after_secs;
    if (response.status !== 200 || !MEDIA_ID.test(data?.id ?? "") || !Number.isSafeInteger(expiry) || expiry < 1 ||
        !Number.isSafeInteger(timestamp + expiry * 1000) || (response.body?.errors?.length ?? 0) > 0 ||
        (data.processing_info && data.processing_info.state !== "succeeded") ||
        (data.image && (data.image.w !== metadata.width || data.image.h !== metadata.height))) {
      const rejected = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status) && !data?.id;
      const outcome = { ...intent, status: rejected ? "blocked" : "needs_reconciliation", httpStatus: response.status,
        updatedAt: index(now(), "media timestamp"), reason: rejected ? "X rejected media upload; review access or file" : "X media response is ambiguous; reconcile before retrying" };
      if (MEDIA_ID.test(data?.id ?? "")) outcome.mediaId = data.id;
      return save(outcome);
    }
    received = { ...intent, status: "upload_received", httpStatus: 200, mediaId: data.id,
      expiresAt: timestamp + expiry * 1000, updatedAt: index(now(), "media timestamp") };
    await save(received);
  }
  const intent = { ...received, status: "metadata_sending", metadataStartedAt: index(now(), "media timestamp") };
  await save(intent);
  let response;
  try { response = await request(X_MEDIA_METADATA_URL,
    { id: received.mediaId, metadata: { alt_text: { text: metadata.altText } } }, token, fetchImpl, timeoutMs); }
  catch { return save({ ...intent, status: "needs_reconciliation", updatedAt: index(now(), "media timestamp"),
    reason: "X media metadata outcome is unknown; reconcile before retrying" }); }
  const associatedAltText = response.body?.data?.associated_metadata?.alt_text;
  const success = response.status === 200 && response.body?.data?.id === received.mediaId &&
    !(response.body?.errors?.length > 0) &&
    (associatedAltText === undefined || associatedAltText?.text === metadata.altText);
  const rejected = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
  return save({ ...intent, status: success ? "uploaded" : rejected ? "blocked" : "needs_reconciliation",
    metadataHttpStatus: response.status, updatedAt: index(now(), "media timestamp"),
    ...(success ? { altTextConfirmed: true } : { reason: "X did not confirm exact media metadata; reconcile before publishing" }) });
}
