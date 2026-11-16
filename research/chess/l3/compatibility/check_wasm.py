"""Conservative Wasm feature inspection, NOT Nitro activation or proof validation.

Instruction immediates are decoded, so an 0xfd byte in data/const values cannot
be misreported as SIMD. Unknown encodings fail closed. An optional Wasmtime
validator checks static types when installed; this remains distinct from Nitro.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / '.cache' / 'deps'))


class InvalidWasm(ValueError):
    pass


class Reader:
    def __init__(self, data):
        self.data = memoryview(data)
        self.p = 0

    def take(self, count):
        if count < 0 or self.p + count > len(self.data):
            raise InvalidWasm('truncated binary')
        out = self.data[self.p:self.p + count]
        self.p += count
        return out

    def byte(self):
        return self.take(1)[0]

    def leb(self, bits=32, signed=False):
        value = shift = 0
        for _ in range((bits + 6) // 7):
            b = self.byte()
            value |= (b & 127) << shift
            shift += 7
            if not b & 128:
                if signed and b & 64:
                    value |= -(1 << shift)
                if not signed and value >= 1 << bits:
                    raise InvalidWasm('LEB overflow')
                if signed and not -(1 << (bits - 1)) <= value < (1 << (bits - 1)):
                    raise InvalidWasm('signed LEB overflow')
                return value
        raise InvalidWasm('LEB too long')

    def name(self):
        try:
            return bytes(self.take(self.leb())).decode('utf-8')
        except UnicodeDecodeError as error:
            raise InvalidWasm('non-UTF8 name') from error

    def done(self):
        if self.p != len(self.data):
            raise InvalidWasm('trailing section/body bytes')


def inspect(data):
    r = Reader(data)
    if bytes(r.take(8)) != b'\0asm\x01\0\0\0':
        raise InvalidWasm('not a core Wasm v1 module')
    out = {'moduleBytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
           'features': {'simd': False, 'relaxedSIMD': False, 'atomics': False,
                        'memory64': False, 'sharedMemory': False, 'floats': False,
                        'tailCalls': False, 'referenceTypes': False},
           'imports': [], 'memories': [], 'exports': [], 'exportCount': 0, 'hasStylusEntrypoint': False, 'codeSectionBytes': 0,
           'dataSectionBytes': 0, 'instructionCount': 0, 'functionBodies': 0}
    f = out['features']

    def valtype(x):
        if x not in [0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]:
            raise InvalidWasm('unsupported value type')
        if x in [0x7d, 0x7c]: f['floats'] = True
        if x == 0x7b: f['simd'] = True
        if x in [0x70, 0x6f]: f['referenceTypes'] = True

    def limits(q, memory=False):
        flags = q.leb()
        if flags & ~7: raise InvalidWasm('unsupported memory/table limits')
        is64 = bool(flags & 4)
        lo = q.leb(64 if is64 else 32)
        hi = q.leb(64 if is64 else 32) if flags & 1 else None
        if hi is not None and hi < lo: raise InvalidWasm('maximum smaller than minimum')
        if flags & 2 and hi is None: raise InvalidWasm('shared memory without maximum')
        if memory:
            f['memory64'] |= is64
            f['sharedMemory'] |= bool(flags & 2)
            out['memories'].append({'minimumPages': lo, 'maximumPages': hi,
                                    'memory64': is64, 'shared': bool(flags & 2)})

    def memarg(q):
        q.leb(); q.leb(64)

    def expr(q):
        depth = 1
        while depth:
            op = q.byte()
            out['instructionCount'] += 1
            if op in [2, 3, 4]:
                q.leb(33, True); depth += 1
            elif op == 11:
                depth -= 1
            elif op in [0, 1, 5, 15, 26, 27] or 0x45 <= op <= 0xc4:
                if 0x5b <= op <= 0x66 or 0x8b <= op <= 0xa6 or 0xa8 <= op <= 0xab or 0xae <= op <= 0xbf:
                    f['floats'] = True
            elif op in [12, 13, 16, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26]:
                q.leb()
                if op in [0x25, 0x26]: f['referenceTypes'] = True
            elif op == 14:
                for _ in range(q.leb() + 1): q.leb()
            elif op in [17, 19]:
                q.leb(); q.leb()
                if op == 19: f['tailCalls'] = True
            elif op in [18, 20, 21]:
                q.leb(); f['tailCalls'] |= op in [18, 21]
                f['referenceTypes'] |= op in [20, 21]
            elif op == 28:
                f['referenceTypes'] = True
                for _ in range(q.leb()): valtype(q.byte())
            elif 0x28 <= op <= 0x3e:
                memarg(q)
                if op in [0x2a, 0x2b, 0x38, 0x39]: f['floats'] = True
            elif op in [0x3f, 0x40]: q.leb()
            elif op == 0x41: q.leb(32, True)
            elif op == 0x42: q.leb(64, True)
            elif op in [0x43, 0x44]:
                q.take(4 if op == 0x43 else 8); f['floats'] = True
            elif op == 0xd0:
                q.leb(33, True); f['referenceTypes'] = True
            elif op == 0xd1: f['referenceTypes'] = True
            elif op == 0xd2:
                q.leb(); f['referenceTypes'] = True
            elif op == 0xfc:
                sub = q.leb()
                if sub < 8: f['floats'] = True
                elif sub in [8, 10, 12, 14]: q.leb(); q.leb()
                elif sub in [9, 11, 13, 15, 16, 17]: q.leb()
                else: raise InvalidWasm('unsupported bulk-memory opcode')
            elif op == 0xfd:
                sub = q.leb(); f['simd'] = True
                f['relaxedSIMD'] |= sub >= 0x100
                if sub <= 11 or sub in [92, 93]: memarg(q)
                elif sub in [12, 13]: q.take(16)
                elif 21 <= sub <= 34: q.take(1)
                elif 84 <= sub <= 91: memarg(q); q.take(1)
                elif sub > 0x113: raise InvalidWasm('unsupported SIMD opcode')
            elif op == 0xfe:
                sub = q.leb(); f['atomics'] = True
                if sub == 3:
                    if q.byte() != 0: raise InvalidWasm('invalid atomic fence immediate')
                elif sub <= 0x4e: memarg(q)
                else: raise InvalidWasm('unsupported atomic opcode')
            else:
                raise InvalidWasm(f'unsupported instruction opcode 0x{op:02x}')

    seen = set()
    order = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 12: 10, 10: 11, 11: 12}
    last_order = 0
    function_count = None
    while r.p < len(r.data):
        section = r.byte()
        q = Reader(r.take(r.leb()))
        if section and section in seen: raise InvalidWasm('duplicate section')
        if section:
            if section not in order or order[section] < last_order:
                raise InvalidWasm('unsupported or out-of-order section')
            last_order = order[section]
            seen.add(section)
        if section == 0:
            q.name(); q.take(len(q.data) - q.p)
        elif section == 1:
            for _ in range(q.leb()):
                if q.byte() != 0x60: raise InvalidWasm('unsupported GC/recursive function type')
                for _ in range(q.leb()): valtype(q.byte())
                for _ in range(q.leb()): valtype(q.byte())
        elif section == 2:
            for _ in range(q.leb()):
                module, name, kind = q.name(), q.name(), q.byte()
                out['imports'].append({'module': module, 'name': name, 'kind': kind})
                if kind == 0: q.leb()
                elif kind == 1: valtype(q.byte()); limits(q)
                elif kind == 2: limits(q, True)
                elif kind == 3: valtype(q.byte()); q.byte()
                else: raise InvalidWasm('unsupported import kind')
        elif section == 3:
            function_count = q.leb()
            for _ in range(function_count): q.leb()
        elif section == 4:
            for _ in range(q.leb()):
                # MVP funcref tables are permitted; reference instructions are separate.
                ty = q.byte()
                if ty != 0x70: valtype(ty)
                limits(q)
        elif section == 5:
            for _ in range(q.leb()): limits(q, True)
        elif section == 6:
            for _ in range(q.leb()): valtype(q.byte()); q.byte(); expr(q)
        elif section == 7:
            for _ in range(q.leb()):
                export = {'name': q.name(), 'kind': q.byte(), 'index': q.leb()}
                out['exportCount'] += 1
                out['hasStylusEntrypoint'] |= export['name'] == 'user_entrypoint' and export['kind'] == 0
                if len(out['exports']) < 32 or export['name'] == 'user_entrypoint':
                    out['exports'].append(export)
        elif section == 8: q.leb()
        elif section == 9:
            for _ in range(q.leb()):
                flags = q.leb()
                if flags > 7: raise InvalidWasm('unsupported element encoding')
                if flags in [2, 6]: q.leb()
                if flags in [0, 2, 4, 6]: expr(q)
                if flags in [1, 2, 3]:
                    if q.byte() != 0: raise InvalidWasm('invalid elemkind')
                if flags in [5, 6, 7]: valtype(q.byte())
                for _ in range(q.leb()):
                    if flags >= 4: expr(q)
                    else: q.leb()
        elif section == 10:
            out['codeSectionBytes'] = len(q.data)
            count = q.leb(); out['functionBodies'] = count
            if function_count != count: raise InvalidWasm('function/code count mismatch')
            for _ in range(count):
                body = Reader(q.take(q.leb()))
                for _ in range(body.leb()): body.leb(); valtype(body.byte())
                expr(body); body.done()
        elif section == 11:
            out['dataSectionBytes'] = len(q.data)
            for _ in range(q.leb()):
                flags = q.leb()
                if flags == 2: q.leb()
                if flags in [0, 2]: expr(q)
                elif flags != 1: raise InvalidWasm('unsupported data encoding')
                q.take(q.leb())
        elif section == 12: q.leb()
        else: raise InvalidWasm('unsupported section')
        q.done()
    if function_count is not None and function_count and 10 not in seen:
        raise InvalidWasm('missing code section')
    out['structuralInspectionCompleted'] = True
    out['staticTypeValidation'] = 'not performed; install optional wasmtime'
    try:
        import wasmtime
        wasmtime.Module.validate(wasmtime.Engine(), data)
        out['staticTypeValidation'] = 'passed Wasmtime generic validation, not Nitro validation'
    except ImportError:
        pass
    except Exception as error:
        raise InvalidWasm('generic Wasmtime validation failed: ' + str(error)[:180]) from error
    try:
        import brotli
        if len(data) <= 256 * 1024:
            out['brotliQuality11Bytes'] = len(brotli.compress(data, quality=11))
        else:
            out['brotliQuality11Bytes'] = None
            out['compressionSkipped'] = 'already exceeds default decompressed Stylus budget'
    except ImportError:
        out['brotliQuality11Bytes'] = None
    return out


def assess(result, profile='stylus_v3_arbos60'):
    reasons = []
    features = result['features']
    if profile == 'stylus_v3_arbos60':
        max_module, max_initial = 256 * 1024, 128
        forbidden = ['simd', 'relaxedSIMD', 'atomics', 'sharedMemory', 'memory64', 'tailCalls', 'referenceTypes']
        imports = {'vm_hooks'}
        if result['brotliQuality11Bytes'] is None:
            reasons.append('Brotli size unmeasured')
        elif result['brotliQuality11Bytes'] > 96 * 1024:
            reasons.append('Brotli bytes exceed default four-fragment 96KiB budget')
        if result['functionBodies'] > 4096: reasons.append('more than4096 user function bodies')
        if result['exportCount'] > 1024: reasons.append('more than1024 user exports')
        if len(result['imports']) > 513: reasons.append('more than513 user imports')
        if not result['hasStylusEntrypoint']:
            reasons.append('missing Stylus user_entrypoint function export')
    elif profile == 'large_runtime_target':
        # This is a conservative design target, not an implemented VM or activated chain.
        max_module, max_initial = 4 * 1024 * 1024, 4096
        forbidden = ['simd', 'relaxedSIMD', 'atomics', 'sharedMemory', 'memory64', 'floats', 'tailCalls', 'referenceTypes']
        imports = {'gh0st_state'}
    else:
        raise ValueError('unknown capability profile')
    if result['moduleBytes'] > max_module: reasons.append('module exceeds profile size budget; page model weights separately')
    if len(result['memories']) > 1: reasons.append('multiple memories unsupported')
    for memory in result['memories']:
        if memory['minimumPages'] > max_initial: reasons.append('initial linear memory exceeds profile compiler budget')
    for feature in forbidden:
        if features[feature]: reasons.append('unsupported feature: ' + feature)
    for imp in result['imports']:
        if imp['module'] not in imports:
            reasons.append('unsupported host import: ' + imp['module'] + '.' + imp['name'])
    return {'profile': profile, 'profileConstraintsMet': not reasons,
            'deploymentReady': False, 'reasons': reasons,
            'limitScope': 'initial memory bound; not a universal runtime memory cap',
            'largeRuntimeImplemented': False,
            'notValidated': ['Nitro activation/instrumentation', 'Stylus ABI/types beyond entrypoint',
                             'gas and ink safety', 'matching replay/fraud prover', 'model quality and scale']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wasm', type=Path)
    parser.add_argument('--profile', choices=['stylus_v3_arbos60', 'large_runtime_target'], default='stylus_v3_arbos60')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    try:
        result = inspect(args.wasm.read_bytes())
        report = {'inspection': result, 'assessment': assess(result, args.profile)}
    except (InvalidWasm, OSError) as error:
        report = {'assessment': {'profileConstraintsMet': False, 'deploymentReady': False,
                                 'reasons': [str(error)]}}
    output = json.dumps(report, indent=2) + '\n'
    if args.out: args.out.write_text(output)
    if args.out:
        print(json.dumps({'out': str(args.out), 'sha256': report.get('inspection', {}).get('sha256'),
                          'assessment': report['assessment']}, indent=2))
    else:
        print(output, end='')
    raise SystemExit(0 if report['assessment']['profileConstraintsMet'] else 2)
