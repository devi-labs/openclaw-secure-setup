'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// phonesMatch and normalizePhone are not exported from sms.js,
// so we duplicate the logic here to test the algorithms without modifying sms.js.

function normalizePhone(raw) {
  return String(raw || '').replace(/[^0-9+]/g, '');
}

function phonesMatch(a, b) {
  const na = normalizePhone(a).replace(/^\+?1/, '');
  const nb = normalizePhone(b).replace(/^\+?1/, '');
  return na === nb && na.length >= 10;
}

describe('normalizePhone', () => {
  it('strips dashes and spaces', () => {
    assert.equal(normalizePhone('312-975-4202'), '3129754202');
  });

  it('preserves + prefix', () => {
    assert.equal(normalizePhone('+1 312 975 4202'), '+13129754202');
  });

  it('strips parentheses and dots', () => {
    assert.equal(normalizePhone('(312) 975.4202'), '3129754202');
  });

  it('handles null', () => {
    assert.equal(normalizePhone(null), '');
  });
});

describe('phonesMatch', () => {
  it('matches identical numbers', () => {
    assert.ok(phonesMatch('3129754202', '3129754202'));
  });

  it('matches with and without +1 prefix', () => {
    assert.ok(phonesMatch('+13129754202', '3129754202'));
  });

  it('matches with +1 vs 1 prefix', () => {
    assert.ok(phonesMatch('+13129754202', '13129754202'));
  });

  it('matches with dashes and spaces', () => {
    assert.ok(phonesMatch('312-975-4202', '+1 312 975 4202'));
  });

  it('does not match different numbers', () => {
    assert.equal(phonesMatch('3129754202', '3129754999'), false);
  });

  it('does not match short numbers', () => {
    assert.equal(phonesMatch('12345', '12345'), false);
  });

  it('allowed number 312-975-4202 matches +13129754202', () => {
    assert.ok(phonesMatch('312-975-4202', '+13129754202'));
  });
});
