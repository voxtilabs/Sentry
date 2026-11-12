"""Servicio interno: cola acotada y consultas públicas en un navegador del servidor."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
from uuid import uuid4

import psutil

TOKEN = os.environ.get('VEHICLE_LOOKUP_WORKER_TOKEN', '')
DATA = Path(os.environ.get('VEHICLE_LOOKUP_DATA', '/data'))
PENDING = queue.Queue(maxsize=8)
LOCK = threading.RLock()
RESULTS = {}
PLATE = re.compile(r'(?:[A-Z]{4}[0-9]{2}|[A-Z]{2}[0-9]{4}|[A-Z]{3}[0-9]{2,3})')


def snapshot(item):
    return {key: value for key, value in item.items() if key != 'updated'}


def run_lookup(plate):
    output = DATA / 'results' / f'{uuid4()}.json'
    env = {key: value for key, value in os.environ.items() if key != 'VEHICLE_LOOKUP_WORKER_TOKEN'}
    command = ['python', '/app/lookup.py', '--plate', plate, '--cache-dir', str(DATA),
               '--output', str(output), '--timeout', '150']
    process = subprocess.Popen(command, cwd=DATA, env=env, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        process.wait(timeout=210)
        if process.returncode != 0 or not output.exists() or output.stat().st_size > 16384:
            return None
        result = json.loads(output.read_text())
        if result.get('plate') != plate:
            return None
        return result
    except (subprocess.TimeoutExpired, ValueError, OSError):
        try:
            children = psutil.Process(process.pid).children(recursive=True)
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.Error:
                    pass
            process.kill()
            process.wait(timeout=5)
        except (psutil.Error, OSError, subprocess.TimeoutExpired):
            pass
        return None
    finally:
        output.unlink(missing_ok=True)


def worker():
    while True:
        plate = PENDING.get()
        try:
            with LOCK:
                RESULTS[plate].update(state='running', updated=time.monotonic())
            result = run_lookup(plate)
            with LOCK:
                RESULTS[plate] = {'plate': plate, 'state': 'completed', 'result': result,
                                  'updated': time.monotonic()}
        except Exception:
            with LOCK:
                RESULTS[plate] = {'plate': plate, 'state': 'completed', 'result': None,
                                  'updated': time.monotonic()}
        finally:
            PENDING.task_done()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # No registrar patentes, cabeceras de autorización ni tokens del navegador.

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        value = self.headers.get('Authorization', '')
        return len(value) < 512 and hmac.compare_digest(value.encode(), f'Bearer {TOKEN}'.encode())

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ok': True})
        if not self.authorized():
            return self.reply(401, {'error': 'unauthorized'})
        plate = self.path.removeprefix('/lookups/')
        if not self.path.startswith('/lookups/') or not PLATE.fullmatch(plate):
            return self.reply(404, {'error': 'not_found'})
        with LOCK:
            item = RESULTS.get(plate)
            return self.reply(200, snapshot(item)) if item else self.reply(404, {'error': 'not_found'})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'unauthorized'})
        if self.path != '/lookups':
            return self.reply(404, {'error': 'not_found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 1 <= length <= 128:
                return self.reply(400, {'error': 'invalid_request'})
            value = json.loads(self.rfile.read(length))
            plate = value.get('plate') if isinstance(value, dict) else None
            if not isinstance(plate, str) or not PLATE.fullmatch(plate):
                return self.reply(400, {'error': 'invalid_plate'})
        except (ValueError, OSError):
            return self.reply(400, {'error': 'invalid_request'})
        with LOCK:
            now = time.monotonic()
            for key, item in list(RESULTS.items()):
                ttl = 300 if (item.get('result') or {}).get('officialResponseValidated') else 30
                if item['state'] == 'completed' and now - item['updated'] > ttl:
                    del RESULTS[key]
            if plate in RESULTS:
                item = RESULTS[plate]
                return self.reply(200 if item['state'] == 'completed' else 202, snapshot(item))
            if PENDING.full() or len(RESULTS) >= 1024:
                return self.reply(429, {'error': 'queue_full'})
            item = {'plate': plate, 'state': 'queued', 'updated': now}
            RESULTS[plate] = item
            PENDING.put_nowait(plate)
            return self.reply(202, snapshot(item))


if __name__ == '__main__':
    if len(TOKEN) < 32:
        raise SystemExit('Falta la credencial interna del servicio vehicular.')
    (DATA / 'results').mkdir(parents=True, exist_ok=True, mode=0o700)
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 8090), Handler).serve_forever()
