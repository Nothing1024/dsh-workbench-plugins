import {registerGrokRoutes} from './service.mjs';

export function apply(ctx, config) { return registerGrokRoutes(ctx, config); }
