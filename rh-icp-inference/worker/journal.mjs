import fs from "node:fs";
import path from "node:path";
import { json } from "./protocol.mjs";
export function readJournal(file, binding, startBlock) {
  if (!fs.existsSync(file))
    return { version: 1, binding, nextBlock: startBlock, requests: [] };
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json(state.binding) !== json(binding) || state.version !== 1)
    throw Error("Journal belongs to another chain/gateway/canister");
  return state;
}
export function writeJournal(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file + ".tmp", "w", 0o600);
  try {
    fs.writeFileSync(fd, json(state) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(file + ".tmp", file);
}
export function unwrap(value) {
  if ("Err" in value) throw Error(value.Err);
  return value.Ok;
}
