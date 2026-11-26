'use strict';
const {readFileSync} = require('node:fs');
const {verifyProposal} = require('./orbio.cjs');

const [reference, candidate, ...extra] = process.argv.slice(2);
if (!reference || !candidate || extra.length) {
  console.error('Usage: node check-rewrite.cjs original.rule proposed.rule');
  process.exitCode = 2;
} else {
  try {
    const report = verifyProposal(readFileSync(reference, 'utf8'), readFileSync(candidate, 'utf8'));
    console.log(JSON.stringify(report.evidence, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
