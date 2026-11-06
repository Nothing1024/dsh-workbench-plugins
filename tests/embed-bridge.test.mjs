import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SOURCE = readFileSync(new URL('../packages/herdr-live/embed-bridge.js', import.meta.url), 'utf8');
const PARENT = 'http://127.0.0.1:50759';
const CURRENT = { machine: 'local', workspace: 'w1', pane: 'p1', view: 'terminal' };
const FRAME = '.pane-frame.is-current:not(.is-hidden)[data-layout-pane]';
const TABS = '.tab-strip-tab[role="tab"][data-tab-id]';
const LENS = '.app-header .view-switch[role="group"][aria-label="Pane view"]';

function element(attributes = {}, classes = []) {
  const names = new Set(classes);
  const queries = new Map();
  return {
    attributes, names, queries, parentElement: null,
    classList: { contains: name => names.has(name) },
    getAttribute(name) { return attributes[name] ?? null; },
    querySelectorAll(selector) {
      const result = queries.get(selector) ?? [];
      return typeof result === 'function' ? result() : result;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
  };
}

// Run the unmodified bridge in a VM with only the pinned metadata selectors,
// History, messages, and a deterministic clock. No renderer, network or PTY runs.
function bridgeFixture({ applyLens = true, origin = PARENT } = {}) {
  let now = 0;
  let nextTimer = 0;
  let address = new URL('http://ovis.test/?ws=w1-project&pane=p1&view=terminal&file=notes&settings=theme&keep=1#auth=fixture');
  let actual = { ...CURRENT };
  const timers = new Map();
  const listeners = new Map();
  const messages = [];
  const origins = [];
  const navigations = [];
  const nativeEvents = [];
  const clicks = [];
  const roster = { tabs: ['t1'], workspaces: ['w1'] };
  const slot = element({ 'data-machine': 'local' }, ['is-active']);
  slot.parentElement = element();
  const frame = element({ 'data-layout-pane': 'p1' }, ['pane-frame', 'is-current']);
  const stack = element();
  frame.queries.set('.terminal-stack', [stack]);
  frame.queries.set('.pane-frame-body', [element()]);
  slot.queries.set(FRAME, [frame]);
  slot.queries.set('.pane-frame[data-layout-pane]', [frame]);
  slot.queries.set('.pane-canvas', [element()]);
  slot.queries.set(TABS, () => roster.tabs.map(id => element({ 'data-tab-id': id })));
  const group = element();
  group.queries.set('.machine-workspaces', [element()]);
  group.queries.set('.workspace-group[data-workspace]', () => roster.workspaces.map(id => element({ 'data-workspace': id })));
  const buttons = ['terminal', 'chat'].map(view => {
    const button = element({ 'aria-pressed': String(view === 'terminal') });
    button.queries.set(view === 'terminal' ? 'svg.lucide-square-terminal' : 'svg.lucide-message-square', [element()]);
    button.click = () => { clicks.push(view); if (applyLens) paint({ view, peek: false }); };
    return button;
  });
  const lens = element();
  lens.queries.set(':scope > button[type="button"][aria-pressed]', buttons);
  const document = element();
  document.currentScript = { dataset: { dshOrigin: origin } };
  document.readyState = 'complete';
  document.queries.set('.pane-slot[data-machine]', [slot]);
  document.queries.set('.machine-group.is-current', [group]);
  document.queries.set(LENS, [lens]);
  let observer;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.nodes = []; observer = this; }
    observe(node, options) { this.nodes.push({ node, options }); }
    disconnect() { this.nodes = []; }
  }
  class PopStateEvent {
    constructor(type, { state } = {}) { this.type = type; this.state = state; this.isTrusted = false; }
  }
  const history = { state: null };
  for (const method of ['pushState', 'replaceState']) {
    history[method] = function (state, title, url) {
      assert.equal(this, history, 'History wrapper preserves its receiver');
      navigations.push({ method, state, title, url });
      address = new URL(url, address);
      this.state = state;
    };
  }
  const parent = {
    postMessage(message, targetOrigin) {
      messages.push(JSON.parse(JSON.stringify(message)));
      origins.push(targetOrigin);
    },
  };
  const window = {
    parent, history,
    location: {
      get search() { return address.search; },
      get pathname() { return address.pathname; },
      get hash() { return address.hash; },
    },
    setTimeout(callback, delay = 0) {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback, options) {
      const entries = listeners.get(type) ?? [];
      entries.push({ callback, capture: options === true || options?.capture === true });
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      const entries = [...(listeners.get(event.type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture));
      for (const { callback } of entries) callback(event);
      return true;
    },
  };
  // An Ovis-style handler is installed first to prove cancellation precedes
  // native processing even when the app registered its listener before us.
  window.addEventListener('popstate', event => {
    nativeEvents.push({ isTrusted: event.isTrusted, messages: [...messages] });
    const query = new URLSearchParams(address.search);
    const machine = query.get('machine') || 'local';
    const pane = query.get('pane');
    if (actual.machine === machine && actual.pane === pane) return; // Ovis ignores same-pane lens changes.
    paint({ machine, pane, view: query.get('view') || 'terminal', peek: false });
  });
  function paint(selection) {
    actual = { ...actual, ...selection };
    slot.attributes['data-machine'] = actual.machine;
    frame.attributes['data-layout-pane'] = actual.pane;
    stack.names.clear();
    if (actual.view === 'chat') stack.names.add('is-chat');
    if (actual.peek) stack.names.add('is-peek');
    buttons.forEach((button, i) => { button.attributes['aria-pressed'] = String(actual.view === ['terminal', 'chat'][i]); });
  }
  runInNewContext(SOURCE, { window, document, URL, URLSearchParams, MutationObserver, PopStateEvent, Date: { now: () => now } }, { filename: 'embed-bridge.js' });
  return {
    messages, origins, navigations, nativeEvents, clicks, roster, paint,
    get url() { return new URL(address); },
    get timerCount() { return timers.size; },
    receive(data, { origin = PARENT, source = parent } = {}) { window.dispatchEvent({ type: 'message', data, origin, source }); },
    event(type, isTrusted) { window.dispatchEvent({ type, isTrusted }); },
    popstate(url, isTrusted) {
      address = new URL(url, address);
      window.dispatchEvent({ type: 'popstate', state: history.state, isTrusted });
    },
    mutate() { if (observer?.nodes.length) observer.callback([]); },
    clear() { messages.length = origins.length = navigations.length = nativeEvents.length = clicks.length = 0; },
    advance(milliseconds = 500) {
      const until = now + milliseconds;
      let iterations = 0;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (timer.at > until) break;
        assert.ok(++iterations < 10_000, 'fake clock must make progress');
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = until;
    },
  };
}

