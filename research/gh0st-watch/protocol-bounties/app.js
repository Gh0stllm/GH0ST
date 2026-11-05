import { createService, BountyError } from './service.js';
import {
  addressLink, amountInBaseUnits, createRewardWallet, displayAmount, supportsRewards,
  transactionHash, transactionLink, verifySponsorAddress, WalletError, walletAddress,
} from './wallet.js';

const useFixture = BOUNTIES_FIXTURE && ['127.0.0.1', 'localhost'].includes(location.hostname);
const fixture = BOUNTIES_FIXTURE && useFixture ? (await import('./fixture.js')).createFixture() : null;
const service = fixture?.service ?? createService();
const wallet = createRewardWallet({ canister: BOUNTIES_CANISTER_ID, ...fixture?.wallet });

const get = id => document.getElementById(id);
const list = get('bounty-list');
const sessionAction = get('session-action');
const postShortcut = get('post-shortcut');
const filter = get('status-filter');
const more = get('more');
const refresh = get('refresh');
const compose = get('compose');
const composeForm = get('compose-form');
const focusId = new URLSearchParams(location.search).get('bounty');
const linkedBounty = /^\d{1,20}$/.test(focusId ?? '') && BigInt(focusId) < (1n << 64n) ? BigInt(focusId) : null;
const categoryNames = { research: 'Research', build: 'Build', content: 'Content', other: 'Other' };
const statusNames = {
  open: 'Open', completed: 'Completed', cancelled: 'Cancelled', expired: 'Deadline passed',
  pending: 'Pending review', approved: 'Approved by sponsor', rejected: 'Declined by sponsor',
  not_selected: 'Not selected',
};
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const utf8 = new TextEncoder();
const cardsOpen = new Set(linkedBounty === null ? [] : [linkedBounty]);
const board = {
  items: [], details: new Map(), pending: new Set(), errors: new Map(),
  next: null, loading: false, writes: false, initialized: false,
};
let principal;
let sessionBusy = false;
let rewardConfig;

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function message(id, value, error = false) {
  const element = get(id);
  if (!element) return;
  element.textContent = value;
  element.classList.toggle('error', error);
}
function shortPrincipal(value) {
  return value.slice(0, 9) + '…' + value.slice(-5);
}
function principalLine(label, value) {
  const line = node('span', `${label} ${shortPrincipal(value)}`);
  line.title = value;
  return line;
}
function readableDate(ms) {
  const value = new Date(Number(ms));
  return Number.isNaN(value.valueOf()) ? 'Date unavailable' : dateFormat.format(value);
}
function button(label, action) {
  const element = node('button', label);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}
