"""Validate fixed deployment fee ceilings offline with synthetic jobs and a local key.

No deployment journals, private files, public RPCs, or persistent signing keys are
used. The generated signature only exercises transaction serialization.
"""
import copy
import hashlib
import json

import rlp

import deploy as d


class MockRPC:
    def __init__(self, price, jobs):
        self.price = price
        self.estimates = {'0x' + j['init'].hex(): 1000001 + i * 54321
                          for i, j in enumerate(jobs)}
        self.calls = []

    def __call__(self, method, params=()):
        self.calls.append(method)
        if method == 'eth_gasPrice':
            return hex(self.price)
        if method == 'eth_getBalance':
            return hex(10**18)
        raise AssertionError('Unexpected RPC method: ' + method)

    def batch(self, calls):
        result = []
        for method, params in calls:
            self.calls.append(method)
            assert method == 'eth_estimateGas'
            assert params[0]['value'] == '0x0'
            result.append({'result': hex(self.estimates[params[0]['data']])})
        return result


class MockNitroRPC(MockRPC):
    def __init__(self, price, jobs, total=41300000, l1=11050000):
        super().__init__(price, jobs)
        self.total, self.l1 = total, l1

    def batch(self, calls):
        result = []
        for method, params in calls:
            self.calls.append(method)
            assert method == 'eth_call' and params[1] == 'latest'
            call = params[0]
            assert call['to'].lower() == '0x00000000000000000000000000000000000000c8'
            encoded = bytes.fromhex(call['data'][2:])
            assert encoded[:4] == d.keccak(text='gasEstimateComponents(address,bool,bytes)')[:4]
            to, creation, data = d.decode(['address', 'bool', 'bytes'], encoded[4:])
            assert int(to, 16) == 0 and creation is True
            assert '0x' + data.hex() in self.estimates
            result.append({'result': '0x' + d.encode(
                ['uint64', 'uint64', 'uint256', 'uint256'],
                [self.total, self.l1, self.price, 2102555968]).hex()})
        return result


