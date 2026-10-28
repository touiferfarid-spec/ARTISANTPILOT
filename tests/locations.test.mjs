import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestCities,findCityByCode,validateRadiusKm,normalizeSearchText,validCoordinates} from '../src/locations.mjs';
import {generatePlan} from '../src/planner.mjs';
import {buildSearchCampaignOperations} from '../src/ads.mjs';

const lyon = {nom:'Lyon',code:'69123',codeDepartement:'69',centre:{type:'Point',coordinates:[4.8351,45.758]},codesPostaux:['69001'],population:519127};
const other = {nom:'Cognat-Lyonne',code:'03080',codeDepartement:'03',centre:{type:'Point',coordinates:[3.3002,46.11]},population:706};
const mock = async url => ({
  ok:true, json:async () => String(url).includes('/69123?') ? lyon : [other, lyon]
});
const base = {job:'plombier',city:'Lyon',city_code:'69123',city_lat:45.758,city_lng:4.8351,radius_km:20,business_name:'Test',budget_eur:30,website:'https://example.fr',destination:'site'};

test('commune autocomplete sorts exact Lyon first and returns trusted coordinates', async () => {
  const items = await suggestCities('Lyon',{fetcher:mock});
  assert.equal(items[0].name,'Lyon');
  assert.equal(items[0].code,'69123');
  assert.equal(items[0].lat,45.758);
  assert.equal(items[0].lng,4.8351);
  assert.ok(!('population' in items[0]));
});
test('city is verified by INSEE code, not arbitrary coordinates supplied by user', async () => {
  const city = await findCityByCode('69123',{fetcher:mock});
  assert.equal(city.name,'Lyon');
  assert.equal(city.code,'69123');
  await assert.rejects(() => findCityByCode('invalid'), /Choisissez/);
});
test('radius and coordinates are restricted to safe geographical bounds', () => {
  assert.equal(validateRadiusKm(20),20);
  for(const input of [0,101,-1,8.4,'not a number',null])assert.throws(()=>validateRadiusKm(input));
  assert.equal(validCoordinates(45.758,4.8351),true);
  assert.equal(validCoordinates(0,0),false);
  assert.equal(normalizeSearchText('Évry'),'evry');
});
test('profile-generated radius becomes Google Ads proximity target with exact kilometers', () => {
  const plan = generatePlan(base);
  assert.deepEqual(plan.proximity,{cityCode:'69123',lat:45.758,lng:4.8351,radiusKm:20});
  const ops = buildSearchCampaignOperations(plan,'1234567890');
  const target = ops[2].campaignCriterionOperation.create.proximity;
  assert.equal(target.radius,20);
  assert.equal(target.radiusUnits,'KILOMETERS');
  assert.equal(target.geoPoint.latitudeInMicroDegrees,45758000);
  assert.equal(target.geoPoint.longitudeInMicroDegrees,4835100);
  assert.equal(ops[1].campaignOperation.create.status,'PAUSED');
});
test('out of bounds radius cannot be submitted to Google Ads API', () => {
  const plan=generatePlan(base);
  plan.proximity.radiusKm=150;
  assert.throws(()=>buildSearchCampaignOperations(plan,'1234567890'),/rayon/);
});
