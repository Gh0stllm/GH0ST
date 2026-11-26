'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, evaluate, compileRule } = require('./compiler.cjs');

test('Operators are left-associative with integer floor division and arithmetic precedence', () => {
  assert.equal(evaluate(parse('19 / 4 / 2'), 255, 255), 2);
  assert.equal(evaluate(parse('qty + 3 * 4'), 2, 0), 14);
  assert.equal(evaluate(parse('(qty + 3) * 4'), 2, 0), 20);
  assert.equal(evaluate(parse('if qty == 0 then 7 else if tier == 4 then 20 else 19'), 10, 4), 20);
});

test('Reject invalid types, lexical injections, possible overflow, possible zero division and out-of-domain inputs', () => {
  for (const source of ['1 / qty', '4294967295 + qty', 'qty * 4294967295', '4294967296', '1 +',
    'if qty then 1 else 2', 'if qty == 1 then tier == 0 else 5', 'qty == 2',
    'eval(qty)', 'qty; quit()', 'qty.abc', 'qty > 0', '0xf', '01', 'qty - 1', '1e2', 'qty ** 2',
    'qty plus tier', 'constructor', 'price', '\u2212qty', '('.repeat(257) + '1' + ')'.repeat(257)]) {
    assert.throws(() => parse(source), undefined, source);
  }
  for (const v of [256, -1, 0.5, NaN, Infinity, '3']) assert.throws(() => evaluate(parse('qty'), v, 0), RangeError);
});

test('Generated JavaScript agrees with the interpreter on uint32 boundary arithmetic and near-integer ratios', async () => {
  const rule = 'if tier == 0 then 4294967294 / (4294967040 + qty) else 4294967295 / (16777215 + qty)';
  const artifact = compileRule(rule);
  const { quote } = await import('data:text/javascript;base64,' + Buffer.from(artifact.javascript).toString('base64'));
  const ast = parse(rule);
  for (let qty = 0; qty < 256; qty++) for (const tier of [0, 1, 255]) {
    assert.equal(quote(qty,tier), evaluate(ast,qty,tier));
  }
});
