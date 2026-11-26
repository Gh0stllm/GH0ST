'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const solc = require('solc');
const { keccak256 } = require('ethers');
const MAX = 4294967295n;
const sha = s => createHash('sha256').update(s).digest('hex');

function parse(source) {
  if (typeof source !== 'string' || source.length > 2048) throw Error('Rule exceeds 2048 characters');
  const tokens = source.match(/[a-zA-Z_]+|[0-9]+|==|[+*/()]|[^ \t\r\n]/g) || [];
  if (tokens.length > 256) throw Error('Rule exceeds 256 tokens');
  let pos = 0;
  function take(token) {
    if (tokens[pos] !== token) throw Error('Expected ' + token + ' at token ' + (pos + 1));
    pos++;
  }
  function primary() {
    const token = tokens[pos++];
    if (token === '(') {
      const value = expr(0);
      take(')');
      return value;
    }
    if (token === 'if') {
      const condition = expr(0);
      take('then');
      const yes = expr(0);
      take('else');
      const no = expr(0);
      return { op: 'if', condition, yes, no };
    }
    if (token === 'qty' || token === 'tier') return { op: 'var', name: token };
    if (token && /^(0|[1-9][0-9]*)$/.test(token) && BigInt(token) <= MAX) {
      return { op: 'const', value: Number(token) };
    }
    throw Error('Unsupported token at position ' + pos);
  }
  const prec = { '==': 1, '+': 2, '*': 3, '/': 3 };
  function expr(min) {
    let left = primary();
    while (Object.hasOwn(prec, tokens[pos]) && prec[tokens[pos]] >= min) {
      const op = tokens[pos++];
      left = { op, left, right: expr(prec[op] + 1) };
    }
    return left;
  }
  const tree = expr(0);
  if (pos !== tokens.length) throw Error('Unexpected trailing token at ' + (pos + 1));
  if (range(tree).type !== 'uint') throw Error('Rule result must be an integer');
  return tree;
}

function range(node) {
  const uint = (lo, hi) => {
    if (hi > MAX) throw Error('Intermediate value may overflow uint32');
    return { type: 'uint', lo, hi };
  };
  if (node.op === 'var') return uint(0n, 255n);
  if (node.op === 'const') return uint(BigInt(node.value), BigInt(node.value));
  if (node.op === 'if') {
    const test = range(node.condition), a = range(node.yes), b = range(node.no);
    if (test.type !== 'bool' || a.type !== 'uint' || b.type !== 'uint') throw Error('Invalid if types');
    return uint(a.lo < b.lo ? a.lo : b.lo, a.hi > b.hi ? a.hi : b.hi);
  }
  const a = range(node.left), b = range(node.right);
  if (a.type !== 'uint' || b.type !== 'uint') throw Error('Arithmetic and equality require integers');
  switch (node.op) {
    case '==': return { type: 'bool' };
    case '+': return uint(a.lo + b.lo, a.hi + b.hi);
    case '*': return uint(a.lo * b.lo, a.hi * b.hi);
    case '/':
      if (b.lo === 0n) throw Error('Divisor may be zero');
      return uint(a.lo / b.hi, a.hi / b.lo);
    default: throw Error('Unsupported operation');
  }
}

function evaluate(tree, qty, tier) {
  if (![qty, tier].every(x => Number.isInteger(x) && x >= 0 && x <= 255)) throw RangeError('Expected uint8 inputs');
  function visit(node) {
    if (node.op === 'var') return BigInt(node.name === 'qty' ? qty : tier);
    if (node.op === 'const') return BigInt(node.value);
    if (node.op === 'if') return visit(node.condition) ? visit(node.yes) : visit(node.no);
    const a = visit(node.left), b = visit(node.right);
    switch (node.op) {
      case '==': return a === b;
      case '+': return a + b;
      case '*': return a * b;
      case '/': return a / b;
      default: throw Error('Unsupported operation');
    }
  }
  return Number(visit(tree));
}

function code(n, js) {
  if (n.op === 'var' || n.op === 'const') {
    const value = String(n.name ?? n.value);
    return js ? value : 'uint256(' + value + ')';
  }
  if (n.op === 'if') return '(' + code(n.condition, js) + ' ? ' + code(n.yes, js) + ' : ' + code(n.no, js) + ')';
  const op = js && n.op === '==' ? '===' : n.op;
  const value = '(' + code(n.left, js) + ' ' + op + ' ' + code(n.right, js) + ')';
  return js && op === '/' ? 'Math.floor' + value : value;
}

function compileRule(source) {
  if (!solc.version().startsWith('0.8.30+commit.73712a01.')) throw Error('Use solc 0.8.30');
  const ast = parse(source);
  const solidity = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\n\ncontract Quote {\n' +
    '    function quote(uint8 qty, uint8 tier) external pure returns (uint32) {\n' +
    '        return uint32(' + code(ast, false) + ');\n    }\n}\n';
  const javascript = 'export function quote(qty, tier) {\n' +
    '  if (![qty, tier].every(x => Number.isInteger(x) && x >= 0 && x <= 255)) throw RangeError("Expected uint8 inputs");\n' +
    '  return ' + code(ast, true) + ';\n}\n';
  const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi','evm.bytecode.object','evm.deployedBytecode.object'] } } };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Quote.sol': { content: solidity } }, settings })));
  const errors = (out.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
  const compiled = out.contracts['Quote.sol'].Quote;
  const deployedBytecode = '0x' + compiled.evm.deployedBytecode.object;
  return { schema: 'gh0st-rule-artifact-v1', source, sourceSha256: sha(source), solidity, javascript,
    solc: solc.version(), settings, abi: compiled.abi, bytecode:'0x' + compiled.evm.bytecode.object,
    deployedBytecode, runtimeKeccak256: keccak256(deployedBytecode) };
}

module.exports = { parse, evaluate, compileRule };
if (require.main === module) {
  const ruleFile = process.argv[2] || path.join(__dirname, 'quote.rule');
  const outDir = process.argv[3] || __dirname;
  const artifact = compileRule(fs.readFileSync(ruleFile, 'utf8'));
  fs.mkdirSync(outDir, {recursive:true});
  for (const [file, text] of [['Quote.sol', artifact.solidity], ['quote.mjs', artifact.javascript],
    ['artifact.json', JSON.stringify(artifact, null, 2) + '\n']]) fs.writeFileSync(path.join(outDir,file), text);
  console.log(artifact.runtimeKeccak256);
}
