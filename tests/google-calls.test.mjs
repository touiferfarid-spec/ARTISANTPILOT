import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCalls,createCallActionRequest,tagInfo} from '../src/google-calls.mjs';
test('les appels reçus de 60 secondes sont séparés des appels manqués',()=>{
  const rows=[
    {callView:{callStatus:'RECEIVED',callDurationSeconds:'65',resourceName:'callViews/1'}},
    {callView:{callStatus:'MISSED',callDurationSeconds:'0',resourceName:'callViews/2'}},
    {callView:{callStatus:'RECEIVED',callDurationSeconds:'42',resourceName:'callViews/3'}}
  ];
  const report=summarizeCalls(rows);
  assert.equal(report.summary.answered,2);
  assert.equal(report.summary.missed,1);
  assert.equal(report.summary.answered60s,1);
});
test('conversion à validation contrôlée',()=>{
  const a=createCallActionRequest('AD_CALL','Test conversion');
  assert.equal(a.type,'AD_CALL');
  assert.equal(a.phoneCallDurationSeconds,'60');
  assert.throws(()=>createCallActionRequest('WEB_CLICK','wrong'));
});
test('ne pas fabriquer un tag Google',()=>{
  assert.equal(tagInfo({tagSnippets:[]}),null);
});
