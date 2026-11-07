import {apply as applyHerdr} from './src/herdr/index.js';
import {apply as applyGrok} from './src/grok/index.js';

export async function apply(ctx, config = {}) {
  applyGrok(ctx, config.grok);
  await applyHerdr(ctx, config.herdr);
}