function linkForBounty(id) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('bounty', id.toString());
  return url.href;
}
function evidenceUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password) return url;
  } catch {
    // The form and card display their own validation messages.
  }
  return null;
}
function localStatus(bounty) {
  const [deadline] = bounty.deadline;
  return bounty.status === 'open' && deadline !== undefined && deadline <= BigInt(Date.now())
    ? 'expired' : bounty.status;
}
function renderSession() {
  const principalLabel = get('principal');
  principalLabel.textContent = principal ? shortPrincipal(principal) : '';
  principalLabel.title = principal ?? '';
  principalLabel.hidden = !principal;
  sessionAction.textContent = principal ? 'Sign out' : 'Sign in';
  sessionAction.disabled = sessionBusy || board.writes;
  postShortcut.disabled = sessionBusy || board.writes;
  if (!principal) compose.hidden = true;
}
function setPrincipal(value) {
  if (principal === value) return;
  principal = value;
  renderSession();
  renderBoard();
}
async function changeSession(signOut) {
  if (sessionBusy || board.writes) return false;
  sessionBusy = true;
  renderSession();
  message('session-status', signOut ? 'Signing out…' : 'Opening Internet Identity…');
  try {
    const value = signOut ? await service.signOut() : await service.signIn();
    setPrincipal(value);
    message('session-status', signOut ? 'Signed out.' : 'Signed in with Internet Identity.');
    return true;
  } catch (error) {
    console.error(error);
    message('session-status', signOut ? 'Sign-out failed. Try again.' : 'Sign-in did not complete. Try again and allow the Internet Identity window to open.', true);
    return false;
  } finally {
    sessionBusy = false;
    renderSession();
  }
}
function openCompose() {
  compose.hidden = false;
  composeForm.elements.title.focus();
  compose.scrollIntoView({ block: 'start' });
}
function writeControls() {
  renderSession();
  refresh.disabled = board.loading || board.writes;
  more.disabled = board.loading || board.writes;
  filter.disabled = board.writes;
  composeForm.querySelector('button[type="submit"]').disabled = board.writes || board.loading;
  list.querySelectorAll('[data-write]').forEach(element => { element.disabled = board.writes || board.loading; });
}
async function writeAction(operation, done, statusId, waiting = 'Saving on the Internet Computer…') {
  if (board.writes || board.loading || !principal) return;
  board.writes = true;
  writeControls();
  message('action-status', '');
  message(statusId, waiting);
  try {
    const result = await operation();
    done(result);
  } catch (error) {
    console.error(error);
    const fallback = 'The request could not be confirmed. Refresh the board before trying again.';
    const readable = error instanceof BountyError || error instanceof WalletError;
    message(statusId, readable ? error.message : fallback, true);
  } finally {
    board.writes = false;
    writeControls();
    for (const id of cardsOpen) void loadDetail(id);
  }
}
function asSummary(bounty) {
  const { description, submissions, ...fields } = bounty;
  return { ...fields, submission_count: submissions.length };
}
function actionId(id) {
  return `bounty-action-${id}`;
}
function rewardOf(bounty) {
  return bounty.reward?.[0];
}
function externalLink(label, href) {
  const link = node('a', label, 'detail-link');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function walletButton(label, action) {
  const control = button(label, action);
  control.dataset.write = '';
  return control;
}
function walletConnection(label, onSuccess, statusId, sponsor = false) {
  let connecting = false;
  return walletButton(label, async () => {
    if (connecting) return;
    connecting = true;
    message(statusId, 'Opening your Robinhood wallet…');
    try {
      const account = await (sponsor ? wallet.directSponsor(true) : wallet.selected(true));
      onSuccess(account);
      message(statusId, '');
    } catch (error) {
      const rejected = Number(error?.code) === 4001;
      message(statusId, error instanceof WalletError ? error.message :
        rejected ? 'Wallet connection was declined.' : 'The wallet could not connect to Robinhood Chain.', true);
    } finally {
      connecting = false;
    }
  });
}
function walletTransaction(bounty, kind, submission, hashInput) {
  const sponsor = principal;
  const statusId = actionId(bounty.id);
  void writeAction(async () => {
    const [latest, config] = await Promise.all([service.get(bounty.id), service.rewardConfig()]);
    if (!latest || latest.owner.toText() !== sponsor || !rewardOf(latest) ||
        !supportsRewards(config) || config.escrow_address !== rewardConfig?.escrow_address) {
      throw new WalletError('The bounty or escrow configuration changed. Refresh the board first.');
    }
    const currentSubmission = submission && latest.submissions.find(item => item.id === submission.id);
    if (submission && currentSubmission?.payout_wallet?.[0] !== submission.payout_wallet?.[0]) {
      throw new WalletError('The payout address changed. Refresh the board before approving.');
    }
    return wallet.send(config, latest, kind, currentSubmission, () => principal === sponsor);
  }, ({ hash, already }) => {
    if (already) {
      message(statusId, 'The wallet already has the required allowance.');
      return;
    }
    if (kind === 'allowance' || kind === 'reset') {
      message(statusId, 'Allowance transaction submitted. Wait until it is mined before the next wallet step.');
    } else {
      if (hashInput) hashInput.value = hash;
      message(statusId, 'Transaction submitted. Verify it on the board once Robinhood Chain finalizes it.');
    }
    get(statusId)?.append(' ', externalLink('View transaction ↗', transactionLink(hash)));
  }, statusId, 'Checking Robinhood Chain and preparing your wallet…');
}
function prepareReward(bounty) {
  const statusId = actionId(bounty.id);
  const section = node('section', undefined, 'reward-panel');
  section.append(node('h4', 'Add a GH0ST reward'), node('p',
    'Set the amount and sponsor wallet before submissions open. Use a direct EVM account on Robinhood Chain.'));
  const form = node('form');
  const amountLabel = node('label', 'Reward amount (GH0ST)');
  const amount = node('input');
  amount.inputMode = 'decimal';
  amount.maxLength = 97;
  amount.required = true;
  amountLabel.append(amount);
  const creatorLabel = node('label', 'Sponsor wallet address');
  const creator = node('input');
  creator.required = true;
  creator.maxLength = 42;
  creator.autocomplete = 'off';
  creator.spellcheck = false;
  creator.placeholder = '0x…';
  creatorLabel.append(creator);
  let connectedAddress;
  creator.addEventListener('input', () => { connectedAddress = undefined; });
  const connect = walletConnection('Connect sponsor wallet', address => {
    connectedAddress = address;
    creator.value = address;
  }, statusId, true);
  const prepare = node('button', 'Prepare reward', 'primary');
  prepare.type = 'submit';
  prepare.dataset.write = '';
  form.append(amountLabel, creatorLabel, connect, prepare);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const sponsor = principal;
    void writeAction(async () => {
      const baseUnits = amountInBaseUnits(amount.value.trim());
      const address = walletAddress(creator.value.trim());
      if (connectedAddress === address) {
        if (await wallet.directSponsor() !== address) throw new WalletError('Reconnect the sponsor wallet shown here.');
      } else {
        await verifySponsorAddress(address);
      }
      if (!confirm(`Prepare a ${displayAmount(baseUnits)} GH0ST reward with sponsor wallet ${address}? The amount and wallet will be fixed on this bounty.`)) {
        return undefined;
      }
      return service.prepareReward(bounty.id, address, baseUnits, sponsor);
    }, updated => {
      if (!updated) { message(statusId, 'Reward preparation cancelled.'); return; }
      upsert(updated);
      message('action-status', 'Reward prepared. Approve the exact allowance, fund it, then verify the funding transaction.');
    }, statusId, 'Checking the sponsor address on Robinhood Chain…');
  });
  section.append(form);
  return section;
}
function rewardPanel(bounty, isOwner) {
  const reward = rewardOf(bounty);
  if (!reward) return isOwner && localStatus(bounty) === 'open' && !bounty.submissions.length && supportsRewards(rewardConfig)
    ? prepareReward(bounty) : null;

  const statusId = actionId(bounty.id);
  const section = node('section', undefined, 'reward-panel');
  const labels = {
    awaiting_funding: 'Prepared · awaiting escrow funding', funded: 'Funded on Robinhood Chain',
    paid: 'Paid on Robinhood Chain', cancelled: 'Cancelled on Robinhood Chain',
    paid_unmatched: 'Escrow paid · no matching submission',
  };
  section.append(node('h4', `${displayAmount(reward.amount_wei)} GH0ST reward`));
  section.append(node('p', labels[reward.status] ?? 'Reward status unavailable', 'reward-status'));
  section.append(externalLink(`Sponsor wallet ${reward.creator_wallet} ↗`, addressLink(reward.creator_wallet)));
  const [proof] = reward.tx_hash;
  if (proof) section.append(externalLink('Verified transaction on Robinhood Chain ↗', transactionLink(proof)));
  if (reward.status === 'paid_unmatched') {
    section.append(node('p', 'The escrow paid a recipient outside the board’s submission matches. The bounty closed without approving a submission.', 'form-note'));
  }
  if (!isOwner || bounty.status !== 'open') return section;
  if (!supportsRewards(rewardConfig)) {
    section.append(node('p', 'Wallet actions are unavailable while escrow configuration is offline.', 'form-note'));
    return section;
  }
  section.append(externalLink('Escrow contract ↗', addressLink(rewardConfig.escrow_address)));
  const txField = node('input');
  txField.autocomplete = 'off';
  txField.spellcheck = false;
  txField.placeholder = '0x…';
  txField.maxLength = 66;
  const lastHash = wallet.getLastHash(rewardConfig, bounty);
  txField.value = lastHash ?? '';
  txField.id = `reward-tx-${bounty.id}`;
  if (lastHash && lastHash !== proof) {
    const pending = node('p', 'A transaction is saved in this browser and has yet to be verified by the board. ');
    pending.append(externalLink('Check on Robinhood Chain ↗', transactionLink(lastHash)));
    section.append(pending);
  }
  const controls = node('div', undefined, 'detail-actions');
  controls.append(walletConnection('Connect sponsor wallet', address => {
    if (address !== walletAddress(reward.creator_wallet)) throw new WalletError(`Select the sponsor wallet ${reward.creator_wallet}.`);
  }, statusId, true));
  if (reward.status === 'awaiting_funding') {
    controls.append(
      walletButton('Approve exact allowance', () => walletTransaction(bounty, 'allowance')),
      walletButton('Fund reward', () => walletTransaction(bounty, 'fund', null, txField)),
      walletButton('Clear existing allowance', () => {
        if (confirm('Set the escrow’s GH0ST allowance from this wallet to zero?')) walletTransaction(bounty, 'reset');
      }),
    );
  }
  controls.append(walletButton(reward.status === 'funded' ? 'Cancel and refund' : 'Cancel prepared reward', () => {
    if (confirm('Cancel this bounty on Robinhood Chain? Any funded reward will return to the sponsor wallet.')) {
      walletTransaction(bounty, 'cancel', null, txField);
    }
  }));
  section.append(controls);
  const reconcile = node('form');
  const hashLabel = node('label', 'Robinhood transaction hash');
  hashLabel.append(txField);
  const reconcileActions = node('div', undefined, 'detail-actions');
  const verify = node('button', 'Verify reward transaction', 'primary');
  verify.type = 'submit';
  verify.dataset.write = '';
  reconcileActions.append(verify, walletButton('Check pending transaction', () => {
    void writeAction(() => wallet.recoverPending(rewardConfig, bounty, txField.value.trim() || undefined),
      result => { message(statusId, result); }, statusId, 'Checking wallet transaction…');
  }));
  reconcile.append(hashLabel, reconcileActions, node('p',
    'Finality can take several minutes. If the hash is missing, open the transaction in your wallet activity and copy its hash.',
    'form-note'));
  reconcile.addEventListener('submit', event => {
    event.preventDefault();
    void writeAction(() => service.syncReward(bounty.id, transactionHash(txField.value.trim()), principal), updated => {
      upsert(updated);
      message('action-status', 'Reward state verified from a finalized Robinhood transaction.');
    }, statusId, 'Verifying a finalized Robinhood transaction…');
  });
  section.append(reconcile);
  return section;
}
function upsert(bounty) {
  board.details.set(bounty.id, bounty);
  board.errors.delete(bounty.id);
  const summary = asSummary(bounty);
  const index = board.items.findIndex(item => item.id === bounty.id);
  if (index === -1) board.items.unshift(summary);
  else board.items[index] = summary;
  cardsOpen.add(bounty.id);
  renderBoard();
  writeControls();
  get(`bounty-${bounty.id}`)?.querySelector('summary').focus({ preventScroll: true });
}
function submissionCard(submission, bounty, canReview) {
  const card = node('article', undefined, 'submission');
  const byline = node('p', undefined, 'byline');
  byline.append(principalLine('Submitted by', submission.submitter.toText()), ` · ${readableDate(submission.created_at)}`);
  const heading = node('h4', `Submission #${submission.id} · ${statusNames[submission.status] ?? submission.status}`);
  const url = evidenceUrl(submission.proof_url);
  card.append(heading, byline);
  if (submission.note) card.append(node('p', submission.note));
  const payout = submission.payout_wallet?.[0];
  if (payout) card.append(externalLink(`Payout wallet ${payout} ↗`, addressLink(payout)));
  if (url) {
    const link = node('a', `View evidence on ${url.hostname} ↗`);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'nofollow noopener noreferrer ugc';
    card.append(link);
  } else {
    card.append(node('p', 'Evidence link unavailable.'));
  }
  if (canReview && submission.status === 'pending') {
    const actions = node('div', undefined, 'detail-actions');
    const reward = rewardOf(bounty);
    if (reward?.status === 'funded' && payout && supportsRewards(rewardConfig)) {
      const pay = walletButton('Approve & pay', () => {
        if (confirm(`Pay ${displayAmount(reward.amount_wei)} GH0ST to ${payout} for submission #${submission.id}? The wallet will send this payment through the Robinhood escrow.`)) {
          walletTransaction(bounty, 'pay', submission, get(`reward-tx-${bounty.id}`));
        }
      });
      actions.append(pay);
    }
    for (const approve of [true, false]) {
      if (reward && approve) continue;
      const action = button(approve ? 'Approve submission' : 'Decline submission', () => {
        if (approve && !confirm('Approve this submission and mark the bounty completed?')) return;
        if (!approve && !confirm('Decline this submission?')) return;
        void writeAction(
          () => service.review(bounty.id, submission.id, approve, principal),
          updated => {
            upsert(updated);
            message('action-status', approve ? 'Submission approved and bounty completed.' : 'Submission declined.');
          },
          actionId(bounty.id),
        );
      });
      action.dataset.write = '';
      actions.append(action);
    }
    card.append(actions);
  }
  return card;
}
function submissionForm(bounty) {
  const form = node('form');
  const input = node('input');
  input.type = 'url';
  input.name = 'proof';
  input.required = true;
  input.maxLength = 1024;
  input.placeholder = 'https://…';
  const label = node('label', 'Public evidence URL');
  label.append(input);
  const note = node('textarea');
  note.name = 'note';
  note.rows = 2;
  note.maxLength = 1000;
  const noteLabel = node('label', 'What does the evidence show? (optional)');
  noteLabel.append(note);
  const submit = node('button', 'Submit evidence', 'primary');
  submit.type = 'submit';
  submit.dataset.write = '';
  const reward = rewardOf(bounty);
  const payout = node('output', 'Payout wallet not connected', 'wallet-address');
  form.append(label, noteLabel);
  if (reward) {
    form.append(
      walletConnection('Connect payout wallet', address => { payout.value = address; }, actionId(bounty.id)),
      payout,
      node('p', 'This Robinhood address will be fixed to your submission. The escrow sends the reward to this address if the sponsor pays your submission.', 'form-note'),
    );
  }
  form.append(node('p', 'Your evidence and Internet Identity principal will be public.', 'form-note'), submit);
  input.addEventListener('input', () => input.setCustomValidity(''));
  note.addEventListener('input', () => note.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const url = evidenceUrl(input.value.trim());
    if (!url) {
      input.setCustomValidity('Enter a public HTTPS link without a username or password.');
      input.reportValidity();
      return;
    }
    if (url.href.length > 1024) {
      input.setCustomValidity('Use an evidence link of at most 1,024 characters.');
      input.reportValidity();
      return;
    }
    if (utf8.encode(note.value.trim()).length > 1000) {
      note.setCustomValidity('Use a shorter evidence note.');
      note.reportValidity();
      return;
    }
    void writeAction(
      async () => {
        if (!reward) return service.submit(bounty.id, url.href, note.value.trim(), principal);
        const contributor = principal;
        const address = await wallet.selected();
        if (address !== payout.value) throw new WalletError('Connect and confirm the payout wallet shown here first.');
        if (!confirm(`Submit this evidence with payout wallet ${address}? The payout address cannot be changed.`)) return undefined;
        return service.submitReward(bounty.id, url.href, note.value.trim(), address, contributor);
      },
      updated => {
        if (!updated) { message(actionId(bounty.id), 'Evidence submission cancelled.'); return; }
        upsert(updated);
        message('action-status', 'Your evidence was submitted for sponsor review.');
      },
      actionId(bounty.id),
    );
  });
  return form;
}
function bountyCard(summary) {
  const owner = summary.owner.toText();
  const status = localStatus(summary);
  const details = node('details', undefined, 'bounty link-target');
  details.id = `bounty-${summary.id}`;
  details.open = cardsOpen.has(summary.id);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) {
      cardsOpen.add(summary.id);
      void loadDetail(summary.id);
    } else {
      cardsOpen.delete(summary.id);
    }
  });
  const heading = node('summary');
  const byline = node('span', undefined, 'byline');
  byline.append(`#${summary.id} · ${categoryNames[summary.category] ?? 'Other'} · `, principalLine('Sponsor', owner));
  byline.append(` · ${summary.submission_count} ${summary.submission_count === 1 ? 'submission' : 'submissions'}`);
  const reward = rewardOf(summary);
  const statusText = reward?.status === 'paid_unmatched' ? 'Closed' : statusNames[status] ?? status;
  heading.append(node('h3', summary.title), node('span', statusText, 'status'), byline);
  if (reward) byline.append(` · ${displayAmount(reward.amount_wei)} GH0ST`);
  details.append(heading, bountyBody(summary));
  return details;
}
function bountyBody(summary) {
  const body = node('div', undefined, 'bounty-body');
  const bounty = board.details.get(summary.id);
  if (!bounty || bounty.updated_at < summary.updated_at) {
    const error = board.errors.get(summary.id);
    body.append(node('p', error ?? 'Loading bounty details…', error ? 'message error' : 'message'));
    if (error) body.append(button('Retry details', () => { void loadDetail(summary.id, true); }));
    return body;
  }
  const isOwner = principal === bounty.owner.toText();
  const status = localStatus(bounty);
  const reward = rewardOf(bounty);
  body.append(node('p', bounty.description));
  const timeline = node('p', `Posted ${readableDate(bounty.created_at)}`, 'byline');
  if (bounty.deadline.length) timeline.append(` · Submissions due ${readableDate(bounty.deadline[0])}`);
  body.append(timeline);
  const actions = node('div', undefined, 'detail-actions');
  const permalink = node('a', 'Bounty permalink ↗', 'detail-link');
  permalink.href = linkForBounty(bounty.id);
  actions.append(permalink);
  if (isOwner && bounty.status === 'open' && !reward) {
    const cancel = button('Cancel bounty', () => {
      if (!confirm('Cancel this bounty? Existing submissions will stay on the public record.')) return;
      void writeAction(
        () => service.cancel(bounty.id, principal),
        updated => {
          upsert(updated);
          message('action-status', 'Bounty cancelled.');
        },
        actionId(bounty.id),
      );
    });
    cancel.dataset.write = '';
    actions.append(cancel);
  }
  body.append(actions);
  const panel = rewardPanel(bounty, isOwner);
  if (panel) body.append(panel);
  const submissions = node('section');
  submissions.append(node('h4', `Evidence submissions (${bounty.submissions.length})`));
  if (!bounty.submissions.length) submissions.append(node('p', 'No evidence has been submitted yet.', 'form-note'));
  for (const submission of bounty.submissions) {
    submissions.append(submissionCard(submission, bounty, isOwner && bounty.status === 'open' &&
      (!reward || reward.status === 'funded')));
  }
  body.append(submissions);
  const alreadySubmitted = bounty.submissions.some(submission => submission.submitter.toText() === principal);
  if (status === 'open' && !isOwner && !alreadySubmitted && (!reward || reward.status === 'funded')) {
    if (principal) body.append(submissionForm(bounty));
    else body.append(button('Sign in to submit evidence', () => { void changeSession(false); }));
  }
  const activity = node('p', undefined, 'message');
  activity.id = actionId(bounty.id);
  activity.setAttribute('role', 'status');
  body.append(activity);
  return body;
}
async function loadDetail(id, retry = false) {
  const item = board.items.find(summary => summary.id === id);
  if (!item || board.pending.has(id) || board.writes) return;
  if (board.details.get(id)?.updated_at >= item.updated_at || (!retry && board.errors.has(id))) return;
  board.pending.add(id);
  board.errors.delete(id);
  try {
    const detail = await service.get(id);
    if (detail) {
      const old = board.details.get(id);
      if (!old || old.updated_at <= detail.updated_at) board.details.set(id, detail);
      const current = board.items.findIndex(summary => summary.id === id);
      if (current !== -1 && board.items[current].updated_at <= detail.updated_at) {
        board.items[current] = asSummary(detail);
      }
      if (detail.updated_at < item.updated_at) board.errors.set(id, 'Details are updating. Retry in a moment.');
    } else {
      board.errors.set(id, 'This bounty is no longer on the public board.');
    }
  } catch (error) {
    console.error(error);
    board.errors.set(id, 'Bounty details could not be loaded.');
  } finally {
    board.pending.delete(id);
    const card = get(`bounty-${id}`);
    const latest = board.items.find(summary => summary.id === id);
    if (card && latest) {
      const focused = document.activeElement === card.querySelector('summary');
      const updated = bountyCard(latest);
      card.replaceWith(updated);
      if (focused) updated.querySelector('summary').focus({ preventScroll: true });
    }
    writeControls();
  }
}
function renderBoard() {
  const visible = board.items.filter(item => filter.value === 'all' || localStatus(item) === filter.value);
  list.replaceChildren(...visible.map(bountyCard));
  more.hidden = board.next === null;
  if (!board.initialized) return;
  if (!board.items.length) message('board-status', 'No bounties yet. Sign in to post the first one.');
  else if (!visible.length) message('board-status', board.next === null
    ? 'No bounties match this status.'
    : 'No loaded bounties match this status. Load more to check earlier posts.');
  else message('board-status', `Showing ${visible.length} ${visible.length === 1 ? 'bounty' : 'bounties'}${board.next === null ? '.' : '. More posts are available.'}`);
}
async function loadBoard(append = false) {
  if (board.loading || board.writes) return;
  board.loading = true;
  writeControls();
  message('board-status', append ? 'Loading earlier bounties…' : 'Loading the bounty board…');
  try {
    const cursor = append ? board.next : null;
    const result = await service.list(cursor);
    const unique = new Map((append ? board.items : []).map(item => [item.id, item]));
    for (const item of result.items) unique.set(item.id, item);
    if (!append) {
      board.details.clear();
      board.errors.clear();
    }
    if (!append && linkedBounty !== null && !unique.has(linkedBounty)) {
      const item = await service.get(linkedBounty);
      if (item) {
        unique.set(item.id, asSummary(item));
        board.details.set(item.id, item);
      }
      else message('action-status', `Bounty #${linkedBounty} was not found.`, true);
    }
    board.items = Array.from(unique.values()).sort((a, b) => a.id > b.id ? -1 : 1);
    board.next = result.next;
    const firstLoad = !board.initialized;
    board.initialized = true;
    renderBoard();
    if (firstLoad && linkedBounty !== null) get(`bounty-${linkedBounty}`)?.scrollIntoView({ block: 'start' });
  } catch (error) {
    console.error(error);
    message('board-status', 'The public board could not be loaded. Refresh to try again.', true);
  } finally {
    board.loading = false;
    writeControls();
  }
}
sessionAction.addEventListener('click', () => { void changeSession(Boolean(principal)); });
postShortcut.addEventListener('click', async () => {
  if (principal || await changeSession(false)) openCompose();
});
get('compose-close').addEventListener('click', () => {
  compose.hidden = true;
  postShortcut.focus();
});
composeForm.addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(composeForm);
  const title = fields.get('title').trim();
  const description = fields.get('description').trim();
  const deadlineText = fields.get('deadline');
  const deadlineMs = deadlineText ? Date.parse(deadlineText) : null;
  const titleSize = utf8.encode(title).length;
  const descriptionSize = utf8.encode(description).length;
  if (titleSize < 3 || titleSize > 100 || descriptionSize < 20 || descriptionSize > 4000) {
    message('compose-status', 'Use 3–100 bytes for the title and 20–4,000 for the description. Some characters use several bytes.', true);
    return;
  }
  if (deadlineMs !== null && (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now())) {
    message('compose-status', 'Choose a future deadline or leave it empty.', true);
    return;
  }
  void writeAction(
    () => service.create({
      title, description, category: fields.get('category'),
      deadline: deadlineMs === null ? [] : [BigInt(deadlineMs)],
    }, principal),
    bounty => {
      composeForm.reset();
      message('compose-status', '');
      compose.hidden = true;
      filter.value = 'all';
      upsert(bounty);
      get(`bounty-${bounty.id}`)?.scrollIntoView({ block: 'start' });
      message('action-status', `Bounty #${bounty.id} was published.`);
    },
    'compose-status',
  );
});
filter.addEventListener('change', renderBoard);
refresh.addEventListener('click', () => { void loadBoard(); });
more.addEventListener('click', () => { void loadBoard(true); });
if (useFixture) message('session-status', 'Local test board. No live wallet or ICP transactions.');
void service.rewardConfig().then(config => {
  if (!supportsRewards(config)) return;
  rewardConfig = config;
  message('reward-notice', 'Optional GH0ST rewards use Robinhood Chain escrow. Wallet transactions require ETH for gas. The board updates after it verifies a finalized transaction.');
  renderBoard();
  writeControls();
}).catch(error => {
  console.warn('Bounty rewards are unavailable', error);
});
service.onSessionChange(setPrincipal);
void service.restore().then(setPrincipal).catch(error => {
  console.error(error);
  message('session-status', 'Your sign-in session could not be restored. Sign in again to participate.', true);
});
void loadBoard();
