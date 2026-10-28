import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFile as execFileCallback} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

const execFile = promisify(execFileCallback);
const moduleUrl = new URL("../worker/afterimage.mjs", import.meta.url).href;
const root = fileURLToPath(new URL("../", import.meta.url));
const defaultPython = "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const defaultFont = "/System/Library/Fonts/Menlo.ttc";
const pinnedFont = "f2d400484a6aace67980730ec0a9ef24ce9e535a2604f118e6fdc2510021b85f";
const sample = "the receipt is a ghost in the machine, and i'm already late for the next swap.";
const probe = async (body, overrides = {}) => {
  const env = {...process.env};
  for (const key of ["GH0ST_AFTERIMAGE_PYTHON", "GH0ST_AFTERIMAGE_FONT", "GH0ST_SERVER_LEGACY_ONLY"])
    delete env[key];
  Object.assign(env, overrides);
  const {stdout} = await execFile(process.execPath, ["--input-type=module", "-e",
    `const m=await import(${JSON.stringify(moduleUrl)});${body}`],
    {cwd: root, env, timeout: 60000, maxBuffer: 1024 * 1024});
  return stdout.trim() ? JSON.parse(stdout) : null;
};

test("server renderer keeps the exact legacy Python source bytes", () => {
  const source = fs.readFileSync(new URL("../worker/afterimage.mjs", import.meta.url), "utf8");
  const python = source.split("const PYTHON = String.raw`")[1].split("`;")[0];
  assert.equal(crypto.createHash("sha256").update(python).digest("hex"),
    "0c4099bd4087f339b4b91c3ebcaddd3800779896bc2119922f1756ed785a4279");
});

test("server renderer defaults remain the existing Mac paths and pinned font", async () => {
  const result = await probe("console.log(JSON.stringify({python:m.AFTERIMAGE_PYTHON,font:m.AFTERIMAGE_FONT,fontSha:m.AFTERIMAGE_FONT_SHA256}));");
  assert.deepEqual(result, {python: defaultPython, font: defaultFont, fontSha: pinnedFont});
});

test("server renderer accepts explicit absolute Linux paths without changing the font hash", async () => {
  const result = await probe("console.log(JSON.stringify({python:m.AFTERIMAGE_PYTHON,font:m.AFTERIMAGE_FONT,fontSha:m.AFTERIMAGE_FONT_SHA256}));",
    {GH0ST_AFTERIMAGE_PYTHON: "/opt/gh0st/bin/afterimage-python", GH0ST_AFTERIMAGE_FONT: "/opt/gh0st/private-assets/Menlo.ttc"});
  assert.deepEqual(result, {python: "/opt/gh0st/bin/afterimage-python", font: "/opt/gh0st/private-assets/Menlo.ttc", fontSha: pinnedFont});
});

test("server renderer rejects relative paths and invalid deployment modes", async () => {
  for (const env of [{GH0ST_AFTERIMAGE_PYTHON: "python3"}, {GH0ST_AFTERIMAGE_FONT: "fonts/Menlo.ttc"},
    {GH0ST_AFTERIMAGE_PYTHON: ""}, {GH0ST_SERVER_LEGACY_ONLY: "yes"}])
    await assert.rejects(probe("", env), /absolute local path|must be 0 or 1/);
});

test("legacy-only migration rejects newly allowed lengths before starting Python", async () => {
  const result = await probe(`const outcomes=[];for(const length of [0,1,29,181,8192]){try{await m.renderAfterimage({answer:'w'.repeat(length),pythonPath:'/must-not-run'});outcomes.push('accepted');}catch(e){outcomes.push(e.message);}}console.log(JSON.stringify(outcomes));`,
    {GH0ST_SERVER_LEGACY_ONLY: "1"});
  assert.equal(result.length, 5);
  for (const value of result) assert.match(value, /live 30-180 character thought bound/);
});

test("legacy-only migration allows both live range boundaries past the length guard", async () => {
  const result = await probe(`const outcomes=[];for(const length of [30,180]){try{await m.renderAfterimage({answer:'w'.repeat(length),pythonPath:'/missing-renderer'});}catch(e){outcomes.push(e.message);}}console.log(JSON.stringify(outcomes));`,
    {GH0ST_SERVER_LEGACY_ONLY: "1"});
  assert.equal(result.length, 2);
  for (const value of result) assert.match(value, /Local Afterimage renderer failed/);
});

test("explicit paths plus legacy-only mode reproduce the existing pinned short PNG", {
  skip: !fs.existsSync(defaultPython) || !fs.existsSync(defaultFont),
}, async () => {
  const result = await probe(`const image=await m.renderAfterimage({answer:${JSON.stringify(sample)}});console.log(JSON.stringify({sha:image.pngSha256,version:image.rendererVersion,font:image.fontSha256,width:image.width,height:image.height}));`,
    {GH0ST_AFTERIMAGE_PYTHON: defaultPython, GH0ST_AFTERIMAGE_FONT: defaultFont, GH0ST_SERVER_LEGACY_ONLY: "1"});
  assert.deepEqual(result, {sha: "bde99165e9256c6563de9009eebee2ecb3fbc147cd022dde8b6a3220bfacfb06",
    version: "gh0st-afterimage-v1", font: pinnedFont, width: 1200, height: 1200});
});
