export function createSourcesClient(require) {
    const React = require('react');
    const {createPortal} = require('react-dom');
    const h = React.createElement;
    const SOURCE_BAR_FACTORY = 'workbench.sourceBar';
    const SOURCE_TAB_SLOT = 'workbench.sources';
    const PREFS_KEY = 'dsh-workbench-sources-prefs';
    const defaultPrefs = {showConversationTab: true, conversationTabOrder: 0};

    function readPrefs() {
      try { return {...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')}; }
      catch { return {...defaultPrefs}; }
    }
    function writePrefs(patch) {
      const next = {...readPrefs(), ...patch};
      if (typeof next.conversationTabOrder === 'string') next.conversationTabOrder = Number(next.conversationTabOrder);
      if (!Number.isFinite(next.conversationTabOrder)) next.conversationTabOrder = 0;
      next.showConversationTab = next.showConversationTab !== false;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
      window.dispatchEvent(new CustomEvent('dsh-workbench-sources-prefs', {detail: next}));
      return next;
    }
    function usePrefs() {
      const [prefs, setPrefs] = React.useState(readPrefs);
      React.useEffect(() => {
        const sync = () => setPrefs(readPrefs());
        window.addEventListener('dsh-workbench-sources-prefs', sync);
        window.addEventListener('storage', sync);
        return () => {
          window.removeEventListener('dsh-workbench-sources-prefs', sync);
          window.removeEventListener('storage', sync);
        };
      }, []);
      return [prefs, patch => setPrefs(writePrefs(patch))];
    }

    function SourceTab({sourceId, panelId, label, icon: TabIcon, activePanelId, onSelect, compact = false}) {
      const selected = activePanelId === panelId;
      const caption = typeof label === 'function' ? label() : label;
      return h('button', {
        type: 'button', role: 'tab', className: 'workbench-source-tab', 'data-workbench-tab': sourceId,
        'aria-label': caption, title: caption, 'aria-selected': selected, tabIndex: selected ? 0 : -1,
        onClick: () => onSelect(panelId, sourceId),
      }, TabIcon ? h(TabIcon, {size: 15}) : compact && h('span', {'aria-hidden': true}, String(caption).slice(0, 1)), h('span', {className: 'workbench-source-label'}, caption));
    }

    function Glyph({name = 'chat', size = 15}) {
      const paths = {
        chat: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z'],
      };
      return h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, ...(paths[name] || paths.chat).map((d, i) => h('path', {key: i, d})));
    }

    const styles = `
      .workbench-sidebar-seat{flex:0 0 auto;min-width:0;box-sizing:border-box;margin:0 2px 8px;pointer-events:auto}.workbench-sidebar-seat[data-compact=true]{margin:8px 0 4px}
      .workbench-source-bar{display:flex;align-items:center;min-height:36px;min-width:0;width:100%;font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);-webkit-app-region:no-drag}
      .workbench-source-tabs{display:flex;align-items:center;gap:3px;width:100%;max-width:100%;box-sizing:border-box;overflow:auto;scrollbar-width:none;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
      .workbench-source-tab{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;min-width:0;padding:0 6px;flex:1 1 0;font-size:12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}.workbench-source-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workbench-source-bar[data-compact=true]{width:36px}.workbench-source-bar[data-compact=true] .workbench-source-tabs{flex-direction:column;gap:4px;background:transparent;box-shadow:none;overflow:visible}.workbench-source-bar[data-compact=true] .workbench-source-tab{flex:none;width:30px;min-height:32px;padding:0}.workbench-source-bar[data-compact=true] .workbench-source-label{display:none}
      .workbench-source-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.workbench-source-tab[aria-selected=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px #00000012,inset 0 0 0 1px var(--dsw-alias-border-l1);font-weight:500}
      .workbench-source-tab[aria-selected=true] svg{color:var(--dsw-alias-state-business-primary)}.workbench-source-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
    `;

    const settingsStyles = `
      .dsh-plugin-settings{display:flex;flex-direction:column;gap:16px;max-width:640px;font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
      .dsh-plugin-settings h2{margin:0;font:var(--dsw-font-sm-strong-14,600 14px/20px var(--dsw-font-family))}
      .dsh-plugin-settings .lead{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
      .dsh-plugin-settings fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;margin:0;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-plugin-settings legend{padding:0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .dsh-plugin-settings label.field{display:flex;flex-direction:column;gap:6px;font-size:13px}
      .dsh-plugin-settings label.field input[type=text],.dsh-plugin-settings label.field input[type=number]{height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;padding:0 10px;font:inherit}
      .dsh-plugin-settings label.check{display:flex;align-items:flex-start;gap:8px;line-height:1.45}
      .dsh-plugin-settings .hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin:0}
      .dsh-plugin-settings .row{display:flex;flex-wrap:wrap;gap:8px}
      .dsh-plugin-settings button{appearance:none;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer;font:inherit}
      .dsh-plugin-settings button[data-primary]{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent}
      .dsh-plugin-settings .status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-plugin-settings .dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#5b9f83);flex:none}
    `;

    function SettingsPanel() {
      const [prefs, save] = usePrefs();
      const [order, setOrder] = React.useState(String(prefs.conversationTabOrder ?? 0));
      React.useEffect(() => { setOrder(String(prefs.conversationTabOrder ?? 0)); }, [prefs.conversationTabOrder]);
      return h('div', {className: 'dsh-plugin-settings', 'data-plugin-settings': 'workbench-sources'},
        h('style', null, settingsStyles),
        h('header', null, h('h2', null, '工作台来源'), h('p', {className: 'lead'}, '来源栏由本插件挂载。「DSH 会话」标签也由本插件注册；Herdr / Grok 只注册各自的业务标签。')),
        h('fieldset', null,
          h('legend', null, '会话标签'),
          h('label', {className: 'check'},
            h('input', {type: 'checkbox', checked: prefs.showConversationTab !== false, onChange: event => save({showConversationTab: event.target.checked})}),
            h('span', null, '显示「DSH 会话」标签'),
          ),
          h('label', {className: 'field'}, '标签顺序（数字越小越靠前）',
            h('input', {type: 'number', value: order, onChange: event => setOrder(event.target.value), onBlur: () => save({conversationTabOrder: Number(order)})}),
          ),
          h('p', {className: 'hint'}, 'Herdr 默认顺序为 10，Grok 为 20。把会话标签设为 0 可保持它在最左侧。更改后立即生效，无需重启 DSH。'),
        ),
        h('div', {className: 'status'}, h('span', {className: 'dot', 'aria-hidden': true}), prefs.showConversationTab !== false ? '当前会在来源栏显示「DSH 会话」' : '已隐藏「DSH 会话」，只保留已安装业务插件的标签'),
      );
    }

    function apply(ctx) {
      const subscribeSources = listener => ctx.slots.subscribe(SOURCE_TAB_SLOT, listener);
      const sourceIds = () => JSON.stringify(ctx.slots.entriesOfSlot(SOURCE_TAB_SLOT).map(entry => entry.options.id));
      function SourceBar({usePanelInfo, renderSlot, compact = false}) {
        const panelId = usePanelInfo(info => info.activePanelId);
        const registeredIds = JSON.parse(React.useSyncExternalStore(subscribeSources, sourceIds, sourceIds));
        const activePanelId = panelId !== null && registeredIds.includes(panelId) ? panelId : null;
        const onSelect = panelId => {
          if (panelId !== ctx.layout.panelInfo.getSnapshot().activePanelId) ctx.layout.selectPanel(panelId);
        };
        const navigateTabs = event => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')].filter(node => !node.disabled);
          const index = tabs.indexOf(document.activeElement); if (index < 0 || !tabs.length) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
          // 方向键只移动焦点，避免每个箭头都重挂异步来源。
          tabs[next].focus();
        };
        return h(React.Fragment, null, h('style', null, styles), h('div', {className: 'workbench-source-bar', 'data-compact': compact}, h('nav', {role: 'tablist', 'aria-label': '工作台来源', 'aria-orientation': compact ? 'vertical' : 'horizontal', className: 'workbench-source-tabs', 'data-workbench-tabs': true, onKeyDown: navigateTabs}, renderSlot(SOURCE_TAB_SLOT, {activePanelId, onSelect, compact}))));
      }
      function SidebarSourceDock({renderFactorySlot}) {
        const marker = React.useRef(null);
        const [seat, setSeat] = React.useState({host: null, compact: false});
        React.useLayoutEffect(() => {
          const isPart = (element, part) => element instanceof HTMLElement && [...element.classList].some(name => name.endsWith('_' + part));
          const onlyChild = (element, part) => { const matches = [...(element?.children || [])].filter(node => isPart(node, part)); return matches.length === 1 ? matches[0] : null; };
          const nativeFrame = marker.current?.closest('[data-shell-overlay]')?.parentElement;
          if (!isPart(nativeFrame, 'frame')) return;
          let host = null, closed = false, queued = false;
          const observer = new MutationObserver(() => {
            if (queued || closed) return; queued = true;
            queueMicrotask(() => { queued = false; if (!closed) reconcile(); });
          });
          function reconcile() {
            observer.disconnect();
            const column = onlyChild(nativeFrame, 'sidebarCol');
            const shells = [...(column?.querySelectorAll('[class]') || [])].filter(node => isPart(node, 'root') && onlyChild(node, 'regionArea'));
            const shell = shells.length === 1 ? shells[0] : null;
            const region = onlyChild(shell, 'regionArea');
            const compact = nativeFrame.getAttribute('data-sidebar-collapsed') === 'true';
            if (shell && region) {
              if (!host) { host = document.createElement('div'); host.className = 'workbench-sidebar-seat'; host.setAttribute('data-workbench-sidebar-seat', ''); }
              if (host.parentElement !== shell || host.nextSibling !== region) shell.insertBefore(host, region);
              host.dataset.compact = String(compact);
              setSeat(previous => previous.host === host && previous.compact === compact ? previous : {host, compact});
            } else {
              host?.remove();
              setSeat(previous => previous.host === null ? previous : {host: null, compact});
            }
            observer.observe(nativeFrame, {childList: true, attributes: true, attributeFilter: ['data-sidebar-collapsed']});
            if (shell) {
              for (let node = shell; node && node !== nativeFrame; node = node.parentElement) observer.observe(node, {childList: true});
            } else if (column) observer.observe(column, {childList: true, subtree: true});
          }
          reconcile();
          return () => { closed = true; observer.disconnect(); host?.remove(); };
        }, []);
        return h(React.Fragment, null, h('style', null, styles), h('span', {ref: marker, hidden: true, 'data-workbench-source-marker': true}), seat.host && createPortal(renderFactorySlot(SOURCE_BAR_FACTORY, {compact: seat.compact}), seat.host));
      }

      ctx.slots.registerFactory({name: SOURCE_BAR_FACTORY, scope: 'root', children: {[SOURCE_TAB_SLOT]: {kind: 'list', scope: 'root'}}}, SourceBar);
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: 'workbench.sidebar-sources', order: 10}, SidebarSourceDock));
      ctx.slots.inject(SOURCE_TAB_SLOT, () => {
        let disposeConversation = null;
        const syncConversation = () => {
          disposeConversation?.();
          disposeConversation = null;
          const prefs = readPrefs();
          if (prefs.showConversationTab === false) return;
          const order = Number(prefs.conversationTabOrder);
          disposeConversation = ctx.slots.register({
            name: SOURCE_TAB_SLOT, id: 'conversation', order: Number.isFinite(order) ? order : 0, label: 'DSH 会话',
          }, props => h(SourceTab, {...props, sourceId: 'conversation', panelId: null, label: 'DSH 会话', icon: () => h(Glyph, {name: 'chat', size: 15})}));
        };
        syncConversation();
        const onPrefs = () => syncConversation();
        window.addEventListener('dsh-workbench-sources-prefs', onPrefs);
        window.addEventListener('storage', onPrefs);
        return () => {
          window.removeEventListener('dsh-workbench-sources-prefs', onPrefs);
          window.removeEventListener('storage', onPrefs);
          disposeConversation?.();
        };
      });
      try {
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab', id: 'workbench-sources', order: 12, label: '工作台来源',
        }, SettingsPanel));
      } catch (error) {
        console.warn('[workbench-sources] 宿主设置页不可用', error);
      }
    }

    return {inject: ['slots', 'layout'], apply, SOURCE_BAR_FACTORY, SOURCE_TAB_SLOT, SourceTab};
}
