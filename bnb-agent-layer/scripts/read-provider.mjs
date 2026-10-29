import { spawn } from "node:child_process";
import { FetchRequest, JsonRpcProvider } from "ethers";

const readMethods = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getCode",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_getBlockByNumber",
  "eth_maxPriorityFeePerGas",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);
export function readProvider(url, expectedChainId) {
  const request = new FetchRequest(url);
  request.timeout = 25000;
  if (process.env.GH0ST_RPC_CURL === "1")
    request.getUrlFunc = async (req, signal) => {
      signal?.checkSignal();
      const parsed = JSON.parse(Buffer.from(req.body).toString()),
        items = Array.isArray(parsed) ? parsed : [parsed];
      if (items.some((x) => !readMethods.has(x.method)))
        throw Error("Read-only provider refuses RPC mutation");
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          "curl",
          [
            "--max-time",
            "20",
            "--silent",
            "--show-error",
            "--write-out",
            "\n%{http_code}",
            req.url,
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        let out = [],
          size = 0;
        child.stdout.on("data", (x) => {
          size += x.length;
          if (size > 2097152) {
            child.kill();
            reject(Error("RPC response exceeds 2 MiB"));
          } else out.push(x);
        });
        child.stderr.resume();
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(Buffer.concat(out))
            : reject(Error("RPC transport unavailable")),
        );
        child.stdin.end(Buffer.from(req.body));
      });
      signal?.checkSignal();
      const split = result.lastIndexOf(10),
        statusCode = Number(result.subarray(split + 1).toString());
      return {
        statusCode,
        statusMessage: String(statusCode),
        headers: { "content-type": "application/json" },
        body: result.subarray(0, split),
      };
    };
  return new JsonRpcProvider(request, expectedChainId, {
    cacheTimeout: -1,
    ...(expectedChainId ? { staticNetwork: true } : {}),
  });
}
