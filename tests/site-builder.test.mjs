import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSiteInput,suggestDomains,renderLanding,safeCopy,makeSlug,trades} from '../src/site-builder.mjs';

const input={
  business_name:'Dupont Plomberie',job:'plombier',city:'Lyon',email:'contact@dupont.fr',
  phone:'06 12 34 56 78',radius_km:20,siret:'12345678901234',legal_address:'12 rue Exemple, 69003 Lyon',services:['Recherche de fuite','Débouchage'],
};
test('metiers et prestations disponibles',()=>{
  assert.ok(trades.plombier.services.includes('Recherche de fuite'));
  assert.ok(trades.couvreur.services.includes('Réparation de toiture'));
});
test('creation et validation du brief',()=>{
  const site=normalizeSiteInput(input);
  assert.equal(site.phone,'+33612345678');
  assert.equal(site.services.length,2);
  assert.match(makeSlug(site),/^dupont-plomberie-lyon-[a-f0-9]{6}$/);
});
test('adresse et metier obligatoires',()=>{
  assert.throws(()=>normalizeSiteInput({...input,email:'bad'}));
  assert.throws(()=>normalizeSiteInput({...input,job:'inconnu'}));
  assert.throws(()=>normalizeSiteInput({...input,services:[]}));
});
test('domaines proposes sans fausse disponibilite',()=>{
  const list=suggestDomains(input);
  assert.ok(list.length>=3);
  assert.ok(list.every(x=>x.availability==='unverified'&&x.price===null));
});
test('affichage html securise et bouton d appel',()=>{
  const site={...normalizeSiteInput({...input,business_name:'Dupont <script>alert(1)</script>'}),slug:'dupont-lyon-123456'};
  const html=renderLanding(site,{baseUrl:'https://example.com'});
  assert.ok(html.includes('href="tel:+33612345678"'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('/site-track.js'));
  assert.ok(html.includes('Dupont &lt;script&gt;'));
});
test('copy utilise les informations verifiees',()=>{
  const site=normalizeSiteInput(input);
  const copy=safeCopy(site,{heading:'Meilleur plombier garanti 24/7',cta:'Appeler maintenant'});
  assert.equal(copy.heading,'Plombier à Lyon');
  assert.equal(copy.cta,'Appeler maintenant');
});
