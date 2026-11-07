const PACKAGE_NAME = 'dsh-plugin-workbench-suite';

export function createSettingsClient(require) {
  const React = require('react');
  const h = React.createElement;

  function openSettings(ctx) {
    const navigation = typeof ctx.get === 'function' ? ctx.get('pluginNavigation') : ctx.pluginNavigation;
    if (!navigation) return false;
    navigation.openBundle(PACKAGE_NAME);
    return true;
  }

  function apply(ctx, panels) {
    function SettingsPanel() {
      const [active, setActive] = React.useState('grok');
      const id = React.useId();
      const tabs = [
        {id:'sources', label:'工作台来源', component:panels.sources},
        {id:'herdr', label:'Herdr', component:panels.herdr},
        {id:'grok', label:'Grok bot', component:panels.grok},
      ];
      const current = tabs.find(tab => tab.id === active);
      const onKeyDown = event => {
        const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
          : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        buttons[next].focus();
        buttons[next].click();
      };
      return h('div', {'data-workbench-settings':true},
        h('style', null, `
          [data-workbench-settings]{display:flex;flex-direction:column;gap:18px;max-width:640px}
          .workbench-settings-tabs{display:flex;gap:20px;border-bottom:1px solid var(--dsw-alias-border-l2)}
          .workbench-settings-tabs button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);padding:8px 0;font:inherit;font-size:13px;cursor:pointer;border-bottom:2px solid transparent}
          .workbench-settings-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}
          .workbench-settings-tabs button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
        `),
        h('div', {className:'workbench-settings-tabs', role:'tablist', 'aria-label':'工作台插件设置', onKeyDown},
          ...tabs.map(tab => h('button', {key:tab.id, type:'button', role:'tab', id:`${id}-tab-${tab.id}`,
            'aria-selected':active === tab.id, 'aria-controls':`${id}-panel`, tabIndex:active === tab.id ? 0 : -1,
            onClick:() => setActive(tab.id)}, tab.label))),
        h('section', {id:`${id}-panel`, role:'tabpanel', 'aria-labelledby':`${id}-tab-${active}`, key:active}, h(current.component)),
      );
    }
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name:'plugins.bundle.config', key:PACKAGE_NAME,
    }, SettingsPanel));
  }

  return {apply, openSettings};
}