const request = (requestId, selection = {}) => ({
  type: 'dsh-herdr/select', version: 1, requestId, selection: { ...CURRENT, ...selection },
});
const reports = f => f.messages.filter(message => message.type === 'dsh-herdr/selection');
const cancellations = f => f.messages.filter(message => message.type === 'dsh-herdr/cancelled');

function readyFixture(options) {
  const f = bridgeFixture(options);
  f.advance();
  f.clear();
  return f;
}

test('ready and hello report stable actual metadata only to the configured parent', () => {
  const f = bridgeFixture();
  assert.deepEqual(f.messages, [{ type: 'dsh-herdr/ready', version: 1 }]);
  f.advance();
  assert.deepEqual(reports(f), [{ type: 'dsh-herdr/selection', version: 1, selection: CURRENT, confirmed: true }]);
  f.clear();
  f.receive({ type: 'dsh-herdr/hello', version: 1 });
  f.advance();
  assert.deepEqual(f.messages, [
    { type: 'dsh-herdr/ready', version: 1 },
    { type: 'dsh-herdr/selection', version: 1, selection: CURRENT, confirmed: true },
  ]);
  assert.ok(f.origins.every(origin => origin === PARENT));
});

test('legacy v1 select navigates once, retains its ID through synthetic popstate, and confirms actual metadata', () => {
  const f = readyFixture();
  f.receive(request('legacy-select', { machine: 'remote', workspace: 'w2-project', pane: 'p2', view: 'chat' }));
  f.advance();
  assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0].method, 'pushState');
  assert.equal(f.url.searchParams.get('keep'), '1');
  assert.equal(f.url.searchParams.get('sidebar'), 'hidden');
  assert.equal(f.url.searchParams.has('file'), false);
  assert.equal(f.url.searchParams.has('settings'), false);
  assert.equal(f.url.hash, '');
  assert.deepEqual(cancellations(f), []);
  assert.deepEqual(f.nativeEvents.map(event => event.isTrusted), [false]);
  assert.deepEqual(reports(f), [{ type: 'dsh-herdr/selection', version: 1, requestId: 'legacy-select',
    selection: { machine: 'remote', workspace: 'w2', pane: 'p2', view: 'chat' }, confirmed: true }]);
});

test('same-pane lens selection clicks the native control once and waits for the actual lens', () => {
  const f = readyFixture({ applyLens: false });
  f.receive(request('lens', { view: 'chat' }));
  f.advance(900);
  assert.equal(f.navigations[0].method, 'replaceState');
  assert.deepEqual(f.clicks, ['chat']);
  assert.deepEqual(reports(f), [], 'a native click cannot acknowledge a lens that is not rendered');
  assert.deepEqual(cancellations(f), []);
  f.paint({ view: 'chat' });
  f.mutate();
  f.advance();
  assert.deepEqual(reports(f), [{ type: 'dsh-herdr/selection', version: 1, requestId: 'lens',
    selection: { ...CURRENT, view: 'chat' }, confirmed: true }]);
});

