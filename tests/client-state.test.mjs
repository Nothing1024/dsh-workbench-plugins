import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import vm from 'node:vm';

// Execute the actual client offline. No browser, sockets, real fetch, or services
// are exposed to its VM; every response and frame message is supplied below.
const clientUrl = new URL('../src/herdr/client.js', import.meta.url);
const clientSource = readFileSync(clientUrl, 'utf8').replace('export function createHerdrClient', 'function createHerdrClient') + "\nwindow.__ModuleLoader__.load({id:'herdr', factory:require=>createHerdrClient(require, {SOURCE_TAB_SLOT:'offline.source-tabs', SourceTab() {}})});";
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => nextTurn();

function snapshot(count = 2) {
  return {
    version: 'synthetic-client-state', protocol: 22, herdr_lifetime: 'synthetic-one', agents: [],
    workspaces: Array.from({ length: count }, (_, index) => {
      const id = `w${index + 1}`;
      return { workspace_id: id, label: `Project ${index + 1}`, active_tab_id: `${id}:t1`, focused: index === 0, pane_count: 1, tab_count: 1, agent_status: 'idle' };
    }),
    tabs: Array.from({ length: count }, (_, index) => {
      const id = `w${index + 1}`;
      return { workspace_id: id, tab_id: `${id}:t1`, label: `Terminal ${index + 1}`, focused: index === 0, pane_count: 1, agent_status: 'idle' };
    }),
    panes: Array.from({ length: count }, (_, index) => {
      const id = `w${index + 1}`;
      return { workspace_id: id, tab_id: `${id}:t1`, pane_id: `${id}:p1`, label: `Terminal ${index + 1}`, cwd: '/synthetic/project', focused: index === 0, agent_status: 'idle' };
    }),
    layouts: Array.from({ length: count }, (_, index) => {
      const id = `w${index + 1}`;
      return { workspace_id: id, tab_id: `${id}:t1`, focused_pane_id: `${id}:p1`, zoomed: false, panes: [], splits: [] };
    }),
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClock() {
  const timers = new Map();
  let now = 0, serial = 0;
  const schedule = (callback, delay = 0, ...args) => {
    const id = ++serial;
    timers.set(id, { callback, args, at: now + Number(delay) });
    return id;
  };
  return {
    setTimeout: schedule,
    clearTimeout: id => timers.delete(id),
    advance(milliseconds) {
      const until = now + milliseconds;
      let steps = 0;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert(++steps < 1000, 'Synthetic timer loop must remain bounded');
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback(...timer.args);
      }
      now = until;
    },
    clear: () => timers.clear(),
  };
}

function nodes(tree, predicate, result = []) {
  if (tree === null || typeof tree !== 'object') return result;
  if (predicate(tree)) result.push(tree);
  for (const child of tree.children ?? []) nodes(child, predicate, result);
  return result;
}

function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return (tree.children ?? []).map(text).join('');
}

