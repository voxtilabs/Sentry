#!/bin/sh
set -eu
cd /data
# La caché de pesos vive en el volumen, separada de las nuevas versiones del código.
python -c 'from recognizer import Detector; Detector().detection_models.check_loaded()'
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
exec xvfb-run -a -s '-screen 0 1280x1024x24' python -u /app/server.py
