"""Adaptación acotada de reCognizer 8a002c4 (GPL-3.0) para CPU del VPS.

Conserva el solver y su validación; solo carga YOLO para las clases soportadas.
Los desafíos de otras clases se omiten con el límite de reintentos original.
Fuente: https://github.com/Vinyzu/recognizer
"""
import argparse
import importlib.util
from pathlib import Path


def prepare(root):
    path = root / 'components' / 'detector.py'
    source = path.read_text()
    replacements = {
        'set_num_threads(5)': 'set_num_threads(2)',
        'YOLO("yolo11m-seg.pt")': 'YOLO("yolo11n-seg.pt")',
        '            assert self.seg_model\n': '',
        '            assert self.vit_model\n': '',
        '        label = self.challenge_alias[label]\n':
            '        label = self.challenge_alias[label]\n'
            '        if label not in self.yolo_detector.yolo_alias:\n'
            '            return [], []\n',
    }
    for method in ['_load_vit_model', '_load_vit_processor', '_load_seg_model', '_load_seg_processor']:
        replacements[f'            self.loading_futures.append(self.executor.submit(self.{method}))\n'] = ''
    for old, new in replacements.items():
        if source.count(old) != 1:
            raise RuntimeError('La dependencia cambió; revisar la adaptación antes de construir.')
        source = source.replace(old, new)
    path.write_text(source)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path)
    args = parser.parse_args()
    prepare(args.root or Path(importlib.util.find_spec('recognizer').origin).parent)
