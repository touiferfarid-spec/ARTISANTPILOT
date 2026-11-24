import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const indexName = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim();
let index;
function communeIndex() {
  if (index) return index;
  const rows = JSON.parse(gunzipSync(readFileSync(new URL('../data/communes.json.gz',import.meta.url))));
  const byCode = new Map();
  for (const [code,name,department,postcodes,lat,lng,population] of rows) {
    byCode.set(code,{search:indexName(name),postcodes,population,city:{code,name,department,postalCode:postcodes[0]||'',lat,lng}});
  }
  index=byCode;
  return index;
}
export function communeByCode(code) {
  return communeIndex().get(code)?.city;
}
export function communesMatching(value) {
  const key=indexName(value);
  if (key.length<2) return [];
  const postal=/^\d{4,5}$/.test(key);
  const matches=[];
  for (const entry of communeIndex().values()) {
    const score=postal ? Number(entry.postcodes.some(code=>code.startsWith(key))) :
      entry.search===key ? 3 : entry.search.startsWith(key) ? 2 : Number(entry.search.includes(' '+key));
    if (score) matches.push({entry,score});
  }
  return matches.sort((a,b)=>b.score-a.score||b.entry.population-a.entry.population||a.entry.city.code.localeCompare(b.entry.city.code)).slice(0,8).map(match=>match.entry.city);
}
