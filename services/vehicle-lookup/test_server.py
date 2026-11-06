import importlib.util
import json
from pathlib import Path
import queue
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('vehicle_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ServiceBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.TOKEN = 'test-only-internal-token-0123456789'
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def setUp(self):
        server.RESULTS.clear()
        server.PENDING = queue.Queue(maxsize=1)

    def request(self, path, body=None, auth=True):
        headers = {'Content-Type': 'application/json'}
        if auth:
            headers['Authorization'] = f'Bearer {server.TOKEN}'
        request = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        return response.status, json.loads(response.read())

    def test_private_lookup_requires_credential(self):
        self.assertEqual(self.request('/lookups', {'plate': 'ABCD12'}, auth=False)[0], 401)
        self.assertEqual(self.request('/lookups/ABCD12', auth=False)[0], 401)
        self.assertTrue(server.PENDING.empty())

    def test_user_cannot_supply_a_url_or_command_as_plate(self):
        for value in ['https://example.test', 'ABCD12;id', '../ABCD12', 'AAAAAA']:
            self.assertEqual(self.request('/lookups', {'plate': value})[0], 400)
        self.assertTrue(server.PENDING.empty())

    def test_concurrent_polling_does_not_enqueue_the_plate_twice(self):
        self.assertEqual(self.request('/lookups', {'plate': 'ABCD12'})[0], 202)
        self.assertEqual(self.request('/lookups', {'plate': 'ABCD12'})[0], 202)
        self.assertEqual(self.request('/lookups/ABCD12')[1]['state'], 'queued')
        self.assertEqual(server.PENDING.qsize(), 1)

    def test_failed_lookup_can_be_read_without_inventing_a_result(self):
        server.RESULTS['ABCD12'] = {'plate': 'ABCD12', 'state': 'completed', 'result': None, 'updated': time.monotonic()}
        status, result = self.request('/lookups', {'plate': 'ABCD12'})
        self.assertEqual(status, 200)
        self.assertIsNone(result['result'])
        self.assertNotIn('updated', result)

    def test_queue_limit_rejects_work_before_creating_an_orphan(self):
        self.request('/lookups', {'plate': 'ABCD12'})
        self.assertEqual(self.request('/lookups', {'plate': 'WXYZ34'})[0], 429)
        self.assertNotIn('WXYZ34', server.RESULTS)


if __name__ == '__main__':
    unittest.main()
