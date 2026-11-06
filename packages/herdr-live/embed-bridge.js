/*
 * Temporary DSH adapter for the original Ovis v0.4.20 document.
 * The facade adds this external script; the installed Ovis source and bundles
 * remain unchanged. This is deliberately a version-pinned DOM adapter, not an
 * upstream Ovis embedding API. Only this child document reads its own metadata.
 *
 * Parent -> child (version: 1):
 *   { type: "dsh-herdr/hello", version: 1 }
 *   { type: "dsh-herdr/select", version: 1, requestId: string,
 *     selection: { machine: string, workspace: string|null, pane: string|null,
 *                  view: "terminal"|"chat", tab?: string } }
 * At least one of workspace/pane must be present; workspace accepts Ovis's
 * workspace ID or its ID-slug link form. A tab is addressed by one of its panes.
 * Optional `tab` is its real tab_id: it lets a just-created target wait for the
 * original Ovis roster's tab/workspace metadata before navigating. Legacy v1
 * callers without this hint retain the immediate deep-link navigation path.
 *
 * Child -> parent (version: 1):
 *   { type: "dsh-herdr/ready", version: 1 }
 *   { type: "dsh-herdr/selection", version: 1, requestId?: string,
 *     selection: { machine, workspace, pane, view }, confirmed: true }
 *   { type: "dsh-herdr/cancelled", version: 1, requestId: string,
 *     reason: "user-navigation" }
 * Trusted pointer, key, or Back/Forward navigation cancels the pending request
 * before reporting the actual selection without its requestId. The parent only
 * cancels its matching request; untagged selections are ordinary observations.
 * "confirmed" means the active DOM pane and machine agree with the address,
 * NOT that every requested field was accepted, or that terminal input is ready.
 * Ovis may resolve a closed/zoomed pane elsewhere. Its popstate handler ignores
 * same-pane lens changes, so this adapter clicks the native header lens control
 * once, after the target pane is verified; it still waits for the actual lens.
 * A request without matching DOM/address metadata gets no false acknowledgement;
 * its bounded poll expires after 8 seconds. The parent should bound its wait too.
 *
 * Navigation uses Ovis's query and popstate path only: no iframe reload, global
 * pane/focus API, commands, terminal input, text extraction, or auth storage.
 */