function harness(t) {
  const clock = fakeClock();
  const entries = [], cleanups = [], requests = [], streams = [], sent = [];
  const listeners = new Map(), subscribers = new Set(), hooks = new Map(), storage = new Map();
  const localStorage = {getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value)};
  let plugin, activePanelId = null, hookStorage = null, hookIndex = 0, contentWindow = null;
  function nextHook(initial) {
    assert(hookStorage, 'Hooks are evaluated only while rendering a slot');
    const index = hookIndex++;
    if (!Object.hasOwn(hookStorage, index)) hookStorage[index] = typeof initial === 'function' ? initial() : initial;
    return [hookStorage, index];
  }
  // This renderer exercises component handlers and state. DOM layout and focus
  // effects belong to browser tests and intentionally do not execute here.
  const React = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const [storage, index] = nextHook(initial);
      return [storage[index], value => { storage[index] = typeof value === 'function' ? value(storage[index]) : value; }];
    },
    useRef(initial) { const [storage, index] = nextHook(() => ({ current: initial })); return storage[index]; },
    useEffect() { nextHook(null); },
    useLayoutEffect() { nextHook(null); },
    useMemo(make) { nextHook(null); return make(); },
    useCallback(callback) { nextHook(null); return callback; },
    useSyncExternalStore(_subscribe, get) { nextHook(null); return get(); },
  };
  const addEventListener = (name, listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(listener);
  };
  const removeEventListener = (name, listener) => listeners.get(name)?.delete(listener);
  const window = {
    innerWidth: 1600, innerHeight: 1000, addEventListener, removeEventListener,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    dispatchEvent(event) { for (const listener of listeners.get(event.type) ?? []) listener(event); },
    __ModuleLoader__: {
      load(module) {
        plugin = module.factory(name => {
          if (name === 'react') return React;
          if (name === 'react-dom') return { createPortal: child => child };
          throw new Error(`Unexpected module in offline client fixture: ${name}`);
        });
      },
    },
  };
  class SyntheticEventSource {
    constructor(url) {
      assert.equal(new URL(url).pathname, '/__dsh_herdr/events');
      this.listeners = new Map();
      this.closed = false;
      streams.push(this);
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    close() { this.closed = true; }
    emit(value) {
      assert(!this.closed, 'Cannot publish through a closed synthetic stream');
      this.onmessage?.({ data: JSON.stringify({ snapshot: value }) });
    }
  }
  function fetch(url, options = {}) {
    const path = new URL(url).pathname;
    const method = options.method ?? 'GET';
    assert((path === '/__dsh_herdr/session' && method === 'GET') || (path === '/__dsh_herdr/action' && method === 'POST') || (path === '/__dsh_herdr/config' && method === 'POST'), 'Only synthetic sidebar and settings requests are permitted');
    const result = deferred();
    const request = { path, origin:new URL(url).origin, method, body: options.body ? JSON.parse(options.body) : null, signal: options.signal, result, finished: false };
    requests.push(request);
    // Aborted reads remain manually settleable to exercise late completions.
    return result.promise;
  }
  const register = (options, component) => {
    const entry = { options, component };
    entries.push(entry);
    return () => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); };
  };
  const ctx = {
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId }),
        subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); },
      },
      selectPanel(id) { activePanelId = id; for (const listener of subscribers) listener(); },
    },
    slots: {
      register,
      // Source-tab factory rendering is unrelated to these state regressions.
      registerFactory: () => () => {},
      entriesOfSlot: name => entries.filter(entry => entry.options.name === name),
      inject(_name, install) { const cleanup = install(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    },
    effect(install) { const cleanup = install(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
  };
  vm.runInNewContext(clientSource, {
    window, document: { body: {} }, URL, URLSearchParams, AbortController, AbortSignal,
    fetch, EventSource: SyntheticEventSource, console,
    localStorage, location:{origin:'http://127.0.0.1:50759'}, CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  }, { filename: clientUrl.pathname });
  assert(plugin, 'The real client module must register');
  plugin.apply(ctx);
  const diagnostic = window.__HERDR_LIVE__;
  assert(diagnostic, 'The client diagnostic must be installed');
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); clock.clear(); });

  function render(name, props = {}) {
    const entry = entries.find(item => item.options.name === name);
    assert(entry, `Expected registered slot ${name}`);
    if (!hooks.has(entry.component)) hooks.set(entry.component, []);
    hookStorage = hooks.get(entry.component);
    hookIndex = 0;
    try { return entry.component({ renderFactorySlot: () => null, ...props }); } finally { hookStorage = null; }
  }
  const sidebar = () => render('sidebar.workspaces', { wide: true });
  function settings() {
    if (!hooks.has(plugin.SettingsPanel)) hooks.set(plugin.SettingsPanel, []);
    hookStorage = hooks.get(plugin.SettingsPanel); hookIndex = 0;
    try {
      const wrapper = plugin.SettingsPanel();
      return wrapper.type(wrapper.props);
    } finally { hookStorage = null; }
  }
  const find = (tree, property, value) => nodes(tree, node => Object.hasOwn(node.props, property) && (value === undefined || node.props[property] === value))[0] ?? null;
  const form = () => nodes(sidebar(), node => node.type === 'form')[0] ?? null;
  const reads = () => requests.filter(request => request.method === 'GET');
  const writes = () => requests.filter(request => request.method === 'POST');
  function respond(request, value, status = 200) {
    assert(request && !request.finished, 'Expected an unresolved synthetic request');
    request.finished = true;
    request.result.resolve({ ok: status >= 200 && status < 300, status, json: async () => plain(value) });
  }
  function fail(request, message) {
    assert(request && !request.finished, 'Expected an unresolved synthetic request');
    request.finished = true;
    request.result.reject(new Error(message));
  }
  function message(value) {
    assert(contentWindow, 'Attach the synthetic child before sending messages');
    for (const listener of listeners.get('message') ?? []) listener({ origin: diagnostic.frameOrigin, source: contentWindow, data: { version: 1, ...value } });
  }
  return {
    diagnostic, clock, reads, writes, respond, fail, form, sent, settings,
    settingsPort(value) { nodes(settings(),node=>node.type==='input'&&node.props.type==='number')[0].props.onChange({target:{value}}); },
    saveSettings() { return nodes(settings(),node=>node.type==='button'&&text(node)==='保存并应用')[0].props.onClick(); },
    storedSettings:()=>JSON.parse(storage.get('dsh-herdr-live-prefs')||'{}'),
    state: () => plain(diagnostic.snapshot()),
    emit: value => { assert(streams.length, 'An active synthetic stream is required'); streams.at(-1).emit(value); },
    async open(value = snapshot()) { diagnostic.show(); respond(reads().at(-1), { snapshot: value }); await settle(); },
    create(label) {
      find(sidebar(), 'data-herdr-new-project').props.onClick();
      find(sidebar(), 'data-herdr-name-input').props.onChange({ target: { value: label } });
    },
    submit() { const current = form(); assert(current, 'Expected an open management form'); return current.props.onSubmit({ preventDefault() {} }); },
    refresh() { return find(sidebar(), 'aria-label', '刷新项目列表').props.onClick(); },
    messages: () => nodes(sidebar(), node => node.props.className === 'herdr-native-error' || node.props.role === 'alert').map(text).join('\n'),
    attachFrame() {
      const frame = find(render('main'), 'data-herdr-frame');
      assert(frame, 'Expected the original Ovis iframe');
      contentWindow = { postMessage: (value, origin) => { assert.equal(origin, diagnostic.frameOrigin); sent.push(plain(value)); } };
      const element = { contentWindow, getAttribute: name => name === 'src' ? frame.props.src : null };
      if (typeof frame.props.ref === 'function') frame.props.ref(element); else frame.props.ref.current = element;
      message({ type: 'dsh-herdr/ready' });
    },
    selection(workspace, requestId, view = 'terminal') {
      message({ type: 'dsh-herdr/selection', confirmed: true, ...(requestId ? { requestId } : {}), selection: { machine: 'local', workspace, pane: `${workspace}:p1`, view } });
    },
    cancel: requestId => message({ type: 'dsh-herdr/cancelled', requestId, reason: 'user-navigation' }),
  };
}

