// French commune autocomplete and validated geographic coordinates.
// Uses France's public geographic reference data; no paid geocoding key needed.
const BASE = 'https://geo.api.gouv.fr/communes';
const FIELDS = 'nom,code,codeDepartement,centre,codesPostaux,population';
const cache = new Map();
const WAIT_MS = 9000;
const INSEE = /^(?:[0-9]{5}|2[AB][0-9]{3})$/i;

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}
function town(record) {
  const coords = record?.centre?.coordinates;
  if (!record || !INSEE.test(record.code || '') || !Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 41 || lat > 52 || lng < -6 || lng > 11) return null;
  const name = cleanName(record.nom);
  if (!name || name.length > 90) return null;
  const department = String(record.codeDepartement || '').slice(0, 3);
  return {
    code: String(record.code).toUpperCase(), name, department,
    postalCode: String(record.codesPostaux?.[0] || ''),
    lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)),
    population: Number(record.population || 0)
  };
}
async function load(url, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: {accept: 'application/json'},
    signal: AbortSignal.timeout(WAIT_MS)
  });
  if (!response.ok) throw new Error('Service de recherche de villes indisponible');
  const data = await response.json();
  if (!Array.isArray(data) && (typeof data !== 'object' || data === null)) throw new Error('Réponse des villes invalide');
  return data;
}
export function validateRadiusKm(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Le rayon doit être compris entre 1 et 100 km.');
  return n;
}
export function validCoordinates(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
    Number(lat) >= 41 && Number(lat) <= 52 && Number(lng) >= -6 && Number(lng) <= 11;
}
export function normalizeSearchText(s) {
  return cleanName(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export async function suggestCities(value, {fetcher = fetch} = {}) {
  const query = cleanName(value);
  if (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N} '.-]+$/u.test(query)) return [];
  const key = normalizeSearchText(query);
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.cities;
  const u = new URL(BASE);
  for (const [k, v] of Object.entries({
    nom: query, fields: FIELDS, format: 'json', geometry: 'centre', boost: 'population', limit: '15'
  })) u.searchParams.set(k, v);
  const results = await load(u.href, fetcher);
  if (!Array.isArray(results)) throw new Error('Liste de villes invalide');
  const cities = results.map(town).filter(Boolean).sort((a, b) => {
    const rank = n => normalizeSearchText(n) === key ? 3 : normalizeSearchText(n).startsWith(key) ? 2 : 1;
    return rank(b.name) - rank(a.name) || b.population - a.population;
  }).slice(0, 8).map(({population, ...entry}) => entry);
  if (cache.size > 300) cache.clear();
  cache.set(key, {cities, expires: Date.now() + 300000});
  return cities;
}
export async function findCityByCode(value, {fetcher = fetch} = {}) {
  const code = String(value || '').trim().toUpperCase();
  if (!INSEE.test(code)) throw new Error('Choisissez une ville parmi les suggestions.');
  const key = 'code:' + code, prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.city;
  const url = new URL(BASE + '/' + encodeURIComponent(code));
  for (const [k, v] of Object.entries({fields: FIELDS, format: 'json', geometry: 'centre'})) url.searchParams.set(k, v);
  const city = town(await load(url.href, fetcher));
  if (!city || city.code !== code) throw new Error('Ville introuvable dans le référentiel français.');
  if (cache.size > 300) cache.clear();
  cache.set(key, {city, expires: Date.now() + 86400000});
  return city;
}
