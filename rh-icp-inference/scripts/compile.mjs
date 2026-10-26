import fs from "node:fs";
import solc from "solc";
export function compile() {
  const name = "GH0STInferenceGateway";
  const source = fs.readFileSync(
    new URL("../contracts/" + name + ".sol", import.meta.url),
    "utf8",
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { [name + ".sol"]: { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris",
          outputSelection: {
            "*": {
              "*": [
                "abi",
                "evm.bytecode.object",
                "evm.deployedBytecode.object",
              ],
            },
          },
        },
      }),
    ),
  );
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return output.contracts[name + ".sol"][name];
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.mkdirSync(new URL("../build/", import.meta.url), { recursive: true });
  fs.writeFileSync(
    new URL("../build/gateway.json", import.meta.url),
    JSON.stringify(compile(), null, 2),
  );
  console.log("Gateway compiled (Solidity 0.8.30, optimizer 200, Paris EVM).");
}
