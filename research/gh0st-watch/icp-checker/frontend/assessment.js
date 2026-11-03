// Every card is derived from one scan or its bounded explorer lookups.
// Undefined intel means the lookup is pending; null means it could not be completed.
const card = (label, value, detail, tone = 'neutral') => ({label, value, detail, tone});
const plural = (count, singular, multiple = singular + 's') => count === 1 ? singular : multiple;

function behavior(rules) {
  const hits = rules.filter(rule => rule.status === 'Reproduced');
  const tested = rules.filter(rule => ['Reproduced', 'Not reproduced'].includes(rule.status));
  const pending = rules.length - tested.length;
  const coverage = card('Behavior checks', `${tested.length} of ${rules.length} ran`,
    `${hits.length} reproduced · ${pending} untested`, hits.length ? 'attention' : 'neutral');

  if (hits.length) {
    const evidence = hits.map(hit => `${hit.title} (${hit.scope})`).join(', ');
    return {title: `${hits.length} ${plural(hits.length, 'behavior')} reproduced`,
      description: `The tests reproduced ${evidence}. Review the observed state changes against the intended contract behavior.`, coverage};
  }
  if (!tested.length) {
    return {title: 'Behavior untested', description: 'None of the behavior checks produced an execution result. Each rule lists the prerequisite or evidence it still needs.', coverage};
  }
  if (pending) {
    return {title: 'Partial behavior coverage',
      description: `The ${plural(tested.length, 'completed check', 'completed checks')} did not reproduce the target behavior. ${pending} of ${rules.length} ${plural(pending, 'rule remains', 'rules remain')} untested.`, coverage};
  }
  return {title: 'No target behavior reproduced', description: `All ${tested.length} checks ran. Their results cover the specific calls, inputs and state shown in the report.`, coverage};
}

function source(r) {
  if (!r.verified) return card('Source verification', 'Unconfirmed', 'No verified explorer bytecode match was available at the scan block.');
  return card('Source verification', r.proxy && !r.proxyError ? 'Implementation matched' : 'Bytecode matched',
    'The explorer’s verified bytecode matches the code inspected at the scan block.', 'observed');
}

function history(intel) {
  const label = 'Deployer history';
  const h = intel?.origin?.history;
  if (!h) return card(label, intel === undefined ? 'Checking…' : 'Unavailable',
    intel === undefined ? 'Looking up the creation receipt and earlier deployments.' : 'Wallet attribution or its deployment history could not be retrieved.');
  const examples = h.items || [];
  const bySender = examples.filter(item => ['Wallet creation', 'Same wallet via factory'].includes(item.kind)).length;
  if (bySender) return card(label, `${bySender} earlier ${plural(bySender, 'creation')}`,
    'Attributed to the transaction sender in the returned history. The list includes up to ten examples.', 'observed');
  if (h.direct == null && h.internal == null) return card(label, 'Unavailable', 'Neither the wallet history nor the creator traces were available.');
  if (examples.length) return card(label, 'Factory activity only',
    'The returned creations belong to the factory. Their initiating wallets remain unconfirmed.');
  return card(label, 'None identified', 'No earlier creation was identified in the available sample. Each history query reads up to 50 entries.');
}

function tokenCards(intel) {
  const t = intel?.token;
  const e = intel?.origin?.bundle?.early;
  const waiting = intel === undefined;
  const concentration = t?.top != null && t.count > 0
    ? card('Holder concentration', t.top, `Share held by ${t.count} explorer-listed ${plural(t.count, 'account')}, including any pools or contracts. Balances refer to the scan block.`, 'observed')
    : card('Holder concentration', waiting ? 'Checking…' : 'Unknown', 'Requires a holder list, account balances and total supply.');
  const details = e?.checked > 0
    ? `${e.matches} swap-linked ${plural(e.matches, 'transaction')} in ${e.checked} sampled ${plural(e.checked, 'receipt')} across the first ${e.end - e.origin + 1} ${plural(e.end - e.origin + 1, 'block')}. Private bundle membership remains unknown.`
    : 'Public launch receipts can show same-block activity. Private bundle membership remains unknown.';
  const launch = e?.checked > 0
    ? card('Launch activity', e.max > 1 ? `${e.max} swaps in one block` : e.matches ? 'Swap activity observed' : 'No matched swaps', details, e.matches ? 'observed' : 'neutral')
    : card('Launch activity', waiting ? 'Checking…' : e ? 'No sampled receipts' : 'Unknown', details);
  return [concentration, launch];
}

export function assess(r, intel) {
  const {title, description, coverage} = behavior(r.rules);
  const items = [coverage, source(r), history(intel)];
  if (r.erc20) items.push(...tokenCards(intel));
  return {title, description, items};
}
