import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFrenchPhone} from '../src/phone.mjs';
test('normalize French fixed and mobile numbers',()=>{
  assert.equal(normalizeFrenchPhone('01 23 45 67 89'),'+33123456789');
  assert.equal(normalizeFrenchPhone('06 12 34 56 78'),'+33612345678');
  assert.equal(normalizeFrenchPhone('+33 (0)1 23 45 67 89'),'+33123456789');
  assert.equal(normalizeFrenchPhone('0033 1 23 45 67 89'),'+33123456789');
});
test('rejects invalid or malicious values',()=>{
  for(const s of ['+15552223333','abc','<script>','06010203','0000000000','+331 23 4 56']){
    assert.throws(()=>normalizeFrenchPhone(s));
  }
});
test('empty value yields no call asset',()=>assert.equal(normalizeFrenchPhone(''),''));