const stateTest = (name, run) => test(name, { timeout: 3000 }, run);

stateTest('Herdr saves a changed port through the current proxy before updating browser preferences', async t => {
  const f = harness(t);
  f.settingsPort('50888'); f.saveSettings();
  const save = f.writes().find(request => request.path === '/__dsh_herdr/config');
  assert.equal(save.origin, 'http://127.0.0.1:50760');
  assert.equal(save.body.proxyPort, 50888);
  assert.equal(f.storedSettings().proxyPort, undefined);
  f.respond(save, {ok:true, restartRequired:true, message:'代理端口已保存，重启后生效。'});
  await settle();
  assert.equal(f.storedSettings().proxyPort, 50888);
  assert.match(text(f.settings()), /重启后生效/);
});

stateTest('a failed Herdr configuration save preserves the old connection and the edited form', async t => {
  const f = harness(t);
  f.settingsPort('50888'); f.saveSettings();
  f.fail(f.writes().find(request => request.path === '/__dsh_herdr/config'), 'proxy unavailable');
  await settle();
  assert.equal(f.storedSettings().proxyPort, undefined);
  assert.equal(nodes(f.settings(),node=>node.type==='input'&&node.props.type==='number')[0].props.value, '50888');
  assert.match(text(f.settings()), /proxy unavailable/);
});

