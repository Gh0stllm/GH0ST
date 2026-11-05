import { createService, BountyError } from './service.js';

const useFixture = BOUNTIES_FIXTURE && ['127.0.0.1', 'localhost'].includes(location.hostname);
const service = BOUNTIES_FIXTURE && useFixture
  ? (await import('./fixture.js')).createFixture()
  : createService();

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

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function message(id, value, error = false) {
  const element = get(id);
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
async function writeAction(operation, done, statusId) {
  if (board.writes || board.loading || !principal) return;
  board.writes = true;
  writeControls();
  message('action-status', '');
  message(statusId, 'Saving on the Internet Computer…');
  try {
    const result = await operation();
    done(result);
  } catch (error) {
    console.error(error);
    const fallback = 'The request could not be confirmed. Refresh the board before trying again.';
    message(statusId, error instanceof BountyError ? error.message : fallback, true);
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
    for (const approve of [true, false]) {
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
  form.append(label, noteLabel, node('p', 'Your evidence and Internet Identity principal will be public.', 'form-note'), submit);
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
      () => service.submit(bounty.id, url.href, note.value.trim(), principal),
      updated => {
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
  heading.append(node('h3', summary.title), node('span', statusNames[status] ?? status, 'status'), byline);
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
  body.append(node('p', bounty.description));
  const timeline = node('p', `Posted ${readableDate(bounty.created_at)}`, 'byline');
  if (bounty.deadline.length) timeline.append(` · Submissions due ${readableDate(bounty.deadline[0])}`);
  body.append(timeline);
  const actions = node('div', undefined, 'detail-actions');
  const permalink = node('a', 'Bounty permalink ↗', 'detail-link');
  permalink.href = linkForBounty(bounty.id);
  actions.append(permalink);
  if (isOwner && bounty.status === 'open') {
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
  const submissions = node('section');
  submissions.append(node('h4', `Evidence submissions (${bounty.submissions.length})`));
  if (!bounty.submissions.length) submissions.append(node('p', 'No evidence has been submitted yet.', 'form-note'));
  for (const submission of bounty.submissions) {
    submissions.append(submissionCard(submission, bounty, isOwner && bounty.status === 'open'));
  }
  body.append(submissions);
  const alreadySubmitted = bounty.submissions.some(submission => submission.submitter.toText() === principal);
  if (status === 'open' && !isOwner && !alreadySubmitted) {
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
if (useFixture) message('session-status', 'Local test board. Nothing here is sent to ICP.');
service.onSessionChange(setPrincipal);
void service.restore().then(setPrincipal).catch(error => {
  console.error(error);
  message('session-status', 'Your sign-in session could not be restored. Sign in again to participate.', true);
});
void loadBoard();
