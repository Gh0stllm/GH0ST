import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function compile() {
  const sources = Object.fromEntries(
    fs
      .readdirSync(path.join(root, "contracts"))
      .filter((x) => x.endsWith(".sol"))
      .map((x) => [
        x,
        { content: fs.readFileSync(path.join(root, "contracts", x), "utf8") },
      ]),
  );
  // Compile the unchanged origin gateway only for the two-chain integration test.
  sources["GH0STInferenceGateway.sol"] = {
    content: fs.readFileSync(
      path.join(
        root,
        "../rh-icp-inference/contracts/GH0STInferenceGateway.sol",
      ),
      "utf8",
    ),
  };
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "paris",
          outputSelection: {
            "*": {
              "*": [
                "abi",
                "evm.bytecode.object",
                "evm.deployedBytecode.object",
                "evm.deployedBytecode.immutableReferences",
              ],
            },
          },
        },
      }),
      {
        import: (p) => {
          try {
            return {
              contents: fs.readFileSync(
                path.join(root, "node_modules", p),
                "utf8",
              ),
            };
          } catch {
            return { error: `Missing import ${p}` };
          }
        },
      },
    ),
  );
  const errors = (output.errors ?? []).filter((x) => x.severity === "error");
  if (errors.length)
    throw Error(errors.map((x) => x.formattedMessage).join("\n"));
  return Object.fromEntries(
    Object.values(output.contracts)
      .flatMap((x) => Object.entries(x))
      .filter(([, c]) => c.evm.bytecode.object),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifacts = compile();
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  for (const [name, artifact] of Object.entries(artifacts))
    if (["GH0STAccess", "GH0STPassport"].includes(name)) {
      fs.writeFileSync(
        path.join(root, "build", name + ".json"),
        JSON.stringify(artifact, null, 2),
      );
      console.log(
        name,
        artifact.evm.deployedBytecode.object.length / 2,
        "runtime bytes",
      );
    }
}