(function installDshHerdrBridge() {
  "use strict";

  if (window.parent === window) return;
  const script = document.currentScript;
  const configuredOrigin = script && script.dataset ? script.dataset.dshOrigin : undefined;
  const rawOrigin = configuredOrigin === undefined ? "http://127.0.0.1:50759" : configuredOrigin;
  let parentOrigin;
  try {
    if (typeof rawOrigin !== "string" || rawOrigin.length > 512) return;
    const parsed = new URL(rawOrigin);
    if (!/^https?:$/.test(parsed.protocol) || rawOrigin.includes("@")
      || parsed.pathname !== "/" || parsed.search || parsed.hash) return;
    parentOrigin = parsed.origin;
  } catch {
    return; // An invalid explicit origin fails closed; it never enables the default.
  }

  const installKey = "__DSH_HERDR_EMBED_BRIDGE_V1__";
  if (window[installKey]) return;
  Object.defineProperty(window, installKey, { value: true });

  const VERSION = 1;
  const POLL_MS = 150;
  const WAIT_MS = 8000;
  const STABLE_MS = 100;
  const QUERY_NAMES = ["machine", "ws", "pane", "view", "file", "settings", "section", "new", "cwd", "name", "agent", "sidebar"];
  const FRAME_SELECTOR = ".pane-frame.is-current:not(.is-hidden)[data-layout-pane]";
  const observer = new MutationObserver(() => scheduleCheck());
  let observedNodes = new Set();
  let pending = null;
  let checkTimer = null;
  let pollTimer = null;
  let pollUntil = 0;
  let candidateKey = "";
  let candidateSince = 0;
  let lastSentKey = "";
  let forceReport = false;

  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const identifier = (value, max = 256) => typeof value === "string" && value.length > 0
    && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  const nullableIdentifier = (value) => value === null || identifier(value);
  const validView = (value) => value === "terminal" || value === "chat";

  function post(message) {
    window.parent.postMessage({ ...message, version: VERSION }, parentOrigin);
  }

  function stopPolling() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    pollUntil = Date.now() + WAIT_MS;
    const poll = () => {
      pollTimer = null;
      if (Date.now() >= pollUntil) { pending = null; return; }
      scheduleCheck(0);
      pollTimer = window.setTimeout(poll, POLL_MS);
    };
    pollTimer = window.setTimeout(poll, POLL_MS);
    scheduleCheck();
  }

  function scheduleCheck(delay = 60) {
    if (checkTimer !== null) return;
    checkTimer = window.setTimeout(() => {
      checkTimer = null;
      checkSelection();
    }, delay);
  }

  function observeMetadata() {
    // No subtree observer and no characterData observer: xterm, chat messages,
    // input values, and their text nodes never enter a MutationRecord here.
    const nodes = new Map();
    const attributes = { attributes: true, attributeFilter: ["class", "data-layout-pane", "data-machine", "data-pane-owner", "aria-hidden"] };
    for (const slot of document.querySelectorAll(".pane-slot[data-machine]")) {
      if (slot.parentElement) nodes.set(slot.parentElement, { childList: true });
      nodes.set(slot, { ...attributes, childList: true });
      for (const canvas of slot.querySelectorAll(".pane-canvas")) nodes.set(canvas, { ...attributes, childList: true });
      for (const frame of slot.querySelectorAll(".pane-frame[data-layout-pane]")) {
        nodes.set(frame, { ...attributes, childList: true });
        const body = frame.querySelector(".pane-frame-body");
        if (body) nodes.set(body, { childList: true });
        const stack = frame.querySelector(".terminal-stack");
        if (stack) nodes.set(stack, attributes);
      }
    }
    if (nodes.size === observedNodes.size && [...nodes.keys()].every((node) => observedNodes.has(node))) return;
    observer.disconnect();
    observedNodes = new Set(nodes.keys());
    for (const [node, options] of nodes) observer.observe(node, options);
  }

  function renderedSelection() {
    const query = new URLSearchParams(window.location.search);
    const machine = query.get("machine") || "local";
    const pane = query.get("pane");
    const ws = query.get("ws");
    if (!identifier(machine) || !identifier(pane) || (ws !== null && !identifier(ws))) return null;
    const cut = ws === null ? -1 : ws.indexOf("-");
    const workspace = ws !== null && cut > 0 ? ws.slice(0, cut) : ws;
    const slots = [...document.querySelectorAll(".pane-slot[data-machine]")];
    const activeSlots = slots.filter((slot) => slot.classList.contains("is-active"));
    const shownSlots = activeSlots.length ? activeSlots : slots.filter((slot) => !slot.classList.contains("is-inactive"));
    if (shownSlots.length !== 1) return null;
    const slot = shownSlots[0];
    if (slot.getAttribute("data-machine") !== machine) return null;
    const frames = [...slot.querySelectorAll(FRAME_SELECTOR)];
    if (frames.length !== 1 || frames[0].getAttribute("data-layout-pane") !== pane) return null;
    const stack = frames[0].querySelector(".terminal-stack");
    if (!stack) return null;
    const view = stack.classList.contains("is-chat") && !stack.classList.contains("is-peek") ? "chat" : "terminal";
    return { machine, workspace, pane, view };
  }

  function workspaceId(value) {
    const cut = value === null ? -1 : value.indexOf("-");
    return cut > 0 ? value.slice(0, cut) : value;
  }

  function matchesTarget(target, actual) {
    return actual !== null && target.machine === actual.machine && (target.pane !== null
      ? target.pane === actual.pane : workspaceId(target.workspace) === actual.workspace);
  }

  function targetRosterReady(target, actual) {
    if (target.tab === undefined || actual === null) return null;
    if (matchesTarget(target, actual)) return true;
    if (target.machine !== actual.machine || target.workspace === null) return null;
    const workspace = workspaceId(target.workspace);
    if (workspace === actual.workspace) {
      // The current workspace's strip is built from the original snapshot. Its
      // new tab appearing proves that React's roster has caught up with creation.
      const slots = [...document.querySelectorAll(".pane-slot[data-machine]")];
      const active = slots.find((slot) => slot.getAttribute("data-machine") === target.machine
        && !slot.classList.contains("is-inactive"));
      if (!active) return false;
      return [...active.querySelectorAll('.tab-strip-tab[role="tab"][data-tab-id]')]
        .some((tab) => tab.getAttribute("data-tab-id") === target.tab);
    }
    // v0.4.20 uses data-workspace (not data-workspace-id). Machine groups have
    // no machine ID attribute: only the current machine is safely identifiable.
    // CSS sidebar=hidden retains these rows. A folded/unmounted roster cannot
    // prove absence, so that case keeps the ordinary deep-link path.
    const groups = [...document.querySelectorAll(".machine-group.is-current")];
    if (groups.length !== 1 || !groups[0].querySelector(".machine-workspaces")) return null;
    return [...groups[0].querySelectorAll(".workspace-group[data-workspace]")]
      .some((row) => row.getAttribute("data-workspace") === workspace);
  }

  function requestedLensNeedsWork(actual) {
    if (!pending) return false;
    const target = pending.selection;
    const cut = target.workspace === null ? -1 : target.workspace.indexOf("-");
    const workspace = cut > 0 ? target.workspace.slice(0, cut) : target.workspace;
    if (target.machine !== actual.machine || (target.pane !== null
      ? target.pane !== actual.pane : workspace !== actual.workspace)) return false;

    // Pinned Ovis v0.4.20, App.tsx's original header lens switch. Its stable
    // role/name and Lucide icon identify only Chat/Terminal, regardless of locale.
    // Do not use pane-slot-action: that group also contains "Close this half".
    const groups = [...document.querySelectorAll('.app-header .view-switch[role="group"][aria-label="Pane view"]')];
    const buttons = groups.length === 1 ? [...groups[0].querySelectorAll(':scope > button[type="button"][aria-pressed]')] : [];
    const icon = target.view === "terminal" ? "svg.lucide-square-terminal" : "svg.lucide-message-square";
    const choices = buttons.filter((button) => button.querySelector(icon));
    const button = buttons.length === 2 && choices.length === 1 ? choices[0] : null;
    // The logical lens may still be Chat while a terminal peek is visible. A
    // Terminal pick should also use the native control to end that transient peek.
    const needsChange = actual.view !== target.view || (button && button.getAttribute("aria-pressed") !== "true");
    if (!needsChange) return false;
    if (button && !pending.lensClicked && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
      pending.lensClicked = true; // At most one native selection action per request.
      try { button.click(); } catch { /* Keep waiting; a click alone confirms nothing. */ }
    }
    candidateKey = "";
    return true; // Missing/disabled controls wait for the bounded request timeout.
  }

  function dispatchNavigation() {
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }

  function navigatePending(request, current, retry = false) {
    const selection = request.selection;
    const query = new URLSearchParams(window.location.search);
    // Explicit selection leaves URL-driven file/settings/create forms behind.
    // Unknown query parameters survive; no caller-supplied URL is accepted.
    for (const name of QUERY_NAMES) query.delete(name);
    if (selection.machine !== "local") query.set("machine", selection.machine);
    if (selection.workspace !== null) query.set("ws", selection.workspace);
    if (selection.pane !== null) query.set("pane", selection.pane);
    query.set("view", selection.view);
    query.set("sidebar", "hidden");
    const hash = window.location.hash.startsWith("#auth=") ? "" : window.location.hash;
    const url = `${window.location.pathname}?${query.toString()}${hash}`;
    candidateKey = "";
    // One initial navigation and, only with positive roster evidence after Ovis
    // normalized back to an old rendered pane, at most one replacement replay.
    const samePane = current && current.machine === selection.machine && current.pane === selection.pane;
    const method = retry || samePane ? "replaceState" : "pushState";
    request.navigationAttempts += 1;
    try {
      window.history[method]({ "ovis:nav": true }, "", url);
      dispatchNavigation();
      return true;
    } catch {
      if (pending === request) pending = null;
      return false;
    }
  }

  function checkSelection() {
    observeMetadata();
    let actual = renderedSelection();
    let waitingForRoster = false;
    if (pending && Date.now() >= pending.deadline) pending = null;
    if (pending && pending.navigationAttempts === 0) {
      waitingForRoster = targetRosterReady(pending.selection, actual) === false;
      if (!waitingForRoster) {
        if (!navigatePending(pending, actual)) return;
        actual = renderedSelection();
      }
    }
    if (pending && pending.navigationAttempts > 0 && pending.replayOnMount && document.querySelector(".pane-slot[data-machine]")) {
      pending.replayOnMount = false;
      // An early request can precede React's popstate effect. Replay once after
      // its first canvas mounts, never periodically or over a later native pick.
      const query = new URLSearchParams(window.location.search);
      const target = pending.selection;
      const stillRequested = (query.get("machine") || "local") === target.machine
        && query.get("pane") === target.pane && query.get("ws") === target.workspace;
      if (!actual && stillRequested) {
        dispatchNavigation();
        actual = renderedSelection();
      }
    }
    if (pending && pending.navigationAttempts > 0 && actual && !matchesTarget(pending.selection, actual)) {
      const ready = targetRosterReady(pending.selection, actual);
      waitingForRoster = ready === false;
      if (ready === true && pending.navigationAttempts < 2) {
        if (!navigatePending(pending, actual, true)) return;
        actual = renderedSelection();
      }
    }
    if (!actual) { candidateKey = ""; return; }
    if (!waitingForRoster && requestedLensNeedsWork(actual)) return;
    const key = JSON.stringify(actual);
    const now = Date.now();
    if (candidateKey !== key) {
      candidateKey = key;
      candidateSince = now;
      scheduleCheck(STABLE_MS);
      return;
    }
    if (now - candidateSince < STABLE_MS) {
      scheduleCheck(STABLE_MS - (now - candidateSince));
      return;
    }
    if (pending && now - pending.startedAt < STABLE_MS) {
      scheduleCheck(STABLE_MS);
      return;
    }
    if ((pending && !waitingForRoster) || forceReport || key !== lastSentKey) {
      post({ type: "dsh-herdr/selection", ...(pending && !waitingForRoster ? { requestId: pending.requestId } : {}), selection: actual, confirmed: true });
      lastSentKey = key;
    }
    forceReport = false;
    if (waitingForRoster) return; // Existing selection may be reported, never as the new target's ACK.
    pending = null;
    stopPolling();
  }

  function select(selection, requestId) {
    const current = renderedSelection();
    const startedAt = Date.now();
    pending = { selection, requestId, startedAt, deadline: startedAt + WAIT_MS, navigationAttempts: 0,
      replayOnMount: !document.querySelector(".pane-slot[data-machine]") };
    candidateKey = "";
    if (targetRosterReady(selection, current) !== false) navigatePending(pending, current);
    startPolling();
  }

  function onMessage(event) {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    const data = event.data;
    if (!record(data) || data.version !== VERSION) return;
    if (data.type === "dsh-herdr/hello") {
      post({ type: "dsh-herdr/ready" });
      forceReport = true;
      startPolling();
      return;
    }
    if (data.type !== "dsh-herdr/select" || !identifier(data.requestId, 160) || !record(data.selection)) return;
    const item = data.selection;
    if (!identifier(item.machine) || !nullableIdentifier(item.workspace) || !nullableIdentifier(item.pane)
      || (item.workspace === null && item.pane === null) || !validView(item.view)
      || (item.tab !== undefined && !identifier(item.tab))) return;
    select({ machine: item.machine, workspace: item.workspace, pane: item.pane, view: item.view,
      ...(item.tab === undefined ? {} : { tab: item.tab }) }, data.requestId);
  }

  // Ovis uses History for native pane/tab/lens changes. Preserve the captured
  // methods' receiver, arguments, return value, and exceptions. If Ovis later
  // wraps these methods (sheetHistory does), its wrapper still calls this one.
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    try {
      window.history[method] = function observeOvisHistory(...args) {
        const result = Reflect.apply(original, this, args);
        scheduleCheck();
        return result;
      };
    } catch { /* Metadata observation and bounded request polls remain available. */ }
  }

  // A real user action in Ovis wins over a delayed parent selection. In
  // particular, do not replay into a form the user opened while a roster lagged.
  // Native Back/Forward is trusted; our synthetic popstate and lens click are not.
  const userTookOver = (event) => {
    if (!pending || event.isTrusted !== true) return;
    post({ type: "dsh-herdr/cancelled", requestId: pending.requestId, reason: "user-navigation" });
    pending = null;
    stopPolling();
    forceReport = true;
    scheduleCheck();
  };
  window.addEventListener("pointerdown", userTookOver, true);
  window.addEventListener("keydown", userTookOver, true);
  window.addEventListener("message", onMessage);
  window.addEventListener("popstate", (event) => {
    userTookOver(event);
    scheduleCheck();
  }, true);
  window.addEventListener("pageshow", () => {
    post({ type: "dsh-herdr/ready" });
    forceReport = true;
    startPolling();
  });
  window.addEventListener("pagehide", () => {
    stopPolling();
    if (checkTimer !== null) window.clearTimeout(checkTimer);
    checkTimer = null;
    pending = null;
    observer.disconnect();
    observedNodes.clear();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scheduleCheck(), { once: true });
  post({ type: "dsh-herdr/ready" });
  forceReport = true;
  startPolling();
})();
