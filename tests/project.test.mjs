import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');const env=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
test('UI provides three routes site, profile, both',()=>{for(const option of ['value="site"','value="profile"','value="both"'])assert.ok(html.includes(option))});
test('UI discloses demo illustrative stats and no live campaign',()=>{assert.ok(html.includes('Illustration fictive'));assert.ok(html.includes('aucune publicité'))});
test('Mutations gated and explicit confirmations required',()=>{for(const t of ['allowCampaignWrites','allowActivation','CREER EN PAUSE','JE VALIDE LE BUDGET ET LA DIFFUSION'])assert.ok(server.includes(t))});
test('No credentials accidentally committed in environment example',()=>{assert.ok(!/sk_(live|test)_[A-Za-z0-9]{15}/.test(env));assert.ok(env.includes('STRIPE_SECRET_KEY='))});
