"""Check the one-time rejected-journal migration without a network or signer."""
import copy
import json
import tempfile
from decimal import Decimal
from pathlib import Path
import deploy as d


def main():
    source = json.loads((d.ROOT/'mainnet/deployment-state.json').read_text())
    original = copy.deepcopy(source)
    original['active_bundle'] = (source.get('superseded_bundles') or [source['active_bundle']])[0]
    original['receipts'] = [r for r in source['receipts'] if r['name'] == 'FourBitAffine64']
    checks = []
    class Mock:
        def __init__(self, pending=False, present=False, consumed=False):
            self.pending, self.present, self.consumed = pending, present, consumed
            self.queries = 0
        def batch(self, calls):
            self.queries += len(calls)
            return [{'result': {'hash': 'present'} if self.present else None} for _ in calls]
        def __call__(self, method, params):
            return hex(4 if self.consumed or (self.pending and params[-1] == 'pending') else 3)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder)/'state.json'
        for name, mock, cap in [
            ('Pending nonce blocks replacement', Mock(pending=True), '0.015976129117'),
            ('Consumed nonce blocks replacement', Mock(consumed=True), '0.015976129117'),
            ('Any present original transaction or receipt blocks replacement', Mock(present=True), '0.015976129117'),
            ('Original aggregate fee cap cannot be increased', Mock(), '0.016')]:
            state = copy.deepcopy(original)
            try:
                d.replace_rejected_encoding(mock, state, path, 24, Decimal(cap))
            except RuntimeError:
                assert state == original and not path.exists()
            else:
                raise AssertionError(name)
            checks.append(name)
        state, mock = copy.deepcopy(original), Mock()
        d.replace_rejected_encoding(mock, state, path, 24, Decimal('0.015976129117'))
        assert mock.queries == 48
        checks.append('Exactly 24 transaction and 24 receipt absences checked')
        assert state['active_bundle'] is None and len(state['receipts']) == 1
        checks.append('Mined kernel retained and rejected active journal cleared')
        assert state['superseded_bundles'][-1]['transactions'] == original['active_bundle']['transactions']
        checks.append('Original signed journal archived intact')
        assert json.loads(path.read_text()) == state
        checks.append('Migration persisted durably')
    d.save(d.ROOT/'creation-migration-validation.json', {'status':'passed','checks':checks,
        'checks_passed':len(checks),'public_transactions_sent':0})
    print(json.dumps({'migration_checks_passed':len(checks)}))


if __name__ == '__main__':
    main()
