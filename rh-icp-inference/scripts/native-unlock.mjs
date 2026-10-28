import { execFile } from "node:child_process";

// The password travels only from the local secure text field into the signer
// process's memory. Never print the child output, attach it to an error, or
// accept it through command arguments, environment variables or a file.
const purposes = Object.freeze({
  initial: "Unlock your existing RH wallet for the approved GH0ST test: register the Pons pool, make one 0.00001 ETH swap, and record the exact ICP thought.",
  successor: "Unlock your existing RH wallet to deploy the corrected GH0ST callback contract, register the existing pools, and record the ICP thought for your already-confirmed swap. No new swap will be made.",
  worker: "Unlock the dedicated GH0ST callback wallet for this run. It can only record verified ICP thoughts for confirmed Pons buys, within the configured fee limit. Your main wallet stays locked.",
  createWorker: "Choose a new password for the dedicated GH0ST callback wallet. Keep it in your password manager: it is needed when the worker restarts. This creates an encrypted wallet file; it does not send funds.",
  fundWorker: "Unlock your existing RH wallet for the reviewed one-time 0.00005 ETH transfer to the dedicated GH0ST callback wallet, plus at most 0.00000105 ETH in network fees. It does not make a swap or give the worker access to your main wallet.",
  recovery: "Unlock your existing RH wallet to deploy the reviewed GH0ST recovery callback contract and register the same Pons pool. No swap or ETH transfer will be made. Combined network fees are capped at 0.0002625 ETH. Your main wallet will be locked again after these two actions.",
});

export function nativeMacPasswordPrompt({ platform = process.platform, run = execFile, purpose = "initial" } = {}) {
  if (platform !== "darwin") return Promise.reject(new Error("The local wallet unlock window requires macOS."));
  if (!Object.hasOwn(purposes, purpose)) return Promise.reject(new Error("The wallet unlock purpose is invalid."));
  const action = purpose === "createWorker" ? "Create wallet" : "Unlock";
  const promptScript = `
set answer to display dialog "${purposes[purpose]} The password stays in this local process and is not saved." default answer "" with hidden answer buttons {"Cancel", "${action}"} default button "${action}" cancel button "Cancel" with title "GH0ST wallet unlock"
return text returned of answer
`;
  return new Promise((resolve, reject) => {
    run("/usr/bin/osascript", ["-e", promptScript], {
      encoding: "utf8", timeout: 180_000, maxBuffer: 8192, windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        stdout = undefined;
        reject(new Error("The local wallet unlock was cancelled or could not complete. No password was saved."));
        return;
      }
      // osascript adds a record terminator. Preserve spaces in the password.
      const password = typeof stdout === "string" ? stdout.replace(/\r?\n$/, "") : "";
      stdout = undefined;
      if (!password.length || password.length > 4096 || /[\r\n\0]/.test(password)) {
        reject(new Error("The local wallet password entry was empty or invalid. No password was saved."));
        return;
      }
      resolve(password);
    });
  });
}
