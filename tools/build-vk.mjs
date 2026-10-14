/**
 * Reproducible static VK Mini App build; no framework, backend or account data.
 * Run from repository root: npm run build
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'build-vk');
const required = [
  'index.html', 'style.css', 'script.js', 'vk-app.js', 'locations.json',
  'map-preview.webp', 'map-full.webp',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/vk-bridge/browser.min.js'
];
for (const file of required) {
  if (!existsSync(join(root, file))) throw new Error('Missing required file: ' + file);
}
const locations = JSON.parse(readFileSync(join(root, 'locations.json'), 'utf8'));
if (!Array.isArray(locations) || locations.length !== 128) {
  throw new Error('Expected exactly 128 canonical objects');
}
rmSync(out, {recursive:true,force:true});
mkdirSync(out,{recursive:true});
for(const file of [...required.slice(0,7), 'map-base.png']) {
  const source=join(root,file);
  if(existsSync(source)) copyFileSync(source,join(out,file));
}
cpSync(join(root,'vendor'),join(out,'vendor'),{recursive:true});
cpSync(join(root,'images'),join(out,'images'),{recursive:true});
const miss=locations.filter(loc=>loc.image && !existsSync(join(out,loc.image)));
if(miss.length) console.warn('Missing optional location images:',miss.map(x=>x.id).join(', '));
const bytes=statSync(join(out,'map-full.webp')).size;
console.log('VK Mini App build created in',out, 'locations:', locations.length, 'full WebP:',bytes);
