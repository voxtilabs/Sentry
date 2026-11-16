FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    VEHICLE_LOOKUP_DATA=/data \
    HF_HOME=/data/model-cache/huggingface \
    TORCH_HOME=/data/model-cache/torch \
    YOLO_CONFIG_DIR=/data/model-cache/ultralytics \
    HF_HUB_DISABLE_TELEMETRY=1

COPY scripts/research/autoseguro/requirements.txt /app/requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends git xvfb xauth \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.6.0+cpu torchvision==0.21.0+cpu \
    && pip install --no-cache-dir -r /app/requirements.txt \
    && python -m patchright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 worker \
    && mkdir -p /data /app && chown worker:worker /data

COPY services/vehicle-lookup/prepare_light_models.py /app/prepare_light_models.py
RUN python /app/prepare_light_models.py
COPY scripts/research/autoseguro/lookup.py /app/lookup.py
COPY services/vehicle-lookup/server.py /app/server.py
COPY services/vehicle-lookup/start.sh /app/start.sh
USER worker
WORKDIR /data
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health',timeout=3)"
CMD ["sh", "/app/start.sh"]
