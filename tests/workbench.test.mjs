import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const bundle = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');
test('one installed client registers all three sources and releases module resources', () => {
  const registrations = [], entries = new Set(), effects = [], listeners = new Map();
  const window = {
    __ModuleLoader__:{load:registration => registrations.push(registration)},
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
  };
  const storage = new Map();
  const localStorage = {getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)};
  const React = {createElement:(type, props, ...children) => ({type, props, children})};
  const context = vm.createContext({window, localStorage, document:{baseURI:'http://127.0.0.1/'}, URL, setTimeout, clearTimeout, setInterval, clearInterval, console});
  vm.runInContext(bundle, context);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'dsh-plugin-workbench-suite');
  const plugin = registrations[0].factory(name => {
    if (name === 'react') return React;
    if (name === 'react-dom') return {createPortal:child => child};
    throw new Error('Unexpected external module: ' + name);
  });
  const register = (options, component) => {
    const entry = {options, component}; entries.add(entry);
    const dispose = () => entries.delete(entry); effects.push(dispose); return dispose;
  };
  const ctx = {
    slots:{registerFactory() {}, register, inject(_name, apply) { const dispose = apply(); if (dispose) effects.push(dispose); }, entriesOfSlot:() => []},
    layout:{panelInfo:{getSnapshot:() => ({activePanelId:null}), subscribe:() => () => {}}, selectPanel() {}},
    effect(apply) { const dispose = apply(); if (dispose) effects.push(dispose); },
  };
  plugin.apply(ctx);
  assert.deepEqual([...entries].filter(entry => entry.options.name === 'workbench.sources').map(entry => entry.options.id).sort(), ['conversation', 'grok', 'herdr']);
  assert.equal([...entries].filter(entry => entry.options.name === 'main').length, 2);
  assert.equal(typeof window.__HERDR_LIVE__, 'object');
  for (const dispose of effects.reverse()) dispose();
  assert.equal(entries.size, 0);
  assert.equal(window.__HERDR_LIVE__, undefined);
  assert.equal([...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0), 0);
});
