const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWeightLine } = require('./scale.js');

test('parses Toledo/CAS-style stable reading', () => {
    const r = parseWeightLine('ST,GS,+   1.234kg');
    assert.equal(r.weight, 1.234);
    assert.equal(r.unit, 'kg');
    assert.equal(r.stable, true);
});

test('parses Toledo/CAS-style unstable reading', () => {
    const r = parseWeightLine('US,GS,-0.002 kg');
    assert.equal(r.weight, -0.002);
    assert.equal(r.stable, false);
});

test('strips STX/ETX framing bytes', () => {
    const r = parseWeightLine('\x02ST,GS,+2.500kg\x03');
    assert.equal(r.weight, 2.5);
    assert.equal(r.stable, true);
});

test('generic fallback parses a bare number + unit with unknown stability', () => {
    const r = parseWeightLine('0.485 kg');
    assert.equal(r.weight, 0.485);
    assert.equal(r.unit, 'kg');
    assert.equal(r.stable, null);
});

test('generic fallback defaults to kg when no unit present', () => {
    const r = parseWeightLine('1.200');
    assert.equal(r.weight, 1.2);
    assert.equal(r.unit, 'kg');
});

test('returns null for garbage input', () => {
    assert.equal(parseWeightLine('hello world, no numbers here'), null);
    assert.equal(parseWeightLine(''), null);
    assert.equal(parseWeightLine(null), null);
});

test('handles lb unit', () => {
    const r = parseWeightLine('ST,GS,+3.10lb');
    assert.equal(r.unit, 'lb');
    assert.equal(r.weight, 3.1);
});
