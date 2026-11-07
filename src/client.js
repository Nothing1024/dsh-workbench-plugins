import {createSourcesClient} from './sources/client.js';
import {createHerdrClient} from './herdr/client.js';
import {createGrokClient} from './grok/client.js';

window.__ModuleLoader__.load({
  id: 'dsh-plugin-workbench-suite',
  factory(require) {
    const sources = createSourcesClient(require);
    const herdr = createHerdrClient(require, sources);
    const grok = createGrokClient(require, sources);
    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        sources.apply(ctx);
        herdr.apply(ctx);
        grok.apply(ctx);
      },
    };
  },
});