test('tab hints wait for original tab and workspace rosters before navigating or acknowledging', () => {
  for (const workspace of ['w1', 'w2']) {
    const f = readyFixture();
    f.receive(request(`roster-${workspace}`, { workspace, pane: 'p2', tab: 't2' }));
    f.advance();
    assert.equal(f.navigations.length, 0);
    assert.ok(reports(f).every(message => message.requestId === undefined));
    if (workspace === 'w1') f.roster.tabs.push('t2');
    else f.roster.workspaces.push('w2');
    f.mutate();
    f.advance();
    assert.equal(f.navigations.length, 1);
    assert.deepEqual(reports(f).filter(message => message.requestId), [{ type: 'dsh-herdr/selection', version: 1,
      requestId: `roster-${workspace}`, selection: { ...CURRENT, workspace, pane: 'p2' }, confirmed: true }]);
  }
});

test('trusted Back/Forward cancels the latest pending ID before native history handling and prevents replay', () => {
  const f = readyFixture();
  f.receive(request('superseded', { pane: 'p2', tab: 't2' }));
  f.receive(request('current', { pane: 'p3', tab: 't3' }));
  f.advance();
  f.clear();
  f.popstate('/?ws=w1-project&pane=p0&view=terminal', true);
  const cancelled = { type: 'dsh-herdr/cancelled', version: 1, requestId: 'current', reason: 'user-navigation' };
  assert.deepEqual(f.messages, [cancelled], 'cancellation is posted synchronously before selection checks');
  assert.deepEqual(f.nativeEvents[0].messages, [cancelled], 'capture listener cancels before the original Ovis listener');
  f.roster.tabs.push('t2', 't3');
  f.mutate();
  f.advance(9000);
  assert.deepEqual(cancellations(f), [cancelled]);
  assert.deepEqual(reports(f), [{ type: 'dsh-herdr/selection', version: 1,
    selection: { ...CURRENT, pane: 'p0' }, confirmed: true }]);
  assert.equal(f.navigations.length, 0, 'a newly available roster cannot replay a cancelled request');
  assert.equal(f.timerCount, 0, 'cancellation stops the bounded poll');
});

test('trusted pointer and key input cancel pending requests and force an untagged actual report', () => {
  for (const type of ['pointerdown', 'keydown']) {
    const f = readyFixture();
    f.receive(request(type, { pane: 'p2', tab: 't2' }));
    f.event(type, false);
    f.advance();
    assert.deepEqual(cancellations(f), [], 'synthetic input does not cancel');
    f.clear();
    f.event(type, true);
    f.event(type, true);
    assert.deepEqual(cancellations(f), [{ type: 'dsh-herdr/cancelled', version: 1, requestId: type, reason: 'user-navigation' }]);
    f.roster.tabs.push('t2');
    f.mutate();
    f.advance();
    assert.deepEqual(reports(f), [{ type: 'dsh-herdr/selection', version: 1, selection: CURRENT, confirmed: true }]);
    assert.equal(f.navigations.length, 0);
    assert.equal(f.timerCount, 0);
  }
});

test('synthetic popstate while a roster lags preserves pending selection for later confirmation', () => {
  const f = readyFixture();
  f.receive(request('synthetic-history', { pane: 'p2', tab: 't2' }));
  f.popstate(f.url, false);
  f.advance();
  assert.deepEqual(cancellations(f), []);
  assert.equal(f.navigations.length, 0);
  f.roster.tabs.push('t2');
  f.mutate();
  f.advance();
  assert.deepEqual(reports(f).filter(message => message.requestId), [{ type: 'dsh-herdr/selection', version: 1,
    requestId: 'synthetic-history', selection: { ...CURRENT, pane: 'p2' }, confirmed: true }]);
  assert.deepEqual(cancellations(f), []);
});

test('unavailable roster expires without a false ACK or late navigation', () => {
  const f = readyFixture();
  f.receive(request('expires', { pane: 'p2', tab: 't2' }));
  f.advance(8500);
  f.roster.tabs.push('t2');
  f.mutate();
  f.advance();
  assert.ok(reports(f).every(message => message.requestId === undefined));
  assert.deepEqual(cancellations(f), []);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.timerCount, 0);
});

test('wrong origins, sources, versions and malformed selection messages cannot navigate or receive replies', () => {
  const f = readyFixture();
  for (const data of [{ type: 'dsh-herdr/hello', version: 1 }, request('unauthorized', { pane: 'p2' })]) {
    f.receive(data, { origin: 'http://foreign.test' });
    f.receive(data, { source: {} });
  }
  for (const data of [
    null, [], { type: 'dsh-herdr/hello', version: 2 }, { ...request('version'), version: 2 },
    request('empty', { workspace: null, pane: null }), request('tab', { tab: ' invalid ' }),
    request('machine', { machine: '' }), request('view', { view: 'files' }), request('x'.repeat(161)),
    { ...request('unknown'), type: 'dsh-herdr/command' },
  ]) f.receive(data);
  f.advance();
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.navigations, []);
});

test('an invalid explicit parent origin fails closed', () => {
  const f = bridgeFixture({ origin: `${PARENT}/?untrusted=1` });
  f.receive(request('invalid-origin', { pane: 'p2' }));
  f.advance();
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.timerCount, 0);
});
