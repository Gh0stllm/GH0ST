import unittest
from check_wasm import inspect, assess, InvalidWasm


def u(n):
    out = bytearray()
    while n >= 128:
        out.append((n & 127) | 128); n >>= 7
    return bytes(out + bytes([n]))


def sec(i, body):
    return bytes([i]) + u(len(body)) + body


def name(text):
    value = text.encode(); return u(len(value)) + value


def module(ops=b'', memory=b'\0\1', imports=None, data=None):
    result = b'\0asm\x01\0\0\0' + sec(1, b'\1\x60\0\0')
    if imports: result += sec(2, b'\1' + name(imports[0]) + name(imports[1]) + b'\0\0')
    result += sec(3, b'\1\0') + sec(5, b'\1' + memory)
    result += sec(7, b'\1' + name('user_entrypoint') + b'\0' + u(1 if imports else 0))
    body = b'\0' + ops + b'\x0b'
    result += sec(10, b'\1' + u(len(body)) + body)
    if data is not None: result += sec(11, b'\1\0\x41\0\x0b' + u(len(data)) + data)
    return result


class FeatureTests(unittest.TestCase):
    def test_basic_integer_module_and_entrypoint(self):
        r = inspect(module(b'\x41\x02\x41\x03\x6a\x1a'))
        self.assertFalse(any(r['features'].values()))
        self.assertFalse(assess(r)['deploymentReady'])

    def test_simd_opcode_is_decoded(self):
        r = inspect(module(b'\xfd\x0c' + bytes(16) + b'\x1a'))
        self.assertTrue(r['features']['simd'])
        self.assertIn('unsupported feature: simd', assess(r)['reasons'])

    def test_opcode_bytes_in_data_are_not_simd(self):
        r = inspect(module(data=b'\xfd\xfe\x43\x44'))
        self.assertFalse(r['features']['simd'])
        self.assertFalse(r['features']['atomics'])

    def test_opcode_bytes_in_integer_immediate_are_not_simd(self):
        self.assertFalse(inspect(module(b'\x41\xfd\0\x1a'))['features']['simd'])

    def test_float_is_allowed_in_standard_profile_not_integer_target(self):
        r = inspect(module(b'\x43\0\0\0\0\x1a'))
        self.assertTrue(r['features']['floats'])
        self.assertIn('unsupported feature: floats', assess(r, 'large_runtime_target')['reasons'])
        self.assertNotIn('unsupported feature: floats', assess(r)['reasons'])

    def test_memory64_and_shared_rejected(self):
        r = inspect(module(memory=b'\x05\x01\x02'))
        self.assertTrue(r['features']['memory64'])
        shared = inspect(module(memory=b'\x03\x01\x02'))
        self.assertTrue(shared['features']['sharedMemory'])
        self.assertFalse(assess(shared)['profileConstraintsMet'])

    def test_initial_bound_is_not_universal_runtime_cap(self):
        r = inspect(module(memory=b'\x01' + u(129) + u(1024)))
        self.assertIn('initial linear memory exceeds profile compiler budget', assess(r)['reasons'])
        r = inspect(module(memory=b'\x01' + u(1) + u(1024)))
        self.assertNotIn('initial linear memory exceeds profile compiler budget', assess(r)['reasons'])

    def test_external_io_import_rejected(self):
        r = inspect(module(imports=('wasi_snapshot_preview1', 'fd_read')))
        self.assertIn('unsupported host import: wasi_snapshot_preview1.fd_read', assess(r)['reasons'])

    def test_unknown_opcode_fails_closed(self):
        with self.assertRaises(InvalidWasm): inspect(module(b'\xfb\0'))

    def test_truncation_and_duplicate_section_rejected(self):
        with self.assertRaises(InvalidWasm): inspect(module()[:-1])
        with self.assertRaises(InvalidWasm): inspect(module() + sec(5, b'\0'))

    def test_section_order_rejected(self):
        with self.assertRaises(InvalidWasm): inspect(b'\0asm\x01\0\0\0' + sec(5, b'\0') + sec(1, b'\0'))

    def test_oversized_module_rejected_even_if_data_compresses(self):
        r = inspect(module(data=bytes(256 * 1024)))
        self.assertTrue(any('module exceeds' in x for x in assess(r)['reasons']))


if __name__ == '__main__':
    unittest.main()
