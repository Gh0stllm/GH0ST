import fs from "node:fs";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
const filename = process.argv[2];
if (!filename)
  throw Error("Provide an identity filename outside the repository");
const identity = Ed25519KeyIdentity.generate();
fs.writeFileSync(filename, JSON.stringify(identity.toJSON()) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(identity.getPrincipal().toText());
