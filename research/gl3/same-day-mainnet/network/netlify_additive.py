#!/usr/bin/env python3
"""Prepare an additive atomic deployment; public mutations need explicit subcommands.

Uses the existing authenticated CLI. Never reads or prints its stored credentials.
No dependency build, compression, new site, DNS, environment or port mutation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import zipfile

HERE = Path(__file__).resolve().parent
SITE = '1460fb0c-b81d-4624-aac5-b78658310ce0'
PREFIX = '/gl3/bridge/'


def require(value, message):
    if not value:
        raise ValueError(message)


class Cli:
    def __init__(self, cli):
        self.cli = str(Path(cli).resolve())

    def call(self, name, data):
        # Structured argv only. stdout may contain private site settings; callers
        # extract public deployment fields, never echo the complete response.
        p = subprocess.run(['node', self.cli, 'api', name, '--data', json.dumps(data)],
                           capture_output=True, text=True, timeout=55)
        require(p.returncode == 0, f'Netlify {name} failed (response withheld)')
        return json.loads(p.stdout)

    def upload_function(self, deploy_id, name, file):
        p = subprocess.run(['node', str(HERE / 'netlify_binary_upload.mjs'), self.cli],
                           input=json.dumps({'deployId': deploy_id, 'name': name, 'file': str(file.resolve())}),
                           capture_output=True, text=True, timeout=55)
        require(p.returncode == 0, 'Netlify binary function upload failed (response withheld)')
        return json.loads(p.stdout)


def snapshot(api):
    s = api.call('getSite', {'site_id': SITE})
    require(s.get('id') == SITE and 'gh0st.fyi' in s.get('domain_aliases', []), 'Wrong production site/domain')
    dep = s['published_deploy']['id']
    d = api.call('getSiteDeploy', {'site_id': SITE, 'deploy_id': dep})
    require(d.get('state') == 'ready', 'Production deploy not ready')
    require(not d.get('edge_functions_present') and not d.get('server'), 'Unhandled existing edge/server artifact; stop and preserve it explicitly')
    files = api.call('listSiteFiles', {'site_id': SITE})
    require(len(files) > 100, 'Unexpectedly incomplete production file manifest')
    require(api.call('getSite', {'site_id': SITE})['published_deploy']['id'] == dep, 'Production changed during snapshot; retry')
    funcs = [{k: x.get(k) for k in ['n', 'd', 'dn', 'g', 'bd', 'ro', 'p', 'rg', 'm', 'r', 'im'] if x.get(k) is not None}
             for x in d.get('available_functions', [])]
    return {'siteId': SITE, 'deployId': dep, 'files': {x['path']: x['sha'] for x in files},
            'availableFunctions': funcs, 'functionSchedules': d.get('function_schedules') or [],
            'snapshotTimeUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}


def function_payload(functions):
    digests, configs = {}, {}
    for f in functions:
        require(re.fullmatch(r'[0-9a-f]{64}', f.get('d', '')) and f.get('n'), 'Missing existing function digest/name')
        digests[f['n']] = f['d']
        cfg = {new: f[old] for old, new in [('dn', 'display_name'), ('g', 'generator'), ('bd', 'build_data'), ('p', 'priority'), ('rg', 'region'), ('m', 'memory')] if old in f}
        if 'ro' in f:
            cfg['routes'] = [{new: r[old] for old, new in [('p', 'pattern'), ('l', 'literal'), ('e', 'expression'), ('m', 'methods'), ('ps', 'prefer_static')] if r.get(old) is not None} for r in f['ro']]
        configs[f['n']] = cfg
    return digests, configs


def prepare(snap, config_path, output):
    require(sys.platform == 'linux', 'Prepare/build executes on Runpod only')
    require(snap['siteId'] == SITE and len(snap['files']) > 100, 'Wrong/incomplete source snapshot')
    require(not output.exists(), 'Use a fresh staging directory')
    output.mkdir(parents=True)
    page = output / 'public/gl3/bridge'
    page.mkdir(parents=True)
    for name in ['index.html', 'style.css', 'app.mjs', 'core.mjs']:
        shutil.copyfile(HERE / 'bridge' / name, page / name)
    shutil.copyfile(HERE / 'bridge-state.mjs', page / 'bridge-state.mjs')
    c = json.loads(config_path.read_text())
    upstream = c.pop('rpcUpstreamHttpsUrl', None)
    include_fallback = c.pop('includeMainRpcFallback', True)
    require(isinstance(include_fallback, bool), 'Explicit fallback choice must be boolean')
    if c.get('enabled'):
        from urllib.parse import urlsplit
        u = urlsplit(upstream or '')
        require(u.scheme == 'https' and u.hostname and not u.username and not u.password and not u.query and not u.fragment, 'Actual credential-free HTTPS upstream binding is required')
        require(isinstance(c.get('readOnly'), bool), 'Explicit readOnly binding is required')
    (page / 'public-config.json').write_text(json.dumps(c, indent=2) + '\n')
    files = dict(snap['files'])
    additions = {}
    for p in sorted(page.iterdir()):
        key = PREFIX + p.name
        require(key not in files, f'Existing bridge path collision: {key}; obtain a reviewed update plan')
        digest = hashlib.sha1(p.read_bytes()).hexdigest()
        files[key] = digest
        additions[key] = {'sha1': digest, 'file': str(p.relative_to(output))}
    require(all(files.get(k) == v for k, v in snap['files'].items()), 'Existing file manifest changed')
    require('/mint/vendor/ethers.js' in files, 'Existing browser wallet dependency missing')
    fn, cfg = function_payload(snap['availableFunctions'])
    # Include the real lightweight explorer on the existing hostname as a DNS
    # fallback. The separate scan site uses the same unchanged static sources.
    scan = output / 'public/gl3/scan'; scan.mkdir(parents=True)
    for name in ['index.html', 'style.css', 'app.mjs', 'core.mjs']:
        shutil.copyfile(HERE / 'scan/public' / name, scan / name)
    scan_config = {'enabled': c['enabled'], 'chainId': 4663001, 'rpcUrl': c['childRpcUrl'],
                   'genesisHash': c['childGenesisHash'], 'nativeSymbol': 'GH0ST',
                   'confirmationMode': 'project-run-fast-confirmation', 'zkAtLaunch': False,
                   'readOnly': c.get('readOnly', True), 'networkPhase': c.get('networkPhase', 'bootstrap-read-only'),
                   'bridgeEnabled': bool(c['enabled'] and not c.get('readOnly', True)), 'rollupAddress': c.get('rollupAddress'),
                   'setupIncomplete': c.get('setupIncomplete', True), 'setupReceiptTxHashes': c.get('finalSetup', {}).get('setupReceiptTxHashes', [])}
    (scan / 'public-config.json').write_text(json.dumps(scan_config, indent=2) + '\n')
    for p in sorted(scan.iterdir()):
        key = '/gl3/scan/' + p.name
        require(key not in files, f'Existing scan path collision: {key}')
        digest = hashlib.sha1(p.read_bytes()).hexdigest(); files[key] = digest
        additions[key] = {'sha1': digest, 'file': str(p.relative_to(output))}
    require('gl3-rpc' not in fn, 'Existing gl3-rpc function needs a reviewed update plan')
    bound = {'GL3_RPC_ENABLED': 'true' if c['enabled'] else 'false', 'GL3_CHAIN_ID': '4663001',
             'GL3_GENESIS_HASH': c['childGenesisHash'], 'GL3_RPC_UPSTREAM_HTTPS_URL': upstream,
             'GL3_RPC_READ_ONLY': 'true' if c.get('readOnly', True) else 'false'}
    source = (HERE / 'rpc/netlify/functions/rpc.mjs').read_text()
    source = source.replace('export async function ', 'async function ').replace('export function ', 'function ')
    source = source.replace('export const handler = (event) => proxy(event);',
                            'const launchBinding = ' + json.dumps(bound) + ';\nexports.handler = (event) => proxy(event, launchBinding);')
    require('export ' not in source, 'Unrecognized RPC source export; do not produce an unsafe bundle')
    bundle = output / 'gl3-rpc.zip'
    with zipfile.ZipFile(bundle, 'w', compression=zipfile.ZIP_STORED) as z:
        z.writestr('gl3-rpc.js', source)
    function_digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    extra_functions = {}
    if include_fallback:
        fn['gl3-rpc'] = function_digest
        cfg['gl3-rpc'] = {'build_data': {'runtimeAPIVersion': 1}, 'routes': [{'pattern': '/gl3/rpc', 'literal': '/gl3/rpc', 'methods': ['POST', 'OPTIONS'], 'prefer_static': False}]}
        extra_functions = {'gl3-rpc': {'sha256': function_digest, 'file': 'gl3-rpc.zip', 'runtime': 'nodejs24.x', 'route': '/gl3/rpc'}}
    separate = {
        'status': 'sites_created_by_root_no_deploy_or_domain_binding_claim',
        'rpc': {'siteId': 'cda71aa3-eb0f-40be-ac67-d24c7545a703', 'siteHostname': 'gh0st-gl3-rpc.netlify.app',
                'bundle': 'gl3-rpc.zip', 'body': {'draft': True, 'files': {}, 'functions': {'gl3-rpc': function_digest},
                    'functions_config': {'gl3-rpc': {'build_data': {'runtimeAPIVersion': 1}, 'routes': [{'pattern': '/', 'literal': '/', 'methods': ['POST', 'OPTIONS'], 'prefer_static': False}]}}}},
        'scan': {'siteId': '60e107a7-2bda-498a-8790-b757a2321a5e', 'siteHostname': 'gh0st-gl3-scan.netlify.app',
                 'body': {'draft': True, 'files': {k.removeprefix('/gl3/scan'): v['sha1'] for k, v in additions.items() if k.startswith('/gl3/scan/')}}}
    }
    (output / 'separate-sites-plan.json').write_text(json.dumps(separate, indent=2) + '\n')
    plan = {'siteId': SITE, 'baseDeployId': snap['deployId'], 'originalFileCount': len(snap['files']),
            'originalFunctions': snap['availableFunctions'], 'additions': additions,
            'additionalFunctions': extra_functions,
            'body': {'files': files, 'functions': fn, 'functions_config': cfg, 'function_schedules': snap['functionSchedules'], 'draft': True},
            'profile': 'nitro-project-run-fast-confirmation', 'publicMutationPerformed': False}
    (output / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    return plan


def functions_match(expected, actual, additional=None):
    keys = ['n', 'd', 'r', 'im', 'bd', 'ro', 'p', 'rg', 'm']
    def norm(fs):
        return {x['n']: {k: x.get(k) for k in keys} for x in fs}
    a = norm(actual)
    original = norm(expected)
    if set(a) != set(original) | set(additional or {}):
        return False
    if any(a.get(k) != v for k, v in original.items()):
        return False
    for name, extra in (additional or {}).items():
        if a[name]['d'] != extra['sha256'] or a[name]['r'] != extra['runtime']:
            return False
        routes = a[name].get('ro') or []
        if len(routes) != 1 or routes[0].get('p') != extra['route'] or set(routes[0].get('m') or []) != {'POST', 'OPTIONS'}:
            return False
    return True


def draft(api, stage):
    p = json.loads((stage / 'plan.json').read_text())
    require(api.call('getSite', {'site_id': SITE})['published_deploy']['id'] == p['baseDeployId'], 'Production changed; obtain a fresh snapshot/stage')
    d = api.call('createSiteDeploy', {'site_id': SITE, 'body': p['body'], 'title': 'Add GH0ST GL3 bridge; preserve existing production'})
    dep = d['id']
    prep_deadline = time.monotonic() + 90
    while d.get('state') == 'preparing' and time.monotonic() < prep_deadline:
        time.sleep(2)
        d = api.call('getSiteDeploy', {'site_id': SITE, 'deploy_id': dep})
    require(d.get('state') != 'preparing', 'Draft preparation pending; inspect this draft before retrying')
    # Mutating call is draft-only. Never publish if existing artifacts need upload
    # or function runtime/routes/configuration fail exact preservation checks.
    required = d.get('required') or []
    require(not d.get('required_edge_functions') and not d.get('required_server'), 'Existing runtime artifact was not reusable; draft stays unpublished')
    new_functions = {v['sha256']: (k, v['file']) for k, v in p.get('additionalFunctions', {}).items()}
    require(all(x in new_functions for x in d.get('required_functions') or []), 'Existing function was not reusable; draft stays unpublished')
    for sha in d.get('required_functions') or []:
        name, rel = new_functions[sha]
        require(hashlib.sha256((stage / rel).read_bytes()).hexdigest() == sha, 'Staged function changed')
        api.upload_function(dep, name, stage / rel)
    by_sha = {x['sha1']: (k, x['file']) for k, x in p['additions'].items()}
    require(all(x in by_sha for x in required), 'Netlify requested an old file; stop without publishing')
    for sha in required:
        key, rel = by_sha[sha]
        contents = (stage / rel).read_text()
        require(hashlib.sha1(contents.encode()).hexdigest() == sha, 'Staged bytes changed')
        api.call('uploadDeployFile', {'deploy_id': dep, 'path': key.lstrip('/'), 'body': contents})
    deadline = time.monotonic() + 180
    while d.get('state') != 'ready' and time.monotonic() < deadline:
        require(d.get('state') != 'error', 'Draft processing failed; production unchanged')
        time.sleep(2)
        d = api.call('getSiteDeploy', {'site_id': SITE, 'deploy_id': dep})
    require(d.get('state') == 'ready', 'Draft not ready; production unchanged')
    require(functions_match(p['originalFunctions'], d.get('available_functions') or [], p.get('additionalFunctions')), 'Function digest/runtime/routes changed; draft stays unpublished')
    r = {'siteId': SITE, 'baseDeployId': p['baseDeployId'], 'draftDeployId': dep, 'draftUrl': d['deploy_ssl_url'],
         'existingFileHashesPreserved': True, 'existingFunctionMetadataPreserved': True,
         'requiresPageNetworkAndOperatorReview': True, 'published': False}
    (stage / 'draft-receipt.json').write_text(json.dumps(r, indent=2) + '\n')
    return r


def publish(api, stage, review):
    p = json.loads((stage / 'plan.json').read_text())
    r = json.loads((stage / 'draft-receipt.json').read_text())
    require(review.get('publicDeploymentApproved') is True and review.get('reviewedPageAndNetworkBindings') is True and review.get('reviewedFunctionPreservation') is True, 'Explicit completed production review required')
    require(all(review.get(k) is True for k in ['reviewedNewGenesisAndSetupReceipts', 'reviewedFinalChildOwnersZeroAndNoMinters', 'reviewedTreasuryFeeRecipientsAndManualAepAccounting']), 'Final genesis, authority and treasury accounting review required')
    require(review.get('siteId') == SITE and review.get('draftDeployId') == r['draftDeployId'] and review.get('baseDeployId') == p['baseDeployId'], 'Review does not match this exact draft')
    require(re.fullmatch(r'[0-9a-f]{64}', review.get('operatorLicenseReviewSha256') or '') and review.get('liveRpcBindingEvidence'), 'Operator/license review hash and live network evidence required')
    require(api.call('getSite', {'site_id': SITE})['published_deploy']['id'] == p['baseDeployId'], 'Production advanced; do not overwrite it')
    d = api.call('getSiteDeploy', {'site_id': SITE, 'deploy_id': r['draftDeployId']})
    require(d['state'] == 'ready' and functions_match(p['originalFunctions'], d.get('available_functions') or [], p.get('additionalFunctions')), 'Draft is no longer verified')
    api.call('restoreSiteDeploy', {'site_id': SITE, 'deploy_id': r['draftDeployId']})
    current = api.call('getSite', {'site_id': SITE})
    require(current['published_deploy']['id'] == r['draftDeployId'], 'Publish outcome ambiguous; inspect before any retry')
    return {'published': True, 'siteId': SITE, 'deployId': r['draftDeployId'], 'url': 'https://gh0st.fyi/gl3/bridge/'}


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument('--cli', required=True, help='Existing project-local authenticated Netlify CLI path')
    s = a.add_subparsers(dest='command', required=True)
    q = s.add_parser('snapshot'); q.add_argument('output', type=Path)
    q = s.add_parser('prepare'); q.add_argument('snapshot', type=Path); q.add_argument('config', type=Path); q.add_argument('output', type=Path)
    q = s.add_parser('draft'); q.add_argument('stage', type=Path); q.add_argument('--execute-reviewed-draft', action='store_true', required=True)
    q = s.add_parser('publish'); q.add_argument('stage', type=Path); q.add_argument('review', type=Path); q.add_argument('--execute-reviewed-publish', action='store_true', required=True)
    args = a.parse_args(); api = Cli(args.cli)
    if args.command == 'snapshot':
        require(not args.output.exists(), 'Snapshot output exists'); result = snapshot(api); args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'siteId': SITE, 'deployId': result['deployId'], 'fileCount': len(result['files']), 'functionCount': len(result['availableFunctions'])}))
    elif args.command == 'prepare':
        result = prepare(json.loads(args.snapshot.read_text()), args.config, args.output)
        print(json.dumps({'prepared': True, 'originalFiles': result['originalFileCount'], 'additions': list(result['additions'])}))
    elif args.command == 'draft': print(json.dumps(draft(api, args.stage)))
    elif args.command == 'publish': print(json.dumps(publish(api, args.stage, json.loads(args.review.read_text()))))
