// Decodes gh0st-mp1-qpack-v1 to the publisher's Float32Array tensor map.
function finiteHalf(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) throw new Error("Nonfinite weight scale");
  if (exponent === 0) return sign * fraction * 2 ** -24;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export function decodeWeights(metadata, bytes) {
  if (metadata.format !== "gh0st-mp1-qpack-v1" || metadata.bytes !== bytes.byteLength) {
    throw new Error("Model format or length differs from the metadata");
  }
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const tensors = Object.create(null);
  for (const tensor of metadata.tensors) {
    const count = tensor.shape.reduce((a, b) => a * b, 1);
    const values = new Float32Array(count);
    if (tensor.dtype === "float32") {
      for (let i = 0; i < count; i++) values[i] = view.getFloat32(tensor.offset + i * 4, true);
    } else {
      const [, columns] = tensor.shape;
      const bits = Number(tensor.dtype.slice(3));
      if (![4, 5].includes(bits) || bits !== metadata.bits ||
          tensor.scaleCount !== tensor.shape[0] * Math.ceil(columns / tensor.group) ||
          tensor.length !== Math.ceil(count / 8) * bits) {
        throw new Error("Malformed quantized tensor " + tensor.name);
      }
      const midpoint = 1 << (bits - 1);
      const mask = (1 << bits) - 1;
      const packed = raw.subarray(tensor.offset, tensor.offset + tensor.length);
      const scales = new Float32Array(tensor.scaleCount);
      for (let i = 0; i < scales.length; i++) {
        scales[i] = finiteHalf(view.getUint16(tensor.scaleOffset + i * 2, true));
      }
      const groupsPerRow = Math.ceil(columns / tensor.group);
      for (let row = 0; row < tensor.shape[0]; row++) {
        for (let col = 0; col < columns; col++) {
          const i = row * columns + col;
          const bit = i * bits;
          const offset = bit >>> 3;
          const word = packed[offset] | ((packed[offset + 1] ?? 0) << 8);
          const code = ((word >>> (bit & 7)) & mask) - midpoint;
          const scale = scales[row * groupsPerRow + Math.floor(col / tensor.group)];
          values[i] = code * scale;
        }
      }
    }
    tensors[tensor.name] = values;
  }
  return tensors;
}

export function decodeVocabulary(bytes, baseId) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!decoded.endsWith("\0")) throw new Error("Incomplete vocabulary");
  const words = decoded.slice(0, -1).split("\0");
  return Object.assign(Object.create(null), Object.fromEntries(words.map((word, i) => [word, baseId + i])));
}
