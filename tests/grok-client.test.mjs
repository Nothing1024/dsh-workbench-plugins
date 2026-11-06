import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import vm from 'node:vm';

// Load the shipped factory without a browser or plugin application. The VM has
// no fetch, sockets, credential resolver, or real timers. All I/O is deferred
// data supplied by the tests, including responses that finish after departure.
const clientUrl = new URL('../packages/grok-workbench/client.js', import.meta.url);
const clientSource = readFileSync(clientUrl, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => nextTurn();
const stateTest = (name, run) => test(name, { timeout: 3000 }, run);

function loadClient() {
  let plugin;
  const window = {
    __ModuleLoader__: {
      load(module) {
        assert.equal(module.id, 'dsh-plugin-grok-workbench');
        assert.equal(plugin, undefined, 'Only one client factory may register');
        plugin = module.factory(name => {
          if (name === 'react') return { createElement() { throw new Error('Store tests must not render React'); } };
          if (name === 'react-dom') return { createPortal() { throw new Error('Store tests must not render portals'); } };
          if (name === 'dsh-plugin-workbench-sources') return { SOURCE_TAB_SLOT: 'offline.source-tabs', SourceTab() {} };
          throw new Error('Unexpected dependency in offline Grok fixture: ' + name);
        });
      },
    },
  };
  vm.runInNewContext(clientSource, { window }, { filename: clientUrl.pathname });
  assert.equal(typeof plugin?.createGrokStore, 'function');
  assert.equal(typeof plugin?.mergeEntries, 'function');
  return plugin;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function layout(suffix = '') {
  const bots = ['a', 'b'].map(id => ({
    id, name: id.toUpperCase() + suffix, description: 'Synthetic bot ' + id,
    state: 'idle', isRunning: false, hidden: false,
  }));
  return {
    bots, pinned: ['b'], pinnedBots: [bots[1]], ungrouped: [bots[1]],
    sections: [{ id: 'work', name: 'Work', collapsed: false, agentIds: ['a'], missing: 0, bots: [bots[0]] }],
  };
}

function entry(version, text, extra = {}) {
  return { version, at: version * 1000, kind: 'message', role: 'bot', text, ...extra };
}

function harness(t) {
  const requests = [], timers = new Map(), scheduled = [], nonces = [];
  let serial = 0;
  const plugin = loadClient();
  const store = plugin.createGrokStore({
    nonce() {
      const value = '00000000-0000-4000-8000-' + String(nonces.length + 1).padStart(12, '0');
      nonces.push(value);
      return value;
    },
    request(path, body) {
      const url = new URL(path, 'http://offline.invalid');
      assert.equal(url.origin, 'http://offline.invalid', 'Requests stay in the synthetic service');
      assert(['/layout', '/transcript', '/send', '/pin', '/interrupt', '/delete', '/group', '/group-rename', '/group-delete', '/rename'].includes(url.pathname));
      const result = deferred();
      requests.push({
        path: url.pathname, id: url.searchParams.get('id'), cursor: url.searchParams.get('cursor'),
        method: body === undefined ? 'GET' : 'POST', body: body === undefined ? null : plain(body),
        result, finished: false,
      });
      return result.promise;
    },
    schedule(callback, delay) {
      const id = ++serial;
      const timer = { id, callback, delay };
      timers.set(id, timer);
      scheduled.push(timer);
      return id;
    },
    cancel: id => timers.delete(id),
  });
  t.after(() => store.dispose());
  function respond(request, value) {
    assert(request && !request.finished, 'Expected an unresolved synthetic request');
    request.finished = true;
    request.result.resolve(plain(value));
  }
  function fail(request, message) {
    assert(request && !request.finished, 'Expected an unresolved synthetic request');
    request.finished = true;
    request.result.reject(new Error(message));
  }
  const reads = (path, id) => requests.filter(request => request.method === 'GET' && (!path || request.path === path) && (!id || request.id === id));
  const writes = () => requests.filter(request => request.method === 'POST');
  const pendingRead = (path, id) => reads(path, id).filter(request => !request.finished).at(-1);
  const h = {
    store, requests, timers, scheduled, nonces, respond, fail, reads, writes, pendingRead,
    state: () => plain(store.getSnapshot()),
    tick() { for (const timer of [...timers.values()]) timer.callback(); },
    async ready() {
      store.start();
      respond(pendingRead('/layout'), layout());
      await settle();
      respond(pendingRead('/transcript', 'a'), { entries: [entry(10, 'Initial A')], cursor: '0:9' });
      await settle();
    },
  };
  return h;
}

stateTest('drafts belong to each bot and survive source stop/start', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Unsent A');
  h.store.select('b');
  h.store.setDraft('b', 'Unsent B');
  h.respond(h.pendingRead('/transcript', 'b'), { entries: [entry(20, 'Initial B')], cursor: '0:19' });
  await settle();
  h.store.stop();
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.state().drafts, { a: 'Unsent A', b: 'Unsent B' });
  h.store.start();
  h.respond(h.pendingRead('/layout'), layout(' refreshed'));
  h.respond(h.pendingRead('/transcript', 'b'), { entries: [entry(21, 'New B')], cursor: '0:20' });
  await settle();
  assert.equal(h.state().selected, 'b');
  assert.deepEqual(h.state().drafts, { a: 'Unsent A', b: 'Unsent B' });
  h.store.select('a');
  assert.equal(h.state().drafts[h.state().selected], 'Unsent A');
  assert.equal(h.timers.size, 1, 'Restart installs only one poller');
});

