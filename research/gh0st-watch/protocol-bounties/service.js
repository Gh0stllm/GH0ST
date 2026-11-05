import { AuthClient } from '@icp-sdk/auth/client';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';

export function idlFactory({ IDL }) {
  const fields = {
    id: IDL.Nat64,
    owner: IDL.Principal,
    title: IDL.Text,
    category: IDL.Text,
    deadline: IDL.Opt(IDL.Nat64),
    status: IDL.Text,
    created_at: IDL.Nat64,
    updated_at: IDL.Nat64,
  };
  const Submission = IDL.Record({
    id: IDL.Nat64,
    submitter: IDL.Principal,
    proof_url: IDL.Text,
    note: IDL.Text,
    status: IDL.Text,
    created_at: IDL.Nat64,
    reviewed_at: IDL.Opt(IDL.Nat64),
  });
  const Summary = IDL.Record({ ...fields, submission_count: IDL.Nat32 });
  const Bounty = IDL.Record({ ...fields, description: IDL.Text, submissions: IDL.Vec(Submission) });
  const BountyPage = IDL.Record({ items: IDL.Vec(Summary), next: IDL.Opt(IDL.Nat64) });
  const Input = IDL.Record({
    title: IDL.Text, description: IDL.Text, category: IDL.Text, deadline: IDL.Opt(IDL.Nat64),
  });
  const Result = IDL.Variant({ Ok: Bounty, Err: IDL.Text });
  return IDL.Service({
    bounty_list: IDL.Func([IDL.Opt(IDL.Nat64), IDL.Nat32], [BountyPage], ['query']),
    bounty_get: IDL.Func([IDL.Nat64], [IDL.Opt(Bounty)], ['query']),
    bounty_create: IDL.Func([Input], [Result], []),
    bounty_submit: IDL.Func([IDL.Nat64, IDL.Text, IDL.Text], [Result], []),
    bounty_review: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Bool], [Result], []),
    bounty_cancel: IDL.Func([IDL.Nat64], [Result], []),
  });
}

export class BountyError extends Error {}

function unwrap(result) {
  if ('Err' in result) throw new BountyError(result.Err);
  return result.Ok;
}

export function createService() {
  let auth;
  let onSessionChange;
  const currentPrincipal = () => auth?.getPrincipal()?.toText();
  function getAuth() {
    if (!auth) {
      auth = new AuthClient({
        namespace: 'gh0st-bounties',
        agentOptions: { host: BOUNTIES_IC_HOST },
      });
      auth.subscribe(() => onSessionChange?.(currentPrincipal()));
    }
    return auth;
  }
  const actorFor = identity => Actor.createActor(idlFactory, {
    agent: HttpAgent.createSync({ host: BOUNTIES_IC_HOST, identity }),
    canisterId: BOUNTIES_CANISTER_ID,
  });
  const publicActor = actorFor();
  async function update(method, args, expectedPrincipal) {
    const identity = await getAuth().getIdentity();
    const owner = identity.getPrincipal();
    if (owner.isAnonymous() || owner.toText() !== expectedPrincipal || owner.toText() !== currentPrincipal()) {
      throw new BountyError('Your sign-in session changed. Sign in again before posting.');
    }
    return unwrap(await actorFor(identity)[method](...args));
  }
  return {
    async restore() {
      await getAuth().getIdentity();
      return currentPrincipal();
    },
    async signIn() {
      await getAuth().signIn();
      return currentPrincipal();
    },
    async signOut() {
      await getAuth().signOut();
      return currentPrincipal();
    },
    onSessionChange(callback) {
      onSessionChange = callback;
    },
    async list(cursor) {
      const { items, next } = await publicActor.bounty_list(cursor === null ? [] : [cursor], 20);
      return { items, next: next[0] ?? null };
    },
    async get(id) {
      return (await publicActor.bounty_get(id))[0];
    },
    create(input, principal) { return update('bounty_create', [input], principal); },
    submit(id, url, note, principal) { return update('bounty_submit', [id, url, note], principal); },
    review(id, submission, approve, principal) {
      return update('bounty_review', [id, submission, approve], principal);
    },
    cancel(id, principal) { return update('bounty_cancel', [id], principal); },
  };
}
