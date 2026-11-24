import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const source = 'https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,centre,codesPostaux,population&geometry=centre&format=json';
async function fetchRecords() {
  const response = await fetch(source, {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw Error('Impossible de télécharger le référentiel des communes.');
  return response.json();
}
const records = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : await fetchRecords();
const rows = [];
for (const record of records) {
  const [lng, lat] = record.centre?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 41 || lat > 52 || lng < -6 || lng > 11) continue;
  rows.push([record.code,record.nom,record.codeDepartement,record.codesPostaux,lat,lng,record.population||0]);
}
if (rows.length < 34000 || new Set(rows.map(row => row[0])).size !== rows.length) throw Error('Téléchargement incomplet.');
rows.sort((a,b) => a[0].localeCompare(b[0], 'en'));
const directory = new URL('../data/', import.meta.url);
await mkdir(directory, {recursive:true});
await writeFile(new URL('communes.json.gz',directory),gzipSync(JSON.stringify(rows),{level:9}));
console.log(rows.length + ' communes métropolitaines intégrées.');
