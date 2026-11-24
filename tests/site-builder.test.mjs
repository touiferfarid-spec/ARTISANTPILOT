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

test('brouillon sans informations légales',()=>{
 const draft=normalizeSiteInput({...input,siret:'',legal_address:''});
 assert.equal(draft.siret,'');
 assert.equal(draft.legal_address,'');
 const page=renderLanding({...draft,slug:'test-artisan-123456'},{baseUrl:'https://example.com',preview:true});
 assert.ok(page.includes('href="tel:+33612345678"'));
 assert.ok(!page.includes('SIRET : '));
 assert.ok(!page.includes('/site-track.js'));
});
test('SIRET partiel produit un message explicite',()=>{
 assert.throws(()=>normalizeSiteInput({...input,siret:'123'}),/14 chiffres/);
});

test('chacune des 14 pages affiche son métier, sa photo et le téléphone sur tous les liens',async()=>{
 const {tradeContent}=await import('../src/trade-content.mjs');
 const {readFile}=await import('node:fs/promises');
 const images=new Set();
 for(const [job,trade] of Object.entries(trades)){
  const site={...normalizeSiteInput({...input,job,services:trade.services}),slug:'artisan-test-123456'};
  const page=renderLanding(site,{baseUrl:'https://example.com',preview:true});
  const asset=tradeContent[job].image;images.add(asset);
  for(const suffix of ['','-sm']){
   const name=asset+suffix+'.webp';assert.ok(page.includes('/assets/trades/'+name));
   const file=await readFile(new URL('../public/assets/trades/'+name,import.meta.url));assert.equal(file.toString('ascii',8,12),'WEBP');
  }
  const numbers=[...page.matchAll(/href="tel:([^"]+)"/g)].map(m=>m[1]);
  assert.ok(numbers.length>=5);assert.ok(numbers.every(n=>n===site.phone));
  assert.ok(page.includes('data-call-position="mobile"'));assert.match(page,/Photo d’illustration/);
  assert.equal(new Set(safeCopy(site).service_descriptions).size,trade.services.length);
 }
 assert.equal(images.size,14);
});

test('photo de l’entreprise normalisée en WebP sans métadonnées',async()=>{
 const {prepareSitePhoto}=await import('../src/site-photo.mjs');
 const sharp=(await import('sharp')).default;
 const source=await sharp({create:{width:1100,height:500,channels:3,background:'#28706b'}}).jpeg().withMetadata().toBuffer();
 const uri=await prepareSitePhoto('data:image/jpeg;base64,'+source.toString('base64'));
 const meta=await sharp(Buffer.from(uri.split(',')[1],'base64')).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,960);assert.equal(meta.exif,undefined);
 const page=renderLanding({...normalizeSiteInput(input),portrait:uri,slug:'test-artisan-123456'});
 assert.match(page,/Photo de Dupont Plomberie/);assert.doesNotMatch(page,/Photo d’illustration/);
 await assert.rejects(prepareSitePhoto('data:image/jpeg;base64,YWJjZA=='));
});
