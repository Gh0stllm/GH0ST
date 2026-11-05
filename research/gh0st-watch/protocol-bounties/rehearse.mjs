import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Principal } from '@icp-sdk/core/principal';

// Run from a disposable icp-cli project whose local checker is on the previous Wasm.
const [candidate] = process.argv.slice(2);
assert(candidate, 'Pass the absolute or relative candidate Wasm path.');
const cli = (...args) => execFileSync('icp', args, { encoding: 'utf8' });
const opts = ['-e', 'local', '--identity', 'gh0st-deployer'];
const host = cli('network', 'status', 'local').match(/Api Url:\s*(\S+)/)?.[1];
assert(host && ['localhost', '127.0.0.1'].includes(new URL(host).hostname), 'Local replica required.');
const status = JSON.parse(cli('canister', 'status', 'checker', '--json', ...opts));
const canisterId = status.id;
assert.notEqual(canisterId, 'ggcey-baaaa-aaaao-bbsgq-cai');
const upgrade = () => {
  cli('canister', 'stop', 'checker', ...opts);
  try {
    process.stdout.write(cli('canister', 'install', 'checker', '--mode', 'upgrade', '--wasm', resolve(candidate), ...opts));
  } finally {
    cli('canister', 'start', 'checker', ...opts);
  }
};

const config = IDL.Record({ name: IDL.Text, personality: IDL.Text, addresses: IDL.Vec(IDL.Text), tools: IDL.Vec(IDL.Text), daily_cap: IDL.Nat32 });
const activity = IDL.Record({ id: IDL.Nat64, at: IDL.Nat64, address: IDL.Text, status: IDL.Text, source_block: IDL.Opt(IDL.Nat64), source_at: IDL.Opt(IDL.Nat64), lines: IDL.Vec(IDL.Text), fee: IDL.Nat32 });
const project = IDL.Record({ owner: IDL.Principal, config, created_at: IDL.Nat64, updated_at: IDL.Nat64, activity: IDL.Vec(activity) });
const input = { title: IDL.Text, description: IDL.Text, category: IDL.Text, deadline: IDL.Opt(IDL.Nat64) };
const item = { id: IDL.Nat64, owner: IDL.Principal, title: IDL.Text, category: IDL.Text, deadline: IDL.Opt(IDL.Nat64), status: IDL.Text, created_at: IDL.Nat64, updated_at: IDL.Nat64 };
const submission = IDL.Record({ id: IDL.Nat64, submitter: IDL.Principal, proof_url: IDL.Text, note: IDL.Text, status: IDL.Text, created_at: IDL.Nat64, reviewed_at: IDL.Opt(IDL.Nat64) });
const bounty = IDL.Record({ ...item, description: IDL.Text, submissions: IDL.Vec(submission) });
const page = IDL.Record({ items: IDL.Vec(IDL.Record({ ...item, submission_count: IDL.Nat32 })), next: IDL.Opt(IDL.Nat64) });
const result = (value) => IDL.Variant({ Ok: value, Err: IDL.Text });
const idl = () => IDL.Service({
  spawn_get: IDL.Func([IDL.Principal], [IDL.Opt(project)], ['query']),
  bounty_list: IDL.Func([IDL.Opt(IDL.Nat64), IDL.Nat32], [page], ['query']),
  bounty_get: IDL.Func([IDL.Nat64], [IDL.Opt(bounty)], ['query']),
  bounty_create: IDL.Func([IDL.Record(input)], [result(bounty)], []),
  bounty_submit: IDL.Func([IDL.Nat64, IDL.Text, IDL.Text], [result(bounty)], []),
  bounty_review: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Bool], [result(bounty)], []),
  bounty_cancel: IDL.Func([IDL.Nat64], [result(bounty)], []),
  bounty_moderate: IDL.Func([IDL.Nat64, IDL.Bool], [result(IDL.Null)], []),
});
const actor = async (identity) => {
  const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
  await agent.fetchRootKey();
  return Actor.createActor(idl, { canisterId, agent });
};
const identities = Array.from({ length: 3 }, () => Ed25519KeyIdentity.generate());
const [reader, owner, worker, stranger] = await Promise.all([actor(), ...identities.map(actor)]);
const controller = Principal.fromText(status.settings.controllers[0]);
const existing = await reader.spawn_get(controller);
assert.equal(existing[0]?.config.name, 'Bounties upgrade rehearsal', 'Seed a Spawn profile before rehearsal.');
const verifySpawn = async () => assert.deepEqual(await reader.spawn_get(controller), existing);
const ok = (reply) => { assert('Ok' in reply, reply.Err); return reply.Ok; };
const refused = async (action) => {
  try { const reply = await action(); assert('Err' in reply, 'Unexpected success'); }
  catch (error) { if (!/inspect|reject|not authorized|denied/i.test(String(error))) throw error; }
};

upgrade();
await verifySpawn();
assert.deepEqual(await reader.bounty_list([], 20), { items: [], next: [] });
const task = { title: 'Write a Watcher evidence guide', description: 'Explain the scan evidence for a sample contract and link the source material.', category: 'content', deadline: [] };
await refused(() => reader.bounty_create(task));
const created = ok(await owner.bounty_create(task));
assert.equal(created.owner.toText(), identities[0].getPrincipal().toText());
const second = ok(await stranger.bounty_create({ ...task, title: 'Document a repeatable test' }));
const firstPage = await reader.bounty_list([], 1);
assert.equal(firstPage.items[0].id, second.id);
assert.deepEqual(firstPage.next, [second.id]);
assert.equal((await reader.bounty_list(firstPage.next, 1)).items[0].id, created.id);
await refused(() => worker.bounty_submit(created.id, 'javascript:alert(1)', 'Unsafe link'));
const proof = 'https://github.com/Gh0stllm/GH0ST';
const submitted = ok(await worker.bounty_submit(created.id, proof, 'The guide cites the public repository.'));
assert.equal(submitted.submissions[0].proof_url, proof);
assert.equal(submitted.submissions[0].status, 'pending');
const submissionId = submitted.submissions[0].id;
await refused(() => worker.bounty_review(created.id, submissionId, true));
await refused(() => worker.bounty_moderate(created.id, true));
await pause(11_000); // Exercise review and cancellation after the caller cooldown.
await refused(() => worker.bounty_submit(created.id, proof, 'Duplicate submission'));
const accepted = ok(await owner.bounty_review(created.id, submissionId, true));
assert.equal(accepted.status, 'completed');
assert.equal(accepted.submissions[0].status, 'approved');
assert.equal(ok(await stranger.bounty_cancel(second.id)).status, 'cancelled');
upgrade();
await verifySpawn();
assert.deepEqual(await reader.bounty_get(created.id), [accepted]);
const moderate = (hidden) => cli('canister', 'call', 'checker', 'bounty_moderate', `(${created.id} : nat64, ${hidden})`, ...opts);
assert.match(moderate(true), /Ok/);
assert.deepEqual(await reader.bounty_get(created.id), []);
assert(!(await reader.bounty_list([], 20)).items.some((item) => item.id === created.id));
assert.match(moderate(false), /Ok/);
assert.deepEqual(await reader.bounty_get(created.id), [accepted]);
console.log('Passed old-to-new and repeat upgrades, Spawn persistence, public pagination, authorization, proof validation, review, moderation and Bounties persistence.');
