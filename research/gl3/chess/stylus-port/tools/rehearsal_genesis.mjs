// Build a stock Nitro state import for an isolated rehearsal. This script
// writes public code bytes and an ephemeral funded address. It sends no RPCs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PAYLOAD = 24_575;
const SEED_SHA = '2d7637246b973a1cfebfc7d1ad11d762797110d199b431b52272c6f0e3e0c1ef';
const ROM_DIGESTS = [
  '0f1dc6066d456a17b90b7879558902957e049ff4dc6d39b6de4c90b0fa6ad052',
  '6164b8d04c06a9a6f6f6768dd04e888006901826eae651c2f7b221b55a811e36',
  'a88fb0e84ef51a8e0b06921c9e60439c124f7781de0540436e19a3e406e0ae8c',
  '850650446679bb26d5abae9798a33fabe2190c7549211f4f86f5f56cc2eb7d2b',
];

const args = process.argv.slice(2);
if (args.length !== 7 && args.length !== 8) {
  throw new Error('Pass ETHERS_PACKAGE_JSON CORE_CELLS CONTROL_INDEX RUNTIME_INDEX ARCHIVE_DIR PRIVATE_TEST_SIGNER NEW_OUTPUT_DIR [CODE_WITNESS]');
}
const [ethersPackage, coreDir, controls, runtime, archiveDir, signer, output, witnessPath] = args;
const { getAddress, keccak256 } = createRequire(path.resolve(ethersPackage))('ethers');
const signerAddress = getAddress(signer).toLowerCase();
const digest = bytes => Buffer.from(keccak256(bytes).slice(2), 'hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const encodeHex = data => data.toString('hex');

const manifest = readJson(path.join(archiveDir, 'manifest.json'));
const archivePath = path.join(archiveDir, 'archive.bin');
if (manifest.imageSHA256 !== SEED_SHA || fs.statSync(archivePath).size !== manifest.archiveBytes
    || manifest.archiveBytes <= 0 || manifest.archiveCells !== Math.ceil(manifest.archiveBytes / PAYLOAD)
    || !/^[a-f0-9]{64}$/.test(manifest.memoryRoot)) {
  throw new Error('Archive differs from the exact replay seed');
}

const encodeCell = bytes => Buffer.concat([Buffer.alloc(1), bytes]);
const cellsFrom = data => Array.from({ length: Math.ceil(data.length / PAYLOAD) }, (_, index) =>
  encodeCell(data.subarray(index * PAYLOAD, (index + 1) * PAYLOAD)));
const namedCells = (prefix, count) => Array.from({ length: count }, (_, index) =>
  fs.readFileSync(path.join(coreDir, `${prefix}-${String(index).padStart(4, '0')}.bin`)));
const core = [namedCells('code', 36), namedCells('index', 1),
  cellsFrom(fs.readFileSync(controls)), cellsFrom(fs.readFileSync(runtime))];
for (const [index, cells] of core.entries()) {
  if (cells.some((cell, i) => cell[0] !== 0 || cell.length < 2 || cell.length > PAYLOAD + 1
      || (i + 1 < cells.length && cell.length !== PAYLOAD + 1))
      || encodeHex(digest(Buffer.concat(cells.map(cell => cell.subarray(1))))) !== ROM_DIGESTS[index]) {
    throw new Error(`Pinned ROM group ${index} differs`);
  }
}

fs.mkdirSync(output);
const accounts = fs.openSync(path.join(output, 'accounts.json'), 'wx');
const archive = fs.openSync(archivePath, 'r');
let cells = 0;
try {
  // Nitro's streaming decoder reads individual account objects.
  fs.writeSync(accounts, JSON.stringify({ Addr: signerAddress, Balance: '1000000000000000000000', Nonce: 0 }) + '\n');
  function appendCell(code) {
    const address = `0xf3${'00'.repeat(15)}${(++cells).toString(16).padStart(8, '0')}`;
    if (address === signerAddress) throw new Error('Test signer collides with a code cell');
    const account = { Addr: address, Balance: '0', Nonce: 1,
      ContractInfo: { Code: code.toString('base64'), ContractStorage: {} } };
    fs.writeSync(accounts, JSON.stringify(account) + '\n');
    return Buffer.concat([Buffer.from(address.slice(2), 'hex'), digest(code)]);
  }
  const program = core.flat().map(appendCell);
  if (program.length !== 51) throw new Error('Unexpected executable manifest size');
  const records = [];
  for (let offset = 0; offset < manifest.archiveBytes; offset += PAYLOAD) {
    const count = Math.min(PAYLOAD, manifest.archiveBytes - offset);
    const data = Buffer.alloc(count + 1);
    if (fs.readSync(archive, data, 1, count, offset) !== count) throw new Error('Archive read was short');
    records.push(appendCell(data));
  }
  const catalog = cellsFrom(Buffer.concat(records)).map(appendCell);

  const history = Buffer.from('e2e4');
  const job = digest(Buffer.from('GL3 private known Stockfish opening e2e4'));
  const prefix = Buffer.alloc(42);
  prefix.write('GSC1');
  job.copy(prefix, 4);
  prefix.writeUInt32BE(manifest.archiveBytes, 36);
  prefix.writeUInt16BE(history.length, 40);
  const configuration = Buffer.concat([prefix, ...program, ...catalog, history]);
  const configHash = digest(configuration);
  const root = Buffer.from(manifest.memoryRoot, 'hex');
  const checkpoint = Buffer.alloc(72);
  root.copy(checkpoint);
  checkpoint.writeBigUInt64BE(120685200n, 44);
  checkpoint.writeUInt32BE(manifest.memoryBytes, 68);
  const committed = Buffer.alloc(41);
  committed.writeBigUInt64LE(120685200n, 12);
  committed.writeUInt32LE(manifest.memoryBytes, 36);
  const before = digest(Buffer.concat([Buffer.from('GL3_STYLUS_CHECKPOINT_V1'), configHash, job, root, committed]));

  let codeWitnessBytes = 0;
  if (witnessPath) {
    const witness = fs.readFileSync(witnessPath);
    if (witness.length > 512 * 1024 || witness.length < 6 || witness.subarray(0, 4).toString() !== 'GW01') {
      throw new Error('Invalid code-backed witness');
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(witness.length);
    const codeManifest = Buffer.concat([length, ...cellsFrom(witness).map(appendCell)]);
    fs.writeFileSync(path.join(output, 'code-witness-manifest.bin'), codeManifest, { flag: 'wx' });
    codeWitnessBytes = witness.length;
  }
  fs.writeFileSync(path.join(output, 'config.bin'), configuration, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'checkpoint.bin'), checkpoint, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'init.json'), JSON.stringify({ NextBlockNumber: 0, AccountsPath: 'accounts.json' }), { flag: 'wx' });
  const report = { scope: 'offline state import for an isolated rehearsal', signerAddress,
    configCommitment: encodeHex(configHash), initialCheckpoint: encodeHex(before),
    initialMemoryRoot: manifest.memoryRoot, job: encodeHex(job), genesisCodeCells: cells, codeWitnessBytes,
    bytesBeforeWitness: 3 + configuration.length + checkpoint.length,
    transactionsSubmitted: 0 };
  fs.writeFileSync(path.join(output, 'rehearsal.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally {
  fs.closeSync(archive);
  fs.closeSync(accounts);
}
