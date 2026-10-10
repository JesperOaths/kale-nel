"""Wyoming protocol probe contract tests, no external services."""
import importlib.util
import pathlib
import socket
import threading
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / "voice-pipeline-diagnostic-20261010.py"
spec = importlib.util.spec_from_file_location("voice_diag", PATH)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)

class WyomingProbeTests(unittest.TestCase):
    def test_receives_capabilities_from_info(self):
        client, server = socket.socketpair()
        def serve():
            request = server.recv(500)
            self.assertIn(b'"type":"describe"', request)
            self.assertTrue(request.endswith(b"\n"))
            server.sendall(b'{"type":"info","data":{"asr":[{"name":"mock"}]}}\n')
            server.close()
        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        with patch.object(diag.socket, "create_connection", return_value=client):
            data = diag.wyoming_describe(10300)
        thread.join(timeout=2)
        self.assertEqual(data["response_type"], "info")
        self.assertTrue(data["responded"])
        self.assertEqual(data["capabilities"], ["asr"])

    def test_invalid_protocol_is_not_reported_healthy(self):
        client, server = socket.socketpair()
        def serve():
            server.recv(500)
            server.sendall(b'{"type":"error","data":{}}\n')
            server.close()
        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        with patch.object(diag.socket, "create_connection", return_value=client):
            data = diag.wyoming_describe(10200)
        thread.join(timeout=2)
        self.assertFalse(data["responded"])

if __name__ == "__main__":
    unittest.main()
