import gzip
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

src = Path(__file__).with_name('battery-history-retention-v1.py')
spec = importlib.util.spec_from_file_location('retention', src)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def case(self):
        return tempfile.TemporaryDirectory(
            dir=Path(__file__).parent)

    def test_recent_samples_and_archive(self):
        with self.case() as d:
            p = Path(d)/'samples.jsonl'
            original = b''.join(('{"role":"new","ts":%s}\n' % i).encode() for i in range(70))
            p.write_bytes(original)
            self.assertEqual(m.compact(p, cap=700, keep=25), 'compacted_with_verified_archive')
            self.assertEqual(p.read_bytes(), b''.join(original.splitlines(keepends=True)[-25:]))
            with gzip.open(str(p)+'.1.gz','rb') as f:
                self.assertEqual(f.read(), original)
            self.assertEqual(m.compact(p, cap=700, keep=25), 'in_bound')

    def test_symlink_no_mutation(self):
        with self.case() as d:
            p=Path(d)/'file'; p.write_bytes(b'x'*300)
            link=Path(d)/'link'; link.symlink_to(p)
            self.assertEqual(m.compact(link,cap=100,keep=2),'absent_or_unsafe')
            self.assertEqual(p.stat().st_size,300)

    def test_hardlink_no_mutation(self):
        with self.case() as d:
            p=Path(d)/'file'; p.write_bytes(b'x'*300)
            os.link(p,Path(d)/'other')
            self.assertEqual(m.compact(p,cap=100,keep=2),'wrong_owner_or_mount')

    def test_malicious_archive_refused(self):
        with self.case() as d:
            p=Path(d)/'file'; p.write_bytes(b'one\ntwo\nthree\nfour\n')
            q=Path(d)/'untouched'; q.write_text('sentinel')
            Path(str(p)+'.1.gz').symlink_to(q)
            self.assertEqual(m.compact(p,cap=6,keep=2),'unsafe_prior_archive')
            self.assertEqual(q.read_text(),'sentinel')

    def test_guard_no_trim_when_recent_alone_over_cap(self):
        with self.case() as d:
            p=Path(d)/'file'; raw=b''.join([b'X'*300+b'\n' for _ in range(10)]); p.write_bytes(raw)
            self.assertEqual(m.compact(p,cap=1000,keep=5),'recent_samples_exceed_cap')
            self.assertEqual(p.read_bytes(),raw)

if __name__=='__main__':
    unittest.main(verbosity=2)
