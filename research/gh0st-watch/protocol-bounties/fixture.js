import { Principal } from '@icp-sdk/core/principal';

// This in-memory board is bundled only for localhost QA.
export function createFixture() {
  const owner = Principal.selfAuthenticating(Uint8Array.of(1));
  const other = Principal.selfAuthenticating(Uint8Array.of(2));
  const created = BigInt(Date.now() - 86_400_000);
  const records = [
    {
      id: 5n, owner, title: 'Document a Watcher finding', category: 'research',
      description: 'Pick a Robinhood Chain contract and write up one Watcher finding. Include the contract address, the evidence link, and any checks you could not run.',
      deadline: [], status: 'open', created_at: created, updated_at: created,
      submissions: [{
        id: 1n, submitter: other, proof_url: 'https://github.com/Gh0stllm/GH0ST',
        note: 'Example evidence link for the local fixture.', status: 'pending', created_at: created, reviewed_at: [],
      }],
    },
    {
      id: 4n, owner: other, title: 'Build a Spawn walkthrough', category: 'content',
      description: 'Record the steps to configure a GH0ST with AgentKit. Include a public demo and the settings you used.',
      deadline: [created + 604_800_000n], status: 'open', created_at: created, updated_at: created, submissions: [],
    },
    {
      id: 3n, owner: other, title: 'Map the roadmap links', category: 'other',
      description: 'Check the links and milestone descriptions on the GH0ST roadmap.',
      deadline: [], status: 'completed', created_at: created, updated_at: created, submissions: [],
    },
  ];
  let principal;
  let onChange = () => {};
  const get = id => records.find(bounty => bounty.id === id);
  function summary({ description, submissions, ...fields }) {
    return { ...fields, submission_count: submissions.length };
  }
  function touch(bounty) {
    bounty.updated_at = BigInt(Date.now());
    return bounty;
  }
  return {
    onSessionChange(callback) { onChange = callback; },
    async restore() { return principal; },
    async signIn() { principal = owner.toText(); onChange(principal); return principal; },
    async signOut() { principal = undefined; onChange(principal); },
    async list(cursor) {
      const page = records.filter(item => cursor === null || item.id < cursor).slice(0, 2);
      const last = page.at(-1)?.id;
      return { items: page.map(summary), next: records.some(item => item.id < last) ? last : null };
    },
    async get(id) { return get(id); },
    async create(input) {
      const bounty = touch({
        ...input, id: records[0].id + 1n, owner, status: 'open',
        created_at: BigInt(Date.now()), submissions: [],
      });
      records.unshift(bounty);
      return bounty;
    },
    async submit(id, proof_url, note) {
      const bounty = get(id);
      bounty.submissions.push({
        id: BigInt(bounty.submissions.length + 1), submitter: owner, proof_url, note, status: 'pending',
        created_at: BigInt(Date.now()), reviewed_at: [],
      });
      return touch(bounty);
    },
    async review(id, submissionId, approve) {
      const bounty = get(id);
      const submission = bounty.submissions.find(item => item.id === submissionId);
      submission.status = approve ? 'approved' : 'rejected';
      submission.reviewed_at = [BigInt(Date.now())];
      if (approve) bounty.status = 'completed';
      return touch(bounty);
    },
    async cancel(id) {
      const bounty = get(id);
      bounty.status = 'cancelled';
      return touch(bounty);
    },
  };
}
