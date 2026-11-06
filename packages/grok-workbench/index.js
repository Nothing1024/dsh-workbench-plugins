// Grok is an independent source using the common workbench navigation.
import {registerGrokRoutes} from './grok-service.mjs';
export function apply(ctx) { return registerGrokRoutes(ctx); }