for (const kind of ['layout', 'transcript']) {
  for (const completion of ['success', 'failure']) {
    stateTest('a late ' + kind + ' ' + completion + ' cannot change state after leaving Grok', async t => {
      const h = harness(t);
      await h.ready();
      let operation;
      if (kind === 'layout') operation = h.store.refresh();
      else h.store.select('b');
      const stale = h.pendingRead('/' + kind, kind === 'transcript' ? 'b' : undefined);
      h.store.stop();
      const stopped = h.state();
      if (completion === 'failure') h.fail(stale, 'Obsolete request failed');
      else h.respond(stale, kind === 'layout' ? layout(' stale') : { entries: [entry(999, 'Obsolete transcript')], cursor: 'stale' });
      await operation;
      await settle();
      assert.deepEqual(h.state(), stopped, 'Late response must not change data, errors, or loading flags');
      assert.equal(h.timers.size, 0);
    });
  }
}

for (const kind of ['layout', 'transcript']) {
  stateTest('a prior activation ' + kind + ' response cannot replace a restarted source', async t => {
    const h = harness(t);
    await h.ready();
    let operation;
    if (kind === 'layout') operation = h.store.refresh();
    else h.store.select('b');
    const stale = h.pendingRead('/' + kind, kind === 'transcript' ? 'b' : undefined);
    h.store.stop();
    h.store.start();
    const currentLayout = h.pendingRead('/layout');
    const currentTail = h.pendingRead('/transcript', kind === 'layout' ? 'a' : 'b');
    h.respond(currentLayout, layout(' current'));
    h.respond(currentTail, { entries: [entry(30, 'Current activation')], cursor: 'current-cursor' });
    await settle();
    const current = h.state();
    h.respond(stale, kind === 'layout' ? layout(' stale') : { entries: [entry(999, 'Previous activation')], cursor: 'stale-cursor' });
    await operation;
    await settle();
    assert.deepEqual(h.state(), current);
    assert.equal(h.timers.size, 1);
  });
}

stateTest('a prior bot response cannot replace the newly selected bot transcript', async t => {
  const h = harness(t);
  h.store.start();
  h.respond(h.pendingRead('/layout'), layout());
  await settle();
  const firstBot = h.pendingRead('/transcript', 'a');
  h.store.select('b');
  h.respond(h.pendingRead('/transcript', 'b'), { entries: [entry(20, 'B response')], cursor: 'b-cursor' });
  await settle();
  const selectedLog = h.state().logs.b;
  h.respond(firstBot, { entries: [entry(90, 'Late A response')], cursor: 'a-cursor' });
  await settle();
  assert.equal(h.state().selected, 'b');
  assert.deepEqual(h.state().logs.b, selectedLog, 'Selected transcript and pagination stay owned by B');
  assert.equal(h.state().logs.a.entries[0].text, 'Late A response', 'An inactive bot may populate only its own cache');
});

