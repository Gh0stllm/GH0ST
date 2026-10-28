import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { renderAfterimage, AFTERIMAGE_FONT, AFTERIMAGE_FONT_SHA256,
  AFTERIMAGE_PYTHON, AFTERIMAGE_VERSION, LONG_AFTERIMAGE_VERSION } from "../worker/afterimage.mjs";

const available = fs.existsSync(AFTERIMAGE_PYTHON) && fs.existsSync(AFTERIMAGE_FONT);
const sample = "the receipt is a ghost in the machine, and i'm already late for the next swap.";
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const reconstructed = image => image.layout.lines.map(line => line.text + line.separator).join("");
let samplePromise;
const sampleImage = () => samplePromise ??= renderAfterimage({ answer: sample });

test("Afterimage rejects invalid or changed committed text before starting the renderer", async () => {
  for (const answer of ["", "x".repeat(8193), " " + sample, sample + " ", sample + "\n", sample + "é"])
    await assert.rejects(renderAfterimage({ answer, pythonPath: "/not-used" }), /exact 1-8192/);
  await assert.rejects(renderAfterimage({ answer: sample, answerHash: "0x" + "ab".repeat(32), pythonPath: "/not-used" }), /committed answer hash/);
  await assert.rejects(renderAfterimage({ answer: sample, outputPath: "relative.png", pythonPath: "/not-used" }), /absolute PNG/);
  await assert.rejects(renderAfterimage({ answer: sample, outputPath: "/tmp/wrong.jpg", pythonPath: "/not-used" }), /absolute PNG/);
});

test("Afterimage preserves newly allowed short and long thoughts in a bounded complete image", { skip: !available }, async () => {
  const proofUrl = "https://robin.etherscan.io/tx/0x" + "ab".repeat(32);
  for (const answer of ["I", "w".repeat(181), "a ".repeat(140).trim(), "w".repeat(1001), "w".repeat(8192)]) {
    const image = await renderAfterimage({ answer, proofUrl });
    assert.equal(image.rendererVersion, LONG_AFTERIMAGE_VERSION);
    assert.equal(reconstructed(image), answer);
    assert.equal(image.answerHash, keccak256(toUtf8Bytes(answer)));
    assert.equal(image.width, 1200); assert.ok(image.height >= 1200 && image.height <= 4096);
    assert.ok(image.layout.inkBottom < image.height - 140);
    assert.ok(image.layout.inkRight <= 1050); assert.ok(image.bytes.length < 5_000_000);
    if (answer.length <= 1000) assert.equal(image.altText, answer);
    else {
      assert.equal(image.altText, "GH0ST thought shown in full in this image. Full text on Robinhood: " + proofUrl);
      assert.equal(image.metadata.proofUrl, proofUrl);
    }
  }
  await assert.rejects(renderAfterimage({ answer: "w".repeat(1001), pythonPath: "/not-used" }), /canonical RH proof URL/);
});

test("Afterimage reports missing local renderer without network or fallback image generation", async () => {
  await assert.rejects(renderAfterimage({ answer: sample, pythonPath: "/missing-afterimage-python" }), /Local Afterimage renderer failed/);
});

test("Afterimage creates the pinned 1200-square PNG and immutable exact-text metadata", { skip: !available }, async () => {
  const image = await sampleImage();
  assert.equal(image.rendererVersion, AFTERIMAGE_VERSION);
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.width, 1200); assert.equal(image.height, 1200);
  assert.equal(image.bytes.readUInt32BE(16), 1200); assert.equal(image.bytes.readUInt32BE(20), 1200);
  assert.equal(image.altText, sample); assert.equal(image.answer, sample);
  assert.equal(image.answerHash, keccak256(toUtf8Bytes(sample)));
  assert.equal(image.pngSha256, digest(image.bytes)); assert.equal(image.sha256, image.pngSha256);
  assert.equal(image.fontSha256, AFTERIMAGE_FONT_SHA256);
  assert.equal(image.fontSha256, digest(fs.readFileSync(AFTERIMAGE_FONT)));
  assert.equal(image.layout.fontSize, 67);
  assert.equal(image.layout.x, 140); assert.equal(image.layout.y, 430); assert.equal(image.layout.wrapWidth, 910);
  assert.ok(image.layout.inkBottom <= 1010); assert.ok(image.layout.inkRight <= 1050);
  assert.equal(reconstructed(image), sample);
  assert.equal(image.pngSha256, "bde99165e9256c6563de9009eebee2ecb3fbc147cd022dde8b6a3220bfacfb06");
});

test("Afterimage is byte-for-byte reproducible without timestamps or random pixel data", { skip: !available }, async () => {
  const first = await sampleImage(), second = await renderAfterimage({ answer: sample });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.metadataSha256, second.metadataSha256);
  assert.deepEqual(first.metadata, second.metadata);
});

test("Afterimage shrinks a maximum-length unbroken thought without truncating it", { skip: !available }, async () => {
  const answer = "w".repeat(180), image = await renderAfterimage({ answer });
  assert.equal(reconstructed(image), answer);
  assert.equal(image.altText.length, 180);
  assert.ok(image.layout.fontSize < 67 && image.layout.fontSize >= 24);
  assert.ok(image.layout.inkBottom <= 1010); assert.ok(image.layout.inkRight <= 1050);
  assert.ok(image.layout.textDots > 1000);
});

test("Afterimage preserves case, punctuation and repeated internal spaces exactly", { skip: !available }, async () => {
  const answer = "A small spoon  has filed two  complaints; gravity replied, 'no.'";
  const image = await renderAfterimage({ answer });
  assert.equal(reconstructed(image), answer);
  assert.equal(image.answerHash, keccak256(toUtf8Bytes(answer)));
  assert.equal(image.altText, answer);
});

test("Afterimage writes private deterministic assets and refuses different existing content", { skip: !available }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-afterimage-"));
  try {
    const outputPath = path.join(folder, "job.png");
    const image = await renderAfterimage({ answer: sample, outputPath });
    assert.equal(image.path, outputPath); assert.equal(image.metadataPath, outputPath + ".json");
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(image.metadataPath).mode & 0o777, 0o600);
    assert.equal(digest(fs.readFileSync(image.metadataPath)), image.metadataSha256);
    assert.deepEqual(JSON.parse(fs.readFileSync(image.metadataPath)), image.metadata);
    const repeated = await renderAfterimage({ answer: sample, outputPath });
    assert.equal(repeated.pngSha256, image.pngSha256);
    fs.writeFileSync(outputPath, "preserve this conflicting file");
    await assert.rejects(renderAfterimage({ answer: sample, outputPath }), /Existing Afterimage asset differs/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "preserve this conflicting file");
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("Afterimage does not follow an output symlink", { skip: !available }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-afterimage-link-"));
  try {
    const target = path.join(folder, "target"), outputPath = path.join(folder, "job.png");
    fs.writeFileSync(target, "unchanged"); fs.symlinkSync(target, outputPath);
    await assert.rejects(renderAfterimage({ answer: sample, outputPath }), /Existing Afterimage asset differs/);
    assert.equal(fs.readFileSync(target, "utf8"), "unchanged");
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