def main():
    checks = []

    def check(name, condition):
        assert condition, name
        checks.append(name)
        print('PASS ' + name, flush=True)

    # Synthetic, uniquely encoded creation jobs; no model files are loaded.
    jobs = [{'name': f'fourbit-weights-{i:04d}',
             'init': bytes.fromhex('60006000f3') + i.to_bytes(2, 'big'),
             'runtime': b'\0' + i.to_bytes(2, 'big'), 'modeled_gas': 1000000}
            for i in range(30)]
    state = {'receipts': []}
    account = d.Account.create()
    cap = 20788000
    rpc = MockRPC(cap, jobs)
    explicit = d.snapshot(rpc, account.address, jobs, state, 25, 0, 32000000,
                          gas_price_ceiling=cap)
    default = d.snapshot(rpc, account.address, jobs, state, 25, 0, 32000000)
    quotes = explicit['next_batch']
    check('Explicit ceiling is exact with no gas-price markup',
          explicit['signed_gas_price_ceiling_wei'] == cap and
          all(q['gas_price_wei'] == cap for q in quotes))
    check('Default fee policy retains its existing 2 percent price buffer',
          default['signed_gas_price_ceiling_wei'] == (cap * 102 + 99) // 100 and
          all(q['gas_price_wei'] == (cap * 102 + 99) // 100
              for q in default['next_batch']))
    check('Existing 3 percent gas-unit headroom and upward rounding are retained',
          all(q['gas_limit'] == (q['estimated_gas'] * 103 + 99) // 100
              for q in quotes))
    check('Quote is bounded to the requested 25 weights',
          len(quotes) == 25 and
          [q['name'] for q in quotes] == [j['name'] for j in jobs[:25]])
    expected_maximum = sum(q['gas_limit'] for q in quotes) * cap
    check('Individual and aggregate maximum fees use the signed ceiling',
          all(q['maximum_fee_wei'] == q['gas_limit'] * cap for q in quotes) and
          explicit['next_batch_maximum_fee_wei'] == expected_maximum and
          sum(q['maximum_fee_wei'] for q in quotes) == expected_maximum)

    rpc.price = cap * 3
    risen = d.snapshot(rpc, account.address, jobs, state, 25, 0, 32000000,
                       gas_price_ceiling=cap)
    check('A higher observed price never raises an explicit ceiling or maximum',
          risen['current_gas_price_wei'] == cap * 3 and
          risen['signed_gas_price_ceiling_wei'] == cap and
          risen['next_batch'] == quotes and
          risen['next_batch_maximum_fee_wei'] == expected_maximum)

    entry = dict(quotes[0], nonce=2)
    job_map = {j['name']: j for j in jobs}
    signed = d.signed_bundle(account, 4663, [entry], job_map)
    raw = bytes.fromhex(signed[entry['hash']][2:])
    fields = rlp.decode(raw)
    integer = lambda value: int.from_bytes(value, 'big')
    check('Legacy RLP encodes exact gas-price ceiling, gas limit and creation data',
          len(fields) == 9 and integer(fields[0]) == 2 and
          integer(fields[1]) == cap and integer(fields[2]) == entry['gas_limit'] and
          fields[3] == b'' and fields[5] == jobs[0]['init'])
    check('Sample creation sends zero ETH and is bound to chain 4663',
          integer(fields[4]) == 0 and (integer(fields[6]) - 35) // 2 == 4663 and
          d.Account.recover_transaction(raw) == account.address)
    check('Sample signed data retains its exact creation hash pin',
          hashlib.sha256(fields[5]).hexdigest() == entry['init_sha256'])
    check('Recovery signing reproduces identical bytes and journal hash',
          d.signed_bundle(account, 4663, [copy.deepcopy(entry)], job_map) == signed)

    original = copy.deepcopy(entry)
    changed = dict(entry, gas_price_wei=cap + 1,
                   maximum_fee_wei=entry['gas_limit'] * (cap + 1))
    rejected = False
    try:
        d.signed_bundle(account, 4663, [changed], job_map)
    except RuntimeError as error:
        rejected = str(error) == 'Recovery signature/hash mismatch'
    check('An existing journal hash refuses signing with a changed price ceiling',
          rejected and entry == original and changed['hash'] == original['hash'])
    check('Offline validation never requests a send method',
          set(rpc.calls) <= {'eth_gasPrice', 'eth_getBalance', 'eth_estimateGas'})

    nitro_rpc = MockNitroRPC(cap, jobs)
    nitro = d.snapshot(nitro_rpc, account.address, jobs, state, 25, 0, 32000000,
                       gas_price_ceiling=cap, nitro_components=True)
    nitro_quotes = nitro['next_batch']
    check('Nitro allows total gas above 32 million when execution fits its limit',
          len(nitro_quotes) == 25 and
          all(q['estimated_gas'] == 41300000 and
              q['estimated_l1_gas'] == 11050000 and
              q['estimated_execution_gas'] == 30250000 and
              q['estimated_execution_gas'] * 103 // 100 < 32000000
              for q in nitro_quotes) and
          nitro['limit_scope'] == 'Nitro execution gas excluding parent posting')
    buffered_total = (41300000 * 103 + 99) // 100
    check('Nitro retains 3 percent total gas headroom and the exact signed fee ceiling',
          buffered_total > 32000000 and
          all(q['gas_limit'] == buffered_total and q['gas_price_wei'] == cap
              and q['maximum_fee_wei'] == buffered_total * cap
              for q in nitro_quotes) and
          nitro['next_batch_maximum_fee_wei'] == 25 * buffered_total * cap)
    nitro_entry = dict(nitro_quotes[0], nonce=3)
    nitro_signed = d.signed_bundle(account, 4663, [nitro_entry], job_map)
    nitro_fields = rlp.decode(bytes.fromhex(nitro_signed[nitro_entry['hash']][2:]))
    check('Legacy signing preserves total gas above the compute limit and its maximum fee',
          integer(nitro_fields[2]) == buffered_total and
          integer(nitro_fields[1]) == cap and
          integer(nitro_fields[1]) * integer(nitro_fields[2]) == nitro_entry['maximum_fee_wei'])

    for name, total, l1, expected_error in [
        ('Nitro rejects 32.1 million execution gas', 43150000, 11050000,
         'Buffered execution exceeds live transaction computation limit'),
        ('Nitro rejects execution whose 3 percent buffer exceeds its limit', 42250000, 11050000,
         'Buffered execution exceeds live transaction computation limit'),
        ('Nitro rejects an L1 component equal to the total', 41300000, 41300000,
         'Invalid Nitro gas components'),
        ('Nitro rejects an L1 component greater than the total', 41300000, 41300001,
         'Invalid Nitro gas components')]:
        rejected = False
        try:
            d.snapshot(MockNitroRPC(cap, jobs, total, l1), account.address,
                       jobs, state, 25, 0, 32000000,
                       gas_price_ceiling=cap, nitro_components=True)
        except RuntimeError as error:
            rejected = str(error) == expected_error
        check(name, rejected)
    check('Nitro component validation remains offline and never requests a send method',
          set(nitro_rpc.calls) <= {'eth_gasPrice', 'eth_getBalance', 'eth_call'})

    posting_reserve = 12000000
    execution = 30250000
    reserve_quote = d.snapshot(
        MockNitroRPC(cap, jobs, execution, 0), account.address, jobs, state,
        25, 0, 32000000, gas_price_ceiling=cap, nitro_components=True,
        l1_gas_reserve=posting_reserve)
    reserve_limit = ((execution + posting_reserve) * 103 + 99) // 100
    check('A zero observed L1 fee retains the explicit posting reserve plus 3 percent headroom',
          all(q['estimated_l1_gas'] == 0 and q['reserved_l1_gas'] == posting_reserve
              and q['gas_limit'] == reserve_limit for q in reserve_quote['next_batch']) and
          reserve_quote['next_batch_maximum_fee_wei'] == 25 * reserve_limit * cap)
    for observed_l1 in (5000000, 12000000, 14000000):
        observed = d.snapshot(
            MockNitroRPC(cap, jobs, execution + observed_l1, observed_l1),
            account.address, jobs, state, 25, 0, 32000000,
            gas_price_ceiling=cap, nitro_components=True, l1_gas_reserve=posting_reserve)
        expected_l1 = max(posting_reserve, observed_l1)
        expected_limit = ((execution + expected_l1) * 103 + 99) // 100
        check(f'Observed L1 gas {observed_l1} uses the larger of estimate and reserve without double counting',
              all(q['reserved_l1_gas'] == expected_l1 and
                  q['gas_limit'] == expected_limit and q['gas_price_wei'] == cap and
                  q['maximum_fee_wei'] == expected_limit * cap
                  for q in observed['next_batch']) and
              observed['next_batch_maximum_fee_wei'] == 25 * expected_limit * cap)
    for name, reserve_value, use_nitro in [
        ('Negative parent posting reserve is rejected', -1, True),
        ('Parent posting reserve without Nitro components is rejected', posting_reserve, False)]:
        rejected = False
        try:
            d.snapshot(MockNitroRPC(cap, jobs), account.address, jobs, state,
                       25, 0, 32000000, gas_price_ceiling=cap,
                       nitro_components=use_nitro, l1_gas_reserve=reserve_value)
        except RuntimeError as error:
            rejected = str(error) == 'Parent posting reserve requires Nitro components'
        check(name, rejected)

    class ReceiptRPC:
        def __call__(self, method, params=()):
            assert method == 'eth_getCode'
            return '0x' + jobs[0]['runtime'].hex()

    def mock_receipt(saved_entry, used, actual_l1=None):
        address = '0x' + d.keccak(rlp.encode([
            bytes.fromhex(account.address[2:]), saved_entry['nonce']]))[-20:].hex()
        result = {'transactionHash': saved_entry['hash'], 'from': account.address,
                  'gasUsed': hex(used), 'effectiveGasPrice': hex(cap), 'status': '0x1',
                  'contractAddress': address, 'blockNumber': '0x1', 'blockHash': '0x' + 'ab' * 32}
        if actual_l1 is not None:
            result['gasUsedForL1'] = hex(actual_l1)
        return result

    reserved_entry = dict(reserve_quote['next_batch'][0], nonce=4)
    d.signed_bundle(account, 4663, [reserved_entry], job_map)
    receipt = mock_receipt(reserved_entry, 41000000, 11000000)
    actual = d.receipt_row(ReceiptRPC(), account.address, reserved_entry, jobs[0], receipt)
    check('Nitro receipts record actual parent and execution gas and charge only actual total gas',
          actual['gas_used_for_l1'] == 11000000 and actual['execution_gas_used'] == 30000000 and
          actual['fee_wei'] == 41000000 * cap < reserved_entry['maximum_fee_wei'] and
          actual['runtime_verified'])
    check('Recorded Nitro receipts retain their shape when reverified',
          d.receipt_row(ReceiptRPC(), account.address, actual, jobs[0], receipt) == actual)
    legacy_receipt = mock_receipt(entry, entry['estimated_gas'], 0)
    old_row = d.receipt_row(ReceiptRPC(), account.address, entry, jobs[0], legacy_receipt)
    check('Existing legacy receipt shape remains unchanged even when RPC supplies L1 gas',
          'gas_used_for_l1' not in old_row and 'execution_gas_used' not in old_row and
          d.receipt_row(ReceiptRPC(), account.address, old_row, jobs[0], legacy_receipt) == old_row)
    for name, bad_receipt, expected_error in [
        ('Nitro receipts require actual posting accounting',
         mock_receipt(reserved_entry, 41000000), 'Nitro receipt lacks parent posting gas accounting'),
        ('Nitro receipts reject actual posting gas greater than total gas',
         mock_receipt(reserved_entry, 41000000, 41000001), 'Invalid actual Nitro gas components')]:
        rejected = False
        try:
            d.receipt_row(ReceiptRPC(), account.address, reserved_entry, jobs[0], bad_receipt)
        except RuntimeError as error:
            rejected = str(error) == expected_error
        check(name, rejected)
    del account
    d.save(d.ROOT / 'fee-ceiling-validation.json', {
        'status': 'passed', 'checks': checks, 'checks_passed': len(checks),
        'network': 'none; mock RPC only', 'public_transactions_sent': 0,
        'sample_chain_id': 4663, 'sample_fixed_ceiling_wei': cap,
        'sample_batch_maximum_fee_wei': expected_maximum,
        'sample_batch_contracts': len(quotes),
        'nitro_sample_total_gas': 41300000, 'nitro_sample_l1_gas': 11050000,
        'nitro_sample_execution_gas': 30250000,
        'nitro_sample_signed_gas_limit': buffered_total,
        'nitro_sample_batch_maximum_fee_wei': nitro['next_batch_maximum_fee_wei'],
        'nitro_sample_posting_reserve': posting_reserve,
        'nitro_sample_reserved_signed_gas_limit': reserve_limit,
        'signing_key': 'generated in memory for synthetic offline transaction only'})
    print(json.dumps({'fee_ceiling_checks_passed': len(checks),
                      'public_transactions_sent': 0}))


if __name__ == '__main__':
    main()
