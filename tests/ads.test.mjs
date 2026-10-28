import test from 'node:test';import assert from 'node:assert/strict';
import {buildSearchCampaignOperations,createCustomerRequest} from '../src/ads.mjs';import {generatePlan} from '../src/planner.mjs';
const x={job:'plombier',city:'Lyon',business_name:'Entreprise Martin',budget_eur:30,website:'https://example.fr',phone:'06 12 34 56 78',destination:'site',geo_target_id:'1011234'};
test('build Search campaign with PAUSED default and local geo target',()=>{const ops=buildSearchCampaignOperations(generatePlan(x),'1234567890');assert.equal(ops[0].campaignBudgetOperation.create.amountMicros,'30000000');assert.equal(ops[1].campaignOperation.create.status,'PAUSED');assert.equal(ops[1].campaignOperation.create.networkSettings.targetContentNetwork,false);assert.equal(ops[2].campaignCriterionOperation.create.location.geoTargetConstant,'geoTargetConstants/1011234');assert.ok(ops.some(o=>o.adGroupAdOperation));assert.ok(ops.some(o=>o.adGroupCriterionOperation))});
test('refuses to create Search direct to Google Business Profile',()=>{assert.throws(()=>buildSearchCampaignOperations({...generatePlan(x),destination:'profile'},'1234567890'),/Search vers un site/)});
test('refuses missing validated geo target',()=>{assert.throws(()=>buildSearchCampaignOperations(generatePlan({...x,geo_target_id:null}),'1234567890'),/Ciblage local/)});
test('account creation does not run by default and accepts validation flag',()=>{assert.equal(createCustomerRequest('Entreprise Test').validateOnly,true);assert.equal(createCustomerRequest('Entreprise Test',{validateOnly:false}).customerClient.currencyCode,'EUR')});
test('adds separate campaign-level call asset with real business phone',()=>{
  const ops=buildSearchCampaignOperations(generatePlan(x),'1234567890');
  const asset=ops.find(op=>op.assetOperation)?.assetOperation.create;
  const link=ops.find(op=>op.campaignAssetOperation)?.campaignAssetOperation.create;
  assert.deepEqual(asset.callAsset,{countryCode:'FR',phoneNumber:'+33612345678'});
  assert.equal(asset.resourceName,'customers/1234567890/assets/-4');
  assert.equal(link.asset,asset.resourceName);
  assert.equal(link.campaign,'customers/1234567890/campaigns/-2');
  assert.equal(link.fieldType,'CALL');
  assert.equal(ops.find(op=>op.adGroupAdOperation).adGroupAdOperation.create.ad.finalUrls[0],'https://example.fr');
});
test('requires a verified-format artisan phone for ad call asset',()=>{
  assert.throws(()=>buildSearchCampaignOperations(generatePlan({...x,phone:''}),'1234567890'),/numéro professionnel/);
  assert.throws(()=>buildSearchCampaignOperations(generatePlan({...x,phone:'800*123'}),'1234567890'),/numéro professionnel/);
});