stateTest('concurrent sends are deduplicated and a late ack keeps newer drafts and selection', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'First prompt');
  const first = h.store.send();
  const duplicate = h.store.send();
  assert.equal(h.writes().length, 1);
  assert.deepEqual(h.writes()[0].body, { id: 'a', prompt: 'First prompt', clientNonce: h.nonces[0] });
  assert.match(h.writes()[0].body.clientNonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(h.nonces.length, 1, 'Duplicate pending sends share the same operation identifier');
  assert.equal(await duplicate, false);
  h.store.setDraft('a', 'Next A draft');
  h.store.select('b');
  h.store.setDraft('b', 'Independent B draft');
  h.respond(h.writes()[0], { ok: true });
  assert.equal(await first, true);
  assert.equal(h.state().selected, 'b');
  assert.deepEqual(h.state().drafts, { a: 'Next A draft', b: 'Independent B draft' });
  assert.equal(h.state().pending.a, null);
  assert.equal(h.writes().length, 1);
});

stateTest('a delayed send ack preserves a new draft even when the user retypes the same text', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Repeat this prompt');
  const sent = h.store.send();
  h.store.setDraft('a', 'A new composition');
  h.store.setDraft('a', 'Repeat this prompt');
  h.respond(h.writes()[0], { ok: true });
  assert.equal(await sent, true);
  assert.equal(h.state().drafts.a, 'Repeat this prompt', 'Draft ownership follows edits, not only current text equality');
  assert.equal(h.writes().length, 1);
});

stateTest('a successful send remains committed while failed refreshes are visible and retryable', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Committed message');
  const sent = h.store.send();
  h.respond(h.writes()[0], { ok: true });
  assert.equal(await sent, true, 'Read reconciliation must not turn a confirmed send into a failed send');
  const layoutRead = h.pendingRead('/layout');
  const tailRead = h.pendingRead('/transcript', 'a');
  assert(layoutRead);
  assert(tailRead);
  h.fail(layoutRead, 'Roster refresh failed');
  h.fail(tailRead, 'Transcript refresh failed');
  await settle();
  assert.equal(h.state().drafts.a, '');
  assert.equal(h.state().pending.a, null);
  assert.equal(h.state().notices.a, '消息已发送');
  assert.equal(h.state().error, 'Roster refresh failed');
  assert.equal(h.state().logs.a.error, 'Transcript refresh failed');
  assert.equal(h.writes().length, 1);
  const retried = h.store.refresh();
  h.respond(h.pendingRead('/layout'), layout());
  await retried;
  h.respond(h.pendingRead('/transcript', 'a'), { entries: [entry(11, 'Reply after retry')], cursor: '0:10' });
  await settle();
  assert.equal(h.state().error, null);
  assert.equal(h.state().logs.a.error, null);
  assert.equal(h.writes().length, 1, 'Retrying metadata reads must never repeat the message POST');
});

stateTest('a failed send retains a failed outbox item and exposes the write failure', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Keep until acknowledged');
  const sent = h.store.send();
  h.fail(h.writes()[0], 'Synthetic send rejected');
  assert.equal(await sent, false);
  assert.equal(h.state().drafts.a, '');
  assert.equal(h.state().outbox.a[0].text, 'Keep until acknowledged');
  assert.equal(h.state().outbox.a[0].status, 'failed');
  assert.equal(h.state().outbox.a[0].nonce, h.writes()[0].body.clientNonce);
  assert.equal(h.state().notices.a, 'Synthetic send rejected');
  assert.equal(h.state().pending.a, null);
  assert.equal(h.writes().length, 1);
});

stateTest('an unacknowledged send reuses its nonce across retry and source restart, then renews it after success', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Repeatable prompt');
  const first = h.store.send();
  const firstBody = h.writes()[0].body;
  h.fail(h.writes()[0], 'Acknowledgement lost');
  assert.equal(await first, false);
  h.store.stop();
  h.store.start();
  const retried = h.store.retry('a', firstBody.clientNonce);
  assert.deepEqual(h.writes()[1].body, firstBody, 'Retrying the failed outbox item must preserve its original operation identifier');
  h.respond(h.writes()[1], { ok: true });
  assert.equal(await retried, true);
  assert.equal(h.state().drafts.a, '');
  h.store.setDraft('a', 'Repeatable prompt');
  const newSend = h.store.send();
  assert.notEqual(h.writes()[2].body.clientNonce, firstBody.clientNonce, 'A newly composed message after success is a distinct operation');
  assert.equal(h.writes()[2].body.prompt, firstBody.prompt);
  h.respond(h.writes()[2], { ok: true });
  assert.equal(await newSend, true);
  assert.equal(h.nonces.length, 2);
});

