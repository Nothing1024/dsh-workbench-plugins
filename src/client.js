import {createSourcesClient} from './sources/client.js';
import {createHerdrClient} from './herdr/client.js';
import {createGrokClient} from './grok/client.js';
import {createSettingsClient} from './settings/client.js';

window.__ModuleLoader__.load({
  id: 'dsh-plugin-workbench-suite',
  factory(require) {
    const settings = createSettingsClient(require);
    const sources = {...createSourcesClient(require), openSettings:settings.openSettings};
    const herdr = createHerdrClient(require, sources);
    const grok = createGrokClient(require, sources);
    return {
      inject: ['slots', 'layout', 'pluginNavigation'],
      apply(ctx) {
        sources.apply(ctx);
        herdr.apply(ctx);
        grok.apply(ctx);
        settings.apply(ctx, {sources:sources.SettingsPanel, herdr:herdr.SettingsPanel, grok:grok.SettingsPanel});
      },
    };
  },
});
