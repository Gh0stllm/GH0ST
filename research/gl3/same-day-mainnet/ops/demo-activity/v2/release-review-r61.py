#!/usr/bin/env python3
"""Saved-public-file review only. No network probes, services, journals or keys."""
from pathlib import Path
import hashlib
import json
import re
import sys
from datetime import datetime, timezone

base = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
scopes = [base / 'ops' / n for n in ('demo-activity', 'demo-funding', 'site-plumbing')]
patterns = {
    'literal-private-key': rb'["\'](?:privateKey|private_key|private-key)["\']\s*:\s*["\']0x[0-9a-fA-F]{64}["\']',
    'private-key-pem': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'raw-signed-transaction-payload': rb'["\'](?:raw|rawTransaction|signedTransaction|signedTx)["\']\s*:\s*["\']0x[0-9a-fA-F]{180,}["\']',
    'credential-bearing-provider-url': rb'https?://[^\s"\']*(?:alchemy\.com|infura\.io)/(?:v2|v3)/[A-Za-z0-9_-]{12,}',
    'url-userinfo-credentials': rb'https?://[^\s/:"\']+:[^\s/@"\']+@',
    'literal-bearer-credential': rb'Bearer (?:eyJ[A-Za-z0-9_.-]{30,}|[A-Za-z0-9_-]{50,})',
    'literal-local-review-capability-url': rb'https?://(?:127\.0\.0\.1|localhost):[0-9]+/[0-9a-f]{40,}/',
}
private_names = {'wallet.json', 'operators.json', 'intents.jsonl', 'id_ed25519', 'id_rsa'}
issues, reviewed = [], []
for scope in scopes:
    assert scope.is_dir(), scope
    for file in sorted(scope.rglob('*')):
        if file.is_symlink():
            issues.append({'file': str(file.relative_to(base)), 'category': 'symlink-requires-explicit-public-target-review'})
            continue
        if not file.is_file():
            continue
        name = str(file.relative_to(base))
        reviewed.append({'file': name, 'bytes': file.stat().st_size, 'sha256': sha(file)})
        if file.name in private_names or file.name.startswith('.env'):
            issues.append({'file': name, 'category': 'private-runtime-filename-in-public-tree'})
        data = file.read_bytes()
        for category, pattern in patterns.items():
            if re.search(pattern, data):
                issues.append({'file': name, 'category': category})
        if file.suffix == '.json':
            try:
                parsed = json.loads(data)
            except (ValueError, UnicodeDecodeError):
                issues.append({'file': name, 'category': 'unparseable-public-json'})
                continue
            if isinstance(parsed, dict) and parsed.get('activationApproved') is True:
                issues.append({'file': name, 'category': 'activated-runtime-config-in-public-tree'})

refs = {}
def load(relative):
    p = base / relative
    refs[relative] = {'sha256': sha(p), 'bytes': p.stat().st_size}
    return json.loads(p.read_text())

fund = load('ops/demo-funding/topup-250k/evidence/funding-confirmation.json')
assert fund['canonical'] and fund['receipt']['status'] == '0x1'
assert fund['hash'] == '0x56d976232c6c654e02757f4caf977cf79b9dbe7840bc257fcb7f71f9ed477bbd'
assert fund['additionalGH0ST'] == '250000' and fund['cumulativeFundingGH0ST'] == '350000'
assert fund['to'].lower() == '0xe03f5f1392072f93795f95f778161ba989e7c32c'
migration = load('ops/demo-activity/v2/evidence/actual-migration.json')
assert migration['passed'] and migration['originalBytesPreservedExactly'] and migration['nextNonce'] == 2292
observation = load('ops/demo-activity/v2/evidence/live/observation-2573.json')
pilot = observation['first60SecondPilot']
assert observation['passed'] and pilot['receipts'] == 44 and pilot['allOneDemoPerBlock']
assert pilot['counts'] == {'pulse': 40, 'test-token': 3, 'demo-nft': 1}
assert observation['canonicalPostTransitionReceipts'] == 137 and observation['duplicateDemoReceiptBlocks'] == 0
assert all(p['alive'] and p['unchanged'] for p in observation['chainProcessesUnchanged'].values())
assert set(observation['chainProcessesUnchanged']) == {'2373', '2374', '2397', '4581'}
# Exact public receipt arithmetic uses decimal strings, not binary floats.
def units(text):
    whole, _, fraction = text.partition('.')
    return int(whole) * 10**18 + int(fraction.ljust(18, '0'))
assert units(observation['oldPreservedSpentGH0ST']) + units(observation['newPaidGH0ST']) + units(observation['remainingGH0ST']) == 350000 * 10**18

wallet = load('network/wallet-button/evidence/rollout-result.json')
https = load('network/wallet-button/evidence/actual-production-verification/result.json')
assert wallet['passed'] and wallet['HTMLPages'] == 24 and wallet['mainHTMLPages'] == 22
assert wallet['actualProductionHTTPSPassed'] and wallet['actualRPCIdentityChecksPassed']
assert https['passed'] and len(https['checks']) == 30 and all(c['status'] == 200 and c['exact'] for c in https['checks'])
assert len([c for c in https['checks'] if c['mime'].startswith('text/html')]) == 24
tls = load('ops/site-plumbing/final-runpod-tls-readback.json')
assert {r['host'] for r in tls} == {'bridge.gh0st.fyi', 'l3.gh0st.fyi'}
assert all(r['tlsHostnameVerified'] and r['protocol'] == 'TLSv1.3' for r in tls)
sites = load('ops/site-plumbing/final-site-readback.json')
assert all(r['ssl'] and r['force_ssl'] and not r['has_password'] and not r['sso_login'] and not r['account_sso_login'] for r in sites)
rpc_tls = load('ops/site-plumbing/rpc-cert-investigation/result.json')
assert rpc_tls['currentStrictChecksPassed'] and not rpc_tls['TLSVerificationDisabled']

