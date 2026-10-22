const WHITE = '#f5f4ef';
const AMBER = '#ffb84f';
const VISUAL_STATES = Object.freeze({
  idle: 'Watching the signal.',
  reading: 'Reading the gas signal.',
  wallet: 'Waiting for your wallet.',
  working: 'Following confirmed progress.',
  ready: 'Ready for the next step.',
  paused: 'Holding position.',
  complete: 'Signal confirmed on-chain.',
  rejected: 'The controller rejected the action.',
  cancelled: 'Standing by after cancellation.',
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

/** Fixed dot geometry; the portrait never contains generated model output. */
export function createCharacterGeometry() {
  const points = [];
  const add = (x, y, group, color, z = 0) => points.push({ x, y, z, group, color, seed: ((points.length * 73 + 19) % 997) / 997 });
  for (const side of [-1, 1]) {
    for (let row = 0; row < 12; row++) add(side * 220, -103.4 + row * 18.8, 'bracket', WHITE);
    for (const y of [-103.4, 103.4]) for (let col = 1; col <= 2; col++) add(side * (220 - col * 18.8), y, 'bracket', WHITE);
  }
  for (const [center, group] of [[-100, 'left-eye'], [106, 'right-open']]) {
    for (const y of [-66, 67]) for (let col = -1; col <= 1; col++) add(center + col * 18, y, group, AMBER, 17);
    for (let row = 0; row < 6; row++) for (const side of [-1, 1]) add(center + side * 35, -47 + row * 19, group, AMBER, 17);
  }
  for (let col = -2; col <= 2; col++) add(106 + col * 18, -9, 'right-wink', AMBER, 17);
  for (let col = -2; col <= 2; col++) add(col * 18.8, 97.6, 'mouth', WHITE, 8);
  for (let row = -1; row <= 1; row++) add(-100, row * 8, 'pupil', AMBER, 17);
  return points;
}

export function mountS0ULCharacter(target, options = {}) {
  if (!target || target.dataset.s0ulCharacterMounted) return null;
  const doc = target.ownerDocument;
  const win = options.window ?? doc.defaultView ?? globalThis.window;
  if (!doc || !win) return null;
  const isCanvas = target.tagName?.toLowerCase() === 'canvas';
  const canvas = isCanvas ? target : doc.createElement('canvas');
  const context = canvas.getContext?.('2d', { alpha: true });
  if (!context) return null;
  const now = options.now ?? (() => win.performance?.now?.() ?? Date.now());
  const requestFrame = options.requestAnimationFrame ?? (fn => win.requestAnimationFrame(fn));
  const cancelFrame = options.cancelAnimationFrame ?? (id => win.cancelAnimationFrame(id));
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const geometry = createCharacterGeometry();
  const pauseButton = doc.getElementById('s0ul-character-pause');
  const greetButton = doc.getElementById('s0ul-character-greet');
  const status = doc.getElementById('s0ul-character-status');
  const pointer = { x: 0, y: 0, active: false };
  const gaze = { x: 0, y: 0 };
  const listeners = [];
  let width = 640, height = 400, dpr = 1, frameId = null, lastDraw = -Infinity;
  let destroyed = false, manuallyPaused = false, visible = !doc.hidden, inViewport = true;
  let reducedMotion = options.reducedMotion ?? Boolean(media?.matches), visualState = 'idle';
  let reaction = null, reactionTimer = null, blinkStart = -Infinity, nextBlink = now() + 3400;
  let uiObserver = null, resizeObserver = null, intersectionObserver = null;

  target.dataset.s0ulCharacterMounted = 'true';
  if (!isCanvas) { target.replaceChildren(canvas); canvas.id = `${target.id || 's0ul-character'}-canvas`; }
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', 'Interactive S0UL portrait. Press Enter or Space to wave hello. Portrait interactions do not start a task.');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.cursor = 'pointer';
  canvas.style.touchAction = 'manipulation';
  if (status) { status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); }
  if (greetButton) greetButton.setAttribute('aria-controls', canvas.id || target.id);
  if (pauseButton) pauseButton.setAttribute('aria-controls', canvas.id || target.id);

  function listen(node, type, callback, settings) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, callback, settings); listeners.push(() => node.removeEventListener(type, callback, settings));
  }
  function updateStatus() {
    const message = reaction ? 'Portrait greeting.' : VISUAL_STATES[visualState];
    if (status && status.textContent !== message) status.textContent = message;
  }
  function updatePause() {
    if (!pauseButton) return;
    pauseButton.textContent = reducedMotion ? 'Reduced motion' : manuallyPaused ? 'Resume animation' : 'Pause animation';
    pauseButton.setAttribute('aria-pressed', String(manuallyPaused));
    pauseButton.disabled = reducedMotion;
  }
  function motionAllowed() { return !destroyed && visible && inViewport && !manuallyPaused && !reducedMotion; }
  function schedule() { if (!destroyed && visible && inViewport && frameId === null) frameId = requestFrame(frame); }
  function stopFrame() { if (frameId !== null) { cancelFrame(frameId); frameId = null; } }
  function frame(time) {
    frameId = null;
    if (destroyed || !visible || !inViewport) return;
    if (!motionAllowed() || time - lastDraw >= 1000 / (width < 600 ? 30 : 45)) { draw(time); lastDraw = time; }
    if (motionAllowed()) schedule();
  }
  function sprite(color) {
    const dot = doc.createElement('canvas'); dot.width = dot.height = 64;
    const ctx = dot.getContext('2d');
    const rgb = color === AMBER ? '255,184,79' : '245,244,239';
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, `rgba(${rgb},1)`); glow.addColorStop(.18, `rgba(${rgb},1)`);
    glow.addColorStop(.25, `rgba(${rgb},.9)`); glow.addColorStop(.44, `rgba(${rgb},.13)`); glow.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64); return dot;
  }
  const sprites = { [WHITE]: sprite(WHITE), [AMBER]: sprite(AMBER) };
  function drawDot(x, y, radius, color, opacity = 1) {
    if (opacity <= .005) return;
    context.globalAlpha = clamp(opacity * .2, 0, 1);
    const size = radius * 8;
    context.drawImage(sprites[color], x - size / 2, y - size / 2, size, size);
    context.globalAlpha = clamp(opacity, 0, 1);
    context.fillStyle = color;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  }
  function draw(time) {
    const animated = motionAllowed();
    const t = animated ? time : 0;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
    const scale = Math.min(width / 590, height / 305);
    gaze.x += ((pointer.active ? pointer.x : animated ? Math.sin(t * .00029) * .23 : 0) - gaze.x) * (animated ? .085 : 1);
    gaze.y += ((pointer.active ? pointer.y : animated ? Math.sin(t * .00041) * .15 : 0) - gaze.y) * (animated ? .085 : 1);
    const yaw = reducedMotion ? 0 : gaze.x * .14, pitch = reducedMotion ? 0 : -gaze.y * .11;
    const roll = reducedMotion ? 0 : gaze.x * .019;
    const breath = animated ? Math.sin(t * .00135) : 0;
    const cx = width / 2 + (reducedMotion ? 0 : gaze.x * 7 * scale);
    const cy = height * .49 + breath * 2.3 * scale;
    const age = reaction ? time - reaction.startedAt : Infinity;
    const reactionAmount = age >= 0 && age < 1300 ? Math.sin(Math.PI * age / 1300) : 0;
    const scatter = reactionAmount * 12;
    const rightOpen = age >= 0 && age < 760 ? Math.sin(Math.PI * smooth(age / 760)) : 0;
    if (animated && time >= nextBlink) { blinkStart = time; nextBlink = time + 4200 + Math.random() * 3300; }
    const blinkAge = time - blinkStart;
    const blink = animated && blinkAge >= 0 && blinkAge < 190 ? 1 - Math.sin(Math.PI * blinkAge / 190) ** 2 * .96 : 1;
    const leftOpen = blink * (1 - rightOpen * .7);
    const working = ['reading', 'wallet', 'working'].includes(visualState);
    const pulse = animated && working ? .94 + Math.sin(t * .004) * .06 : 1;

    // The ripple is a portrait gesture, independent of contract execution.
    if (age >= 0 && age < 1300) {
      const radius = (54 + age * .16) * scale;
      for (let i = 0; i < 96; i++) {
        const angle = i / 96 * Math.PI * 2;
        drawDot(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * .64, 1.3 * scale, i % 4 ? WHITE : AMBER, (1 - age / 1300) * .24);
      }
    }
    for (const point of geometry) {
      let x = point.x, y = point.y, opacity = .9 + point.seed * .1;
      if (point.group === 'left-eye') {
        x += gaze.x * 3; y = y * leftOpen + gaze.y * 3;
        if (leftOpen < .3) opacity *= .42;
      } else if (point.group === 'right-open') {
        if (rightOpen <= .02) continue;
        x += gaze.x * 3; y = y * rightOpen + gaze.y * 3; opacity *= rightOpen;
      } else if (point.group === 'right-wink') { opacity *= 1 - rightOpen; }
      else if (point.group === 'mouth') { y -= reactionAmount * (Math.abs(x) / 38) ** 2 * 7; }
      else if (point.group === 'pupil') {
        if (!pointer.active || leftOpen < .5) continue;
        x += Math.round(gaze.x * 2) * 8; y += Math.round(gaze.y * 2) * 8; opacity *= .42;
      }
      x += Math.cos(point.seed * 31) * scatter * (.4 + point.seed * .6);
      y += Math.sin(point.seed * 27) * scatter * (.4 + point.seed * .6);
      const rx = x * Math.cos(yaw) + point.z * Math.sin(yaw);
      const rz = -x * Math.sin(yaw) + point.z * Math.cos(yaw);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const perspective = 850 / (850 - depth);
      const px = (rx * Math.cos(roll) - ry * Math.sin(roll)) * perspective;
      const py = (rx * Math.sin(roll) + ry * Math.cos(roll)) * perspective;
      const radius = (point.group === 'pupil' ? 2.8 : 6.1) * scale * perspective * (1 + breath * .012);
      drawDot(cx + px * scale, cy + py * scale, radius, point.color, opacity * pulse);
    }
    context.globalAlpha = 1;
  }
  function resize() {
    const rect = target.getBoundingClientRect();
    width = Math.max(1, rect.width || target.clientWidth || 640);
    height = Math.max(1, rect.height || width / 1.6);
    dpr = clamp(Number(win.devicePixelRatio) || 1, 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    draw(now()); schedule();
  }
  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    pointer.y = clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1);
    pointer.active = true; schedule();
  }
  function greet() {
    if (destroyed) return;
    if (reactionTimer !== null) win.clearTimeout(reactionTimer);
    reaction = { startedAt: now() - (motionAllowed() ? 0 : 260) };
    updateStatus(); schedule();
    reactionTimer = win.setTimeout(() => { reaction = null; reactionTimer = null; updateStatus(); schedule(); }, 1500);
  }
  function pause() { manuallyPaused = true; stopFrame(); updatePause(); draw(now()); }
  function play() { manuallyPaused = false; updatePause(); schedule(); }
  function setVisualState(value) {
    if (!Object.hasOwn(VISUAL_STATES, value) || value === visualState) return;
    visualState = value; updateStatus(); schedule();
  }
  function readUI() {
    const ui = doc.getElementById('s0ul-agent-root');
    if (!ui) return;
    const text = id => String(doc.getElementById(id)?.textContent ?? '').toLowerCase();
    const outcome = doc.getElementById('s0ul-outcome')?.dataset.outcome;
    const title = text('s0ul-execution-title');
    let next = 'idle';
    if (/calculating|reading the chain/.test(text('s0ul-quote') + text('s0ul-notice'))) next = 'reading';
    else if (outcome === '2') next = 'complete';
    else if (outcome === '3') next = 'rejected';
    else if (outcome === '4') next = 'cancelled';
    else if (/wallet|pending|resolve/.test(title)) next = 'wallet';
    else if (/paused/.test(title)) next = 'paused';
    else if (outcome === '1') next = doc.getElementById('s0ul-pause')?.disabled === false ? 'working' : 'ready';
    setVisualState(next);
  }
  listen(canvas, 'pointerenter', pointAt, { passive: true });
  listen(canvas, 'pointermove', pointAt, { passive: true });
  listen(canvas, 'pointerleave', () => { pointer.active = false; schedule(); });
  listen(canvas, 'click', greet);
  listen(canvas, 'keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); greet(); }
  });
  listen(greetButton, 'click', greet);
  listen(pauseButton, 'click', () => manuallyPaused ? play() : pause());
  listen(doc, 'visibilitychange', () => { visible = !doc.hidden; if (visible) schedule(); else stopFrame(); });
  const onMotion = event => { reducedMotion = Boolean(event.matches); stopFrame(); updatePause(); draw(now()); schedule(); };
  if (media?.addEventListener) listen(media, 'change', onMotion);
  else if (media?.addListener) { media.addListener(onMotion); listeners.push(() => media.removeListener(onMotion)); }
  if (win.ResizeObserver) { resizeObserver = new win.ResizeObserver(resize); resizeObserver.observe(target); }
  else listen(win, 'resize', resize, { passive: true });
  if (win.IntersectionObserver) {
    intersectionObserver = new win.IntersectionObserver(entries => {
      inViewport = Boolean(entries[0]?.isIntersecting);
      if (inViewport) schedule(); else stopFrame();
    }, { rootMargin: '80px' });
    intersectionObserver.observe(target);
  }
  if (options.observeUI !== false && win.MutationObserver) {
    const ui = doc.getElementById('s0ul-agent-root');
    if (ui) { uiObserver = new win.MutationObserver(readUI); uiObserver.observe(ui, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'data-outcome'] }); }
  }
  updatePause(); updateStatus(); readUI(); resize();
  return {
    canvas, greet, pause, play, setVisualState,
    get paused() { return !motionAllowed(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; stopFrame();
      if (reactionTimer !== null) win.clearTimeout(reactionTimer);
      listeners.forEach(remove => remove()); uiObserver?.disconnect(); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      target.removeAttribute('data-s0ul-character-mounted');
    },
  };
}

if (typeof document !== 'undefined') {
  const target = document.getElementById('s0ul-character');
  if (target) mountS0ULCharacter(target);
}
