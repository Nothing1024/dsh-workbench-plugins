#!/usr/bin/env node
import {build} from 'esbuild';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({absWorkingDir:root, entryPoints:['src/client.js'], outfile:'dist/client.js', bundle:true, format:'iife', platform:'browser', target:'es2022', sourcemap:false, legalComments:'inline', logLevel:'warning'});
console.log('Built one workbench client bundle.');