result = {
    'schema': 'gh0st.gl3.r61.backend-completion-reference.v1',
    'preparedUTC': datetime.now(timezone.utc).isoformat(),
    'scope': 'Saved-file verification and targeted public-payload review on Runpod. No new chain, wallet, domain, TLS or browser probe. No live mutation.',
    'readiness': 'Backend migration and saved wallet/domain rollout evidence accepted within the explicit scopes below; current frontend-design acceptance is separate.',
    'publicSummary': 'The demo wallet received an additional 250,000 GH0ST, bringing approved cumulative funding to 350,000. The new worker selects one labelled demo action at a time. Its first 60-second observation contained 44 genuine transactions, each in a separate block. Across 137 checked receipts there were no duplicate demo blocks, and the four original chain processes stayed unchanged. Saved publication checks cover the network-wallet control on all 24 pages and strict HTTPS for the dedicated L3 and bridge domains.',
    'funding': {k: fund[k] for k in ('observedUTC', 'hash', 'chainId', 'from', 'to', 'additionalGH0ST', 'cumulativeFundingGH0ST', 'actualFeeWei')},
    'migration': {k: migration[k] for k in ('oldConfigSHA256', 'newConfigSHA256', 'originalJournalSHA256', 'originalBytesPreservedExactly', 'nextNonce', 'spentWei', 'newCumulativeBudgetWei')},
    'savedDemoObservation': {
        'observedUTC': observation['observedUTC'], 'snapshot': observation['snapshot'],
        'first60SecondPilot': pilot, 'canonicalPostTransitionReceipts': 137, 'duplicateDemoReceiptBlocks': 0,
        'chainProcessesUnchanged': observation['chainProcessesUnchanged'],
        'headerSpacingSeconds': observation['headerSpacingSeconds'],
        'oldPreservedSpentGH0ST': observation['oldPreservedSpentGH0ST'],
        'newPaidGH0ST': observation['newPaidGH0ST'], 'remainingGH0STAtSnapshot': observation['remainingGH0ST'],
    },
    'savedWalletRollout': {'observedUTC': https['observedUTC'], 'HTMLPages': 24, 'mainHTMLPages': 22,
        'otherPages': ['rpc.gh0st.fyi/', 'scan.gh0st.fyi/'], 'HTTPSAssetsVerified': 30,
        'mockWalletCases': wallet['mockWalletCases'], 'financialTransactionsPerformed': wallet['financialTransactionsPerformed'],
        'functionsRoutesSchedulesPreserved': wallet['functionRuntimeStreamRoutesConfigsDefaultOverridesSchedulesPreserved'],
        'scope': 'Already-published wallet rollout; does not assert the later Whispers redesign is published or visually accepted.'},
    'savedDomainEvidence': {'hosts': [r['host'] for r in tls], 'strictTLS13AndHostnamePassed': True,
        'observedUTC': [r['observedUTC'] for r in tls], 'forceSSLAndNoSSOOrPassword': True,
        'rpcTLSRecheckPassed': True, 'earlierRPCTLSFailureCauseEstablished': rpc_tls['earlierFailureCauseEstablished'],
        'scope': 'Timestamped saved readbacks. Earlier pending-certificate, resolver and IPv6 limitations remain recorded; no TLS verification was disabled.'},
    'knownLimits': [
        'Automated demo activity is not organic adoption or economic token/NFT volume. System and other-user transactions are separate.',
        'One demo transaction per observed containing block is not a promise that total block transaction count equals one.',
        'Observed header gaps of one to two seconds have one-second timestamp resolution; 100 ms node configuration is not settlement latency.',
        'Native fees and balance keep changing. Budget 350k and 24-hour maximum are finite bounds, not guaranteed runtime. No automatic topups.',
        'Sequenced child receipts, parent data posting and confirmed withdrawal roots are different checkpoints.',
        'Launch uses project-run sequencing/validation and trusted fast confirmation; ZK and LLM validity proofs are not live.',
        'Saved page/domain checks do not guarantee current availability or accept the new frontend design.',
        'This targeted payload/filename review is not a general security audit or proof that every possible encoded secret is absent.',
    ],
    'publicationReview': {'scopes': [str(p.relative_to(base)) for p in scopes], 'filesReviewed': len(reviewed),
        'patterns': list(patterns), 'issues': issues, 'noSensitivePayloadDetectedWithinScope': not issues,
        'privatePathReferencesAndPublicTESTKeyDerivations': 'Reviewed as source references only; no production wallet, signed-intent journal or private effective-config payload was present.'},
    'referenceRoot': 'research/gl3/same-day-mainnet/',
    'references': refs,
}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'written': str(output), 'sha256': sha(output), 'filesReviewed': len(reviewed), 'issues': issues, 'passed': not issues}))
