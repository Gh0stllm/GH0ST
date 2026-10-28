import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => {
  const p = spawnSync("cargo", args, {
    cwd: path.join(root, "coordinator"),
    stdio: "inherit",
  });
  if (p.error) throw p.error;
  if (p.status !== 0) process.exit(p.status ?? 1);
};
run(["test", "--locked"]);
run(["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"]);
function leb(n) {
  const a = [];
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    a.push(b);
  } while (n);
  return Buffer.from(a);
}
const input = fs.readFileSync(
  path.join(
    root,
    "coordinator/target/wasm32-unknown-unknown/release/gh0st_icp_coordinator.wasm",
  ),
);
const name = Buffer.from("icp:public candid:service");
const candid = fs.readFileSync(path.join(root, "coordinator/coordinator.did"));
const section = Buffer.concat([leb(name.length), name, candid]);
const output = Buffer.concat([
  input,
  Buffer.from([0]),
  leb(section.length),
  section,
]);
if (!WebAssembly.validate(output)) throw Error("Invalid coordinator Wasm");
fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build/coordinator.wasm"), output);
console.log(
  `Coordinator Wasm built with Candid metadata (${output.length} bytes).`,
);