stateTest('editing a rejected draft creates a new nonce even when its text returns to the original', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Same text after editing');
  const first = h.store.send();
  h.fail(h.writes()[0], 'Synthetic send failure');
  assert.equal(await first, false);
  h.store.setDraft('a', 'Another composition');
  h.store.setDraft('a', 'Same text after editing');
  const next = h.store.send();
  assert.notEqual(h.writes()[1].body.clientNonce, h.writes()[0].body.clientNonce);
  assert.equal(h.writes()[1].body.prompt, h.writes()[0].body.prompt);
  h.respond(h.writes()[1], { ok: true });
  assert.equal(await next, true);
});

stateTest('send retry identifiers stay separate for bots with identical prompt text', async t => {
  const h = harness(t);
  await h.ready();
  h.store.setDraft('a', 'Identical prompt');
  const firstA = h.store.send();
  h.fail(h.writes()[0], 'A acknowledgement lost');
  assert.equal(await firstA, false);
  h.store.select('b');
  h.store.setDraft('b', 'Identical prompt');
  const firstB = h.store.send();
  h.fail(h.writes()[1], 'B acknowledgement lost');
  assert.equal(await firstB, false);
  assert.notEqual(h.writes()[0].body.clientNonce, h.writes()[1].body.clientNonce);
  h.store.select('a');
  const retriedA = h.store.retry('a', h.writes()[0].body.clientNonce);
  assert.deepEqual(h.writes()[2].body, h.writes()[0].body);
  h.respond(h.writes()[2], { ok: true });
  assert.equal(await retriedA, true);
  assert.equal(h.state().drafts.b, '');
  assert.equal(h.state().outbox.b[0].text, 'Identical prompt');
  assert.equal(h.state().outbox.b[0].status, 'failed');
});

stateTest('polling preserves loaded history, its pagination cursor, scroll position, and revised entries', async t => {
  const h = harness(t);
  await h.ready();
  const older = h.store.loadOlder();
  assert.equal(h.pendingRead('/transcript', 'a').cursor, '0:9');
  h.respond(h.pendingRead('/transcript', 'a'), { entries: [entry(2, 'Older A'), entry(3, 'Another old A')], cursor: '0:1' });
  await older;
  h.store.setScroll('a', { top: 125, bottom: false });
  h.tick();
  h.respond(h.pendingRead('/layout'), layout());
  await settle();
  h.respond(h.pendingRead('/transcript', 'a'), { entries: [entry(10, 'Initial A revised'), entry(11, 'Newest A')], cursor: '0:10' });
  await settle();
  const log = h.state().logs.a;
  assert.deepEqual(log.entries.map(item => item.version), [2, 3, 10, 11]);
  assert.equal(log.entries.find(item => item.version === 10).text, 'Initial A revised');
  assert.equal(log.cursor, '0:1', 'A tail poll cannot replace the older-history cursor');
  assert.deepEqual(log.scroll, { top: 125, bottom: false });
  const nextPage = h.store.loadOlder();
  assert.equal(h.pendingRead('/transcript', 'a').cursor, '0:1');
  h.respond(h.pendingRead('/transcript', 'a'), { entries: [entry(0, 'Oldest A')], cursor: '' });
  await nextPage;
  assert.equal(h.state().logs.a.cursor, '');
  assert.deepEqual(h.state().logs.a.entries.map(item => item.version), [0, 2, 3, 10, 11]);
});

