import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('deploy', HERE / 'netlify_additive.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
checks = []
snap = json.loads((HERE / 'evidence/current-production-snapshot.json').read_text())


class FakeApi:
    """Only in-memory state, no HTTP, credentials or external mutation."""
    def __init__(self, plan, drift=False, corrupt=False):
        self.plan, self.calls, self.drift, self.corrupt = plan, [], drift, corrupt
        self.published = plan['baseDeployId']

    def call(self, name, data):
        self.calls.append(name)
        if name == 'getSite': return {'published_deploy': {'id': 'changed' if self.drift else self.published}}
        if name == 'createSiteDeploy':
            assert data['body']['draft'] is True
            return {'id': 'a' * 24, 'state': 'uploading', 'required': [v['sha1'] for v in self.plan['additions'].values()], 'required_functions': [v['sha256'] for v in self.plan['additionalFunctions'].values()]}
        if name == 'uploadDeployFile': return {'uploaded': True}
        if name == 'getSiteDeploy':
            functions = json.loads(json.dumps(self.plan['originalFunctions']))
            if self.corrupt: functions[0]['r'] = 'wrong-runtime'
            e = self.plan['additionalFunctions']['gl3-rpc']
            functions.append({'n': 'gl3-rpc', 'd': e['sha256'], 'r': e['runtime'], 'ro': [{'p': '/gl3/rpc', 'm': ['POST', 'OPTIONS']}]})
            return {'state': 'ready', 'deploy_ssl_url': 'https://fixture.invalid', 'available_functions': functions}
        if name == 'restoreSiteDeploy': self.published = data['deploy_id']; return {}
        raise AssertionError(name)

    def upload_function(self, deploy_id, name, file):
        assert deploy_id == 'a' * 24 and name == 'gl3-rpc' and file.exists(); self.calls.append('upload_function')


with tempfile.TemporaryDirectory() as tmp:
    stage = Path(tmp) / 'stage'
    p = m.prepare(snap, HERE / 'bridge/public-config.example.json', stage)
    assert len(p['body']['files']) == len(snap['files']) + 11
    assert all(p['body']['files'][k] == v for k, v in snap['files'].items())
    assert all(k.startswith(('/gl3/bridge/', '/gl3/scan/')) for k in p['additions'])
    assert len(p['body']['functions']) == len(snap['availableFunctions']) + 1
    checks.append('all actual production file hashes and two original functions preserved; only11 additive static files and one fallback RPC function')
    assert not (stage / 'public/gl3/bridge/operator-review.html').exists()
    assert 'rpcUpstreamHttpsUrl' not in json.loads((stage / 'public/gl3/bridge/public-config.json').read_text())
    with zipfile.ZipFile(stage / 'gl3-rpc.zip') as z:
        assert z.namelist() == ['gl3-rpc.js']; assert 'exports.handler' in z.read('gl3-rpc.js').decode()
    checks.append('private operator review/upstream excluded from static page; native handler ZIP prepared on Runpod')
    api = FakeApi(p); r = m.draft(api, stage)
    assert r['published'] is False and 'restoreSiteDeploy' not in api.calls
    checks.append('fixture draft uploads additive assets and RPC bundle without publishing')
    for kwargs in [{'drift': True}, {'corrupt': True}]:
        bad = FakeApi(p, **kwargs)
        try: m.draft(bad, stage)
        except ValueError: pass
        else: raise AssertionError('invalid draft accepted')
        assert 'restoreSiteDeploy' not in bad.calls
    checks.append('production races and changed original function runtimes block publication')
    try: m.publish(api, stage, {})
    except ValueError: pass
    else: raise AssertionError('unreviewed publish accepted')
    checks.append('missing exact operator and deployment review blocks publish')
    review = {'publicDeploymentApproved': True, 'reviewedPageAndNetworkBindings': True, 'reviewedFunctionPreservation': True,
              'reviewedNewGenesisAndSetupReceipts': True, 'reviewedFinalChildOwnersZeroAndNoMinters': True,
              'reviewedTreasuryFeeRecipientsAndManualAepAccounting': True, 'siteId': m.SITE, 'draftDeployId': 'a' * 24,
              'baseDeployId': p['baseDeployId'], 'operatorLicenseReviewSha256': 'b' * 64, 'liveRpcBindingEvidence': 'unit-fixture-only'}
    assert m.publish(api, stage, review)['published'] is True
    assert api.published == 'a' * 24
    checks.append('only exact reviewed draft is published in memory; never a public API')
    config = json.loads((HERE / 'bridge/public-config.example.json').read_text()); config['includeMainRpcFallback'] = False
    separate_config = Path(tmp) / 'separate-config.json'; separate_config.write_text(json.dumps(config))
    p2 = m.prepare(snap, separate_config, Path(tmp) / 'separate-stage')
    assert p2['additionalFunctions'] == {} and len(p2['body']['functions']) == len(snap['availableFunctions'])
    sites = json.loads((Path(tmp) / 'separate-stage/separate-sites-plan.json').read_text())
    assert sites['rpc']['siteId'] == 'cda71aa3-eb0f-40be-ac67-d24c7545a703'
    assert sites['scan']['siteId'] == '60e107a7-2bda-498a-8790-b757a2321a5e'
    checks.append('separate RPC choice leaves main-site functions unchanged and binds actual root-created site IDs')
    print(json.dumps({'scope': 'Runpod in-memory API fixtures only; no Netlify writes or auth read', 'passed': len(checks), 'checks': checks}, indent=2))