stateTest('a confirmed create finishes its form when refresh fails; refresh retry does not create again', async t => {
  const h = harness(t);
  await h.open();
  h.create('Committed project');
  const submitted = h.submit();
  assert.equal(h.writes().length, 1);
  assert.equal(h.writes()[0].body.action, 'workspace-create');
  const committed = snapshot(3);
  committed.workspaces[2].label = 'Committed project';
  h.emit(committed);
  h.respond(h.writes()[0], { workspace_id: 'w3', pane_id: 'w3:p1' });
  await settle();
  assert.equal(h.reads().length, 2, 'The successful write starts metadata reconciliation');
  h.fail(h.reads()[1], 'synthetic refresh failed');
  await submitted;
  assert.equal(h.state().counts.workspaces, 3, 'The committed project remains visible');
  assert.equal(h.form(), null, 'A confirmed create must not leave a retryable create form');
  assert.equal(h.writes().length, 1);
  const refreshed = h.refresh();
  h.respond(h.reads().at(-1), { snapshot: committed });
  await refreshed;
  assert.equal(h.writes().length, 1, 'Retrying metadata refresh must never repeat the creation POST');
});

stateTest('a confirmed create without pane metadata closes its form and follows the pane when SSE catches up', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1');
  h.create('Waiting for created pane');
  const submitted = h.submit();
  h.respond(h.writes()[0], { workspace_id: 'w3', pane_id: 'w3:p1' });
  await settle();
  h.fail(h.reads().at(-1), 'created pane metadata is temporarily unavailable');
  await submitted;
  assert.equal(h.form(), null, 'The successful write finishes even before the pane is in the list');
  assert.equal(h.writes().length, 1, 'Waiting for metadata must not repeat the create POST');
  assert.equal(h.state().counts.panes, 2);
  assert.equal(h.state().selection.pane, 'w1:p1');
  assert.equal(h.state().pending, null, 'An unavailable pane cannot be sent to the child yet');
  h.emit(snapshot(3));
  const request = h.state().pending;
  assert.equal(request?.selection.pane, 'w3:p1', 'Fresh metadata resumes the original create navigation');
  assert.equal(h.sent.filter(item => item.type === 'dsh-herdr/select').at(-1)?.selection.pane, 'w3:p1');
  h.selection('w3', request.requestId);
  assert.equal(h.state().selection.pane, 'w3:p1');
  assert.equal(h.state().pending, null);
  assert.equal(h.writes().length, 1);
});

stateTest('late created-pane metadata cannot steal a newer project choice in the sidebar or original Ovis', async t => {
  for (const navigation of ['sidebar', 'original Ovis']) {
    const h = harness(t);
    await h.open();
    h.attachFrame();
    h.selection('w1');
    h.create('Created before another choice');
    const submitted = h.submit();
    h.respond(h.writes()[0], { workspace_id: 'w3', pane_id: 'w3:p1' });
    await settle();
    h.fail(h.reads().at(-1), 'created pane metadata is temporarily unavailable');
    await submitted;
    assert.equal(h.form(), null);
    if (navigation === 'sidebar') {
      h.diagnostic.selectWorkspace('w2');
      h.selection('w2', h.state().pending.requestId);
    } else {
      h.selection('w2');
    }
    const selectionsSent = h.sent.filter(item => item.type === 'dsh-herdr/select').length;
    h.emit(snapshot(3));
    assert.equal(h.state().counts.panes, 3);
    assert.equal(h.state().selection.pane, 'w2:p1', `${navigation} user choice must remain selected`);
    assert.equal(h.state().pending, null, `${navigation} user choice supersedes deferred create navigation`);
    assert.equal(h.sent.filter(item => item.type === 'dsh-herdr/select').length, selectionsSent, 'Late metadata must not send another selection request');
    assert.equal(h.writes().length, 1);
  }
});

