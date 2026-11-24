import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingState,hasRecentLandingCall,callTimestamp} from '../src/tracking.mjs';

test('le suivi correspond au compte, au numéro et au site publiés',()=>{
 const check={status:'call_observed',website:'https://example.invalid/p/test',phone:'+33600000000',installed_at:'2026-11-20T09:00:00Z'};
 const params={account:{customer_id:'1234567890'},website:check.website,published:true,check,site:{google_customer_id:'1234567890',google_tag_id:'AW-123456789',google_conversion_label:'wxyz',phone:check.phone}};
 assert.equal(trackingState(params).verified,true);
 for(const change of [{published:false},{website:'https://other.invalid'},{account:{customer_id:'0000000000'}},{check:{...check,phone:'+33700000000'}},{check:{...check,installed_at:null}}])assert.equal(trackingState({...params,...change}).verified,false);
});

test('seul un appel web éligible postérieur à l’installation valide le test',()=>{
 const criteria={installedAt:'2026-11-20T09:00:00.001Z',now:Date.parse('2026-11-20T12:00:00Z'),timeZone:'Europe/Paris'};
 const call={date:'2026-11-20 10:01:00',counted:true,source:'LANDING_PAGE'};
 assert.equal(hasRecentLandingCall([call],criteria),true);
 for(const change of [{counted:false},{source:'AD'},{date:'2026-11-20 10:00:00'},{date:'2026-11-20 14:00:00'}])assert.equal(hasRecentLandingCall([{...call,...change}],criteria),false);
 assert.ok(Number.isNaN(callTimestamp('2026-10-25 02:15:00','Europe/Paris')));
});