for (const kind of ['layout', 'transcript']) {
  for (const completion of ['success', 'failure']) {
    stateTest('a write invalidates a preceding ' + kind + ' ' + completion + ' without suppressing fresh reads', async t => {
      const h = harness(t);
      await h.ready();
      h.tick();
      const staleLayout = h.pendingRead('/layout');
      const staleTail = h.pendingRead('/transcript', 'a');
      h.store.setDraft('a', 'Send during old reads');
      const sent = h.store.send();
      h.respond(h.writes()[0], { ok: true });
      assert.equal(await sent, true);
      const currentLayout = h.pendingRead('/layout');
      const currentTail = h.pendingRead('/transcript', 'a');
      assert.notEqual(currentLayout, staleLayout, 'The confirmed write requires fresh roster reconciliation');
      assert.notEqual(currentTail, staleTail, 'A preceding transcript read cannot block reading the sent message');
      h.respond(currentLayout, layout(' after write'));
      h.respond(currentTail, { entries: [entry(11, 'Reply after write')], cursor: '0:10' });
      await settle();
      const current = h.state();
      const stale = kind === 'layout' ? staleLayout : staleTail;
      if (completion === 'failure') h.fail(stale, 'Obsolete pre-write read failed');
      else h.respond(stale, kind === 'layout' ? layout(' before write') : { entries: [entry(10, 'Old transcript revision')], cursor: 'old-cursor' });
      await settle();
      assert.deepEqual(h.state(), current, 'Pre-write data or errors cannot replace the reconciled state');
      assert.equal(h.writes().length, 1);
    });
  }
}

stateTest('an older page finishing after a tail poll cannot downgrade the same entry revision', async t => {
  const h = harness(t);
  await h.ready();
  const older = h.store.loadOlder();
  const olderRequest = h.pendingRead('/transcript', 'a');
  assert.equal(olderRequest.cursor, '0:9');
  h.tick();
  h.respond(h.pendingRead('/layout'), layout());
  await settle();
  const tail = h.pendingRead('/transcript', 'a');
  assert.notEqual(tail, olderRequest);
  assert.equal(tail.cursor, null);
  h.respond(tail, { entries: [entry(10, 'Completed current reply'), entry(11, 'Fresh tail')], cursor: '0:10' });
  await settle();
  h.respond(olderRequest, { entries: [entry(2, 'Earlier history'), entry(10, 'Outdated streaming fragment')], cursor: '0:1' });
  await older;
  const log = h.state().logs.a;
  assert.deepEqual(log.entries.map(item => item.version), [2, 10, 11]);
  assert.equal(log.entries.find(item => item.version === 10).text, 'Completed current reply');
  assert.equal(log.cursor, '0:1');
});

stateTest('entry revisions replace the same version while preserving distinct unversioned entries', () => {
  const { mergeEntries } = loadClient();
  const original = entry(2, 'Streaming fragment');
  const unversioned = { kind: 'notice', role: 'notice', at: 3000, text: 'Legacy notice' };
  const previous = Object.freeze([Object.freeze(original), Object.freeze(unversioned)]);
  const revised = entry(2, 'Completed reply');
  const merged = plain(mergeEntries(previous, [entry(0, 'Oldest'), revised, { ...unversioned }, { ...unversioned, text: 'Another notice' }]));
  assert.equal(merged.length, 4);
  assert.equal(merged[0].version, 0, 'Version zero is a valid entry identity');
  assert.equal(merged.filter(item => item.version === 2).length, 1);
  assert.equal(merged.find(item => item.version === 2).text, 'Completed reply');
  assert.equal(merged.filter(item => item.version == null).length, 2);
  assert.equal(previous[0].text, 'Streaming fragment', 'Merging may not mutate earlier snapshots');
});

stateTest('dispose cancels polling and ignores unresolved reads and later starts', async t => {
  const h = harness(t);
  h.store.start();
  const pending = h.pendingRead('/layout');
  const callback = h.scheduled[0].callback;
  let notifications = 0;
  h.store.subscribe(() => { notifications += 1; });
  assert.equal(h.timers.size, 1);
  h.store.dispose();
  assert.equal(h.timers.size, 0);
  const disposed = h.state(), notificationCount = notifications, requestCount = h.requests.length;
  h.respond(pending, layout(' after dispose'));
  await settle();
  callback(); // Even a callback already queued before cancellation must be harmless.
  h.store.start();
  await settle();
  assert.deepEqual(h.state(), disposed);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, requestCount);
  assert.equal(notifications, notificationCount);
});
