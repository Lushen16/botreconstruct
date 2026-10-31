import json
import io
import struct
from contextlib import redirect_stdout, redirect_stderr
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import scan_creatures as scanner


class CreatureStreamTests(unittest.TestCase):
    def test_confirmed_defaults_decode_unsigned_id_hp_and_attack_flags(self):
        layout = scanner.Layout()
        self.assertEqual((layout.id_offset, layout.hp_offset, layout.canattack_offset),
                         (0x5C, 0xC0, 0xC4))
        for ident in (0x4000800A, 0x40002A19, 0xFFFFFFFF):
            for hp in (0, 100):
                for flag in (0, 1, 2):
                    with self.subTest(ident=ident, hp=hp, flag=flag):
                        data = bytearray(0x200)
                        struct.pack_into('<I', data, 0x5C, ident)
                        struct.pack_into('<iih', data, 0x30, 101, 100, 7)
                        data[0x80:0x87] = b'Oddish\x00'
                        data[0xC0] = hp
                        data[0xC4] = flag
                        candidate = scanner.extract_candidate(
                            bytes(data), 0, 4096, layout, scanner.Filters(), {}, 'name')
                        self.assertIsNotNone(candidate)
                        self.assertEqual(candidate['id'], ident)
                        self.assertEqual(candidate['healthPercent'], hp)
                        self.assertIs(candidate['canAttack'], flag > 0)

    def test_cli_defaults_and_overrides_reach_scanner(self):
        for arguments, expected in (([], (0x5C, 0xC0, 0xC4)),
                (['--id-offset', '0x20', '--hp-offset', '0x28',
                  '--canattack-offset', '0x2c'], (0x20, 0x28, 0x2C))):
            with self.subTest(arguments=arguments), \
                    patch.object(scanner.k32, 'OpenProcess', return_value=1), \
                    patch.object(scanner.k32, 'CloseHandle'), \
                    patch.object(scanner, 'image_for_pid', return_value=scanner.IMAGE_NAME), \
                    patch.object(scanner, 'scan_process', return_value={'candidates': [],
                        'diagnostics': {'bytes_read': 0, 'limit_reached': False}}) as scan, \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(scanner.main(['--pid', '10'] + arguments), 0)
                layout = scan.call_args.args[3]
                self.assertEqual((layout.id_offset, layout.hp_offset,
                                  layout.canattack_offset), expected)

    def setUp(self):
        self.layout = scanner.Layout(id_offset=0x20, hp_offset=0x28,
                                     canattack_offset=0x2C)
        self.filters = scanner.Filters()
        self.data = scanner.make_synthetic_creature(
            self.layout, ident=7, name='Wild', x=101, y=100, z=7,
            hp=100, can_attack=True, kind=0)
        self.candidate = scanner.extract_candidate(
            self.data, 0, 4096, self.layout, self.filters, {}, 'name')

    def test_refresh_reads_fields_again_and_keeps_dead_creatures(self):
        dead = scanner.make_synthetic_creature(
            self.layout, ident=7, name='Wild', x=102, y=100, z=7,
            hp=0, can_attack=False, kind=0)
        with patch.object(scanner, 'read_mem', side_effect=lambda handle, address, size: dead[:size]):
            refreshed = scanner.refresh_candidates(
                None, {4096: self.candidate}, self.layout, self.filters)
        self.assertEqual(refreshed[4096]['id'], 7)
        self.assertEqual(refreshed[4096]['healthPercent'], 0)
        self.assertFalse(refreshed[4096]['canAttack'])
        self.assertEqual(refreshed[4096]['pos']['x'], 102)

    def test_atomic_replace_failure_keeps_previous_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            scanner.atomic_write_snapshot(output, {'sequence': 1})
            with patch.object(scanner.os, 'replace', side_effect=PermissionError):
                with self.assertRaises(PermissionError):
                    scanner.atomic_write_snapshot(output, {'sequence': 2})
            self.assertEqual(json.loads(output.read_text()), {'sequence': 1})
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_stream_reuses_discovery_and_publishes_at_200ms(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            stop = threading.Event()
            opts = scanner._Opts(max_bytes=1024, chunk_bytes=1024, overlap=128,
                                 coords_lane=False, player_name=None, player=None)
            observed = []
            write = scanner.atomic_write_snapshot

            def publish(destination, snapshot):
                write(destination, snapshot)
                observed.append((time.monotonic(), json.loads(destination.read_text())))
                if len(observed) == 4:
                    stop.set()

            with patch.object(scanner, 'scan_process', return_value={
                    'candidates': [self.candidate], 'diagnostics': {}}) as discover, \
                    patch.object(scanner, 'process_alive', return_value=True), \
                    patch.object(scanner, 'read_mem', side_effect=lambda handle, address, size: self.data[:size]), \
                    patch.object(scanner, 'atomic_write_snapshot', side_effect=publish):
                scanner.stream_process(None, 10, 'fixture', self.layout, self.filters,
                                       opts, output, 200, 10000, stop)
            self.assertEqual(discover.call_count, 1)
            self.assertEqual(len(observed), 4)
            for previous, current in zip(observed, observed[1:]):
                self.assertGreaterEqual(current[0] - previous[0], 0.17)
                self.assertLess(current[0] - previous[0], 0.5)
            creature = observed[-1][1]['creatures'][0]
            self.assertEqual(creature['id'], 7)
            self.assertEqual(creature['hp'], 100)
            self.assertEqual(creature['position'], creature['pos'])
            self.assertEqual(observed[-1][1]['stream']['sequence'], 4)

    def test_one_writer_per_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            with scanner.stream_output_lock(output):
                with self.assertRaises(RuntimeError):
                    with scanner.stream_output_lock(output):
                        self.fail('second writer acquired output')
            with scanner.stream_output_lock(output):
                pass

    def test_process_exit_publishes_error_and_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            opts = scanner._Opts(chunk_bytes=1024, player_name=None, player=None)
            with patch.object(scanner, 'process_alive', return_value=False), \
                    patch.object(scanner, 'scan_process', return_value={
                        'candidates': [], 'diagnostics': {}}):
                scanner.stream_process(None, 10, 'fixture', self.layout, self.filters,
                                       opts, output)
            self.assertIn('exited', json.loads(output.read_text())['error'])

    def test_pending_discovery_never_publishes_authoritative_empty_list(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            stop = threading.Event()
            opts = scanner._Opts(chunk_bytes=1024, player_name=None, player=None)
            write = scanner.atomic_write_snapshot

            def discover(*arguments):
                stop.wait()
                return {'candidates': [], 'diagnostics': {}}

            def publish(destination, snapshot):
                write(destination, snapshot)
                stop.set()

            with patch.object(scanner, 'process_alive', return_value=True), \
                    patch.object(scanner, 'scan_process', side_effect=discover), \
                    patch.object(scanner, 'atomic_write_snapshot', side_effect=publish):
                scanner.stream_process(None, 10, 'fixture', self.layout, self.filters,
                                       opts, output, stop=stop)
            snapshot = json.loads(output.read_text())
            self.assertTrue(snapshot['diagnostics']['discovery_pending'])
            self.assertIn('pending', snapshot['error'])

    def test_concurrent_readers_only_observe_complete_atomic_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'live-creatures.json'
            scanner.atomic_write_snapshot(output, {'sequence': 0, 'payload': 'x' * 8192})
            finished = threading.Event()
            failures = []

            def publish():
                try:
                    for sequence in range(1, 101):
                        scanner.atomic_write_snapshot(output, {'sequence': sequence, 'payload': 'x' * 8192})
                except Exception as error:
                    failures.append(error)
                finally:
                    finished.set()

            worker = threading.Thread(target=publish)
            worker.start()
            try:
                while not finished.wait(0.001):
                    try:
                        snapshot = json.loads(output.read_text())
                    except PermissionError:
                        continue
                    self.assertEqual(snapshot['payload'], 'x' * 8192)
                    self.assertIn(snapshot['sequence'], range(101))
            finally:
                worker.join()
            self.assertEqual(failures, [])
            self.assertEqual(json.loads(output.read_text())['sequence'], 100)


if __name__ == '__main__':
    unittest.main()