stateTest('a late initial GET error preserves healthy SSE connectivity and permits management', async t => {
  const h = harness(t);
  h.diagnostic.show();
  h.emit(snapshot());
  assert.equal(h.state().connection, 'connected');
  h.fail(h.reads()[0], 'superseded initial GET failed');
  await settle();
  assert.equal(h.state().connection, 'connected', 'An obsolete GET error cannot disconnect a healthy stream');
  h.create('After healthy stream');
  const submitted = h.submit();
  assert.equal(h.writes().length, 1, 'Management must remain available after the obsolete read error');
  h.respond(h.writes()[0], { workspace_id: 'w3', pane_id: 'w3:p1' });
  await settle();
  h.respond(h.reads().at(-1), { snapshot: snapshot(3) });
  await submitted;
  assert.equal(h.form(), null);
});

stateTest('a matching child cancellation clears pending navigation without a later timeout error', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1', undefined, 'chat');
  h.diagnostic.selectWorkspace('w2');
  const request = h.state().pending;
  assert(request);
  h.cancel(request.requestId);
  assert.equal(h.state().pending, null);
  assert.equal(h.state().selection.workspace, 'w1');
  h.clock.advance(20_000);
  assert.equal(h.messages(), '', 'A cancelled navigation must not produce a switch failure');
});

stateTest('a stale cancellation cannot clear a newer project-selection request', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1');
  h.diagnostic.selectWorkspace('w2');
  const oldId = h.state().pending.requestId;
  h.diagnostic.selectWorkspace('w1');
  const newId = h.state().pending.requestId;
  assert.notEqual(oldId, newId);
  h.cancel(oldId);
  assert.equal(h.state().pending?.requestId, newId, 'Only the matching cancellation may clear pending');
  h.selection('w1', newId);
  assert.equal(h.state().pending, null);
  h.clock.advance(20_000);
  assert.equal(h.messages(), '');
});

stateTest('an untagged actual-selection report during roster wait does not cancel the requested project', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1');
  h.diagnostic.selectWorkspace('w2');
  const requestId = h.state().pending.requestId;
  h.selection('w1');
  assert.equal(h.state().selection.workspace, 'w1');
  assert.equal(h.state().pending?.requestId, requestId, 'Waiting for child metadata still requires the requested target');
  h.selection('w2', requestId);
  assert.equal(h.state().selection.workspace, 'w2');
  assert.equal(h.state().pending, null);
});

stateTest('an old successful GET cannot overwrite a newer SSE snapshot or actual selection', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1');
  const refreshed = h.refresh();
  const oldRead = h.reads().at(-1);
  h.emit(snapshot(3));
  h.selection('w3');
  h.respond(oldRead, { snapshot: snapshot() });
  await refreshed;
  assert.equal(h.state().counts.workspaces, 3);
  assert.equal(h.state().counts.panes, 3);
  assert.equal(h.state().selection.pane, 'w3:p1');
});

stateTest('a write completed after leaving Herdr cannot reopen its panel or restore pending navigation', async t => {
  const h = harness(t);
  await h.open();
  h.attachFrame();
  h.selection('w1');
  h.create('Completed after departure');
  const submitted = h.submit();
  assert.equal(h.writes().length, 1);
  h.emit(snapshot(3));
  h.diagnostic.back();
  assert.equal(h.state().activePanelId, null);
  h.respond(h.writes()[0], { workspace_id: 'w3', pane_id: 'w3:p1' });
  await submitted;
  assert.equal(h.state().activePanelId, null);
  assert.equal(h.state().nativeSidebarActive, false);
  assert.equal(h.state().pending, null);
});
