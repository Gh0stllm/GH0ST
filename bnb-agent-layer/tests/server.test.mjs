import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("read-only service exposes the page and guide but never issues undeployed quotes", async () => {
  const child = spawn(process.execPath, ["worker/server.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      GH0ST_BNB_CONFIG: new URL("../config.example.json", import.meta.url)
        .pathname,
      GH0ST_BNB_QUOTE_KEY: "",
      GH0ST_RELAY_KEY: "",
      ICP_IDENTITY_FILE: "",
      GH0ST_BNB_STATE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  try {
    const base = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(
        () => reject(Error("Service did not start: " + stderr)),
        10000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error(stderr));
      });
      child.stdout.on("data", (d) => {
        out += d;
        const m = /listening at (http:\/\/[^/]+)/.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
    });
    const cfg = await (await fetch(base + "/api/bnb/config")).json();
    assert.equal(cfg.ready, false);
    assert.equal(cfg.deployed, false);
    assert.match(await (await fetch(base + "/agents/")).text(), /Another way/);
    assert.match(
      await (await fetch(base + "/agents/llms.txt")).text(),
      /does not create/,
    );
    const image = await fetch(base + "/agents/mark.svg");
    assert.equal(image.headers.get("content-type"), "image/svg+xml");
    const quote = await fetch(base + "/api/bnb/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(quote.status, 503);
    assert.equal((await fetch(base + "/api/bnb/receipt?id=bad")).status, 400);
    assert.equal(
      (await fetch(base + "/agents/%2e%2e/package.json")).status,
      404,
    );
  } finally {
    const done = once(child, "exit");
    child.kill("SIGTERM");
    await done;
  }
});
