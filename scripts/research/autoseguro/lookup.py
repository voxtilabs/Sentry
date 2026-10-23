#!/usr/bin/env python3
"""Prueba local de Auto Seguro; no forma parte del servidor de producción."""

import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlparse


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plate', required=True)
    parser.add_argument('--browser-executable')
    parser.add_argument('--cache-dir', type=Path, default=Path.home() / '.cache/sentrycore-vehicle-research')
    parser.add_argument('--output', type=Path, required=True, help='Informe JSON privado; no se imprime la patente en logs.')
    parser.add_argument('--timeout', type=int, default=150)
    args = parser.parse_args()
    args.plate = re.sub(r'[\s.-]', '', args.plate.upper())
    if not re.fullmatch(r'(?:[A-Z]{4}[0-9]{2}|[A-Z]{2}[0-9]{4}|[A-Z]{3}[0-9]{2,3})', args.plate):
        parser.error('Formato de patente no válido.')
    if not 30 <= args.timeout <= 180:
        parser.error('El tiempo máximo debe estar entre 30 y 180 segundos.')
    return args


async def consult(args):
    args.cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ['HF_HOME'] = str(args.cache_dir / 'model-cache/huggingface')
    os.environ['TORCH_HOME'] = str(args.cache_dir / 'model-cache/torch')
    os.environ['YOLO_CONFIG_DIR'] = str(args.cache_dir / 'model-cache/ultralytics')
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    from patchright.async_api import async_playwright
    from recognizer.agents.playwright import AsyncChallenger

    report = {
        'plate': args.plate, 'source': 'Auto Seguro (consulta pública automática de prueba)',
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'stolenStatus': 'no_consultado', 'tokenIssued': False,
        'formSubmitted': False, 'officialResponseValidated': False,
    }
    started = time.monotonic()
    async with async_playwright() as p:
        launch = {'headless': False, 'no_viewport': True, 'locale': 'en-US'}
        if args.browser_executable:
            launch['executable_path'] = args.browser_executable
        context = await p.chromium.launch_persistent_context(str(args.cache_dir / 'profile'), **launch)
        page = context.pages[0] if context.pages else await context.new_page()
        page.set_default_timeout(15000)
        try:
            challenger = AsyncChallenger(page, click_timeout=400, retry_times=6, optimize_click_order=False)
            # Cargar antes de abrir el desafío para que el primer arranque no agote
            # su vigencia. Los modelos se ejecutan en CPU, sin API de pago.
            challenger.detector.detection_models.check_loaded()

            async def response_token():
                field = page.locator('textarea[name="g-recaptcha-response"]').first
                return await field.input_value() if await field.count() else ''

            # Patchright usa un contexto JS aislado: los globals de la página no
            # están ahí. El textarea compartido contiene el token real de Google.
            challenger.check_result = response_token
            challenger.routed_page = True

            async def observe(response):
                parsed = urlparse(response.url)
                if parsed.hostname not in ('www.google.com', 'www.recaptcha.net'):
                    return
                if '/recaptcha/' in parsed.path and parsed.path.endswith('/reload'):
                    try:
                        challenger.dynamic = 'dynamic' in await response.text()
                    except Exception:
                        pass

            page.on('response', observe)

            async def lookup():
                response = await page.goto('https://www.autoseguro.gob.cl/', wait_until='domcontentloaded', timeout=30000)
                if response.status != 200:
                    raise RuntimeError('provider_unavailable')
                await page.locator('#txt_placa_patente').fill(args.plate)
                await challenger.solve_recaptcha()
                report['tokenIssued'] = bool(await response_token())
                if not report['tokenIssued']:
                    return
                # Formulario real con su propia sesión, CSRF y token; sin sustituir
                # la página, fabricar tokens ni enviar respuestas inventadas.
                async with page.expect_navigation(wait_until='domcontentloaded', timeout=30000):
                    await page.locator('#frmCaptcha').evaluate('(form) => form.requestSubmit()')
                report['formSubmitted'] = True
                if urlparse(page.url).hostname != 'www.autoseguro.gob.cl':
                    return
                result = await page.evaluate('''(plate) => {
                  const searched = String(window.valor_s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                  if (window.IsResponse !== true || window.response?.Cod !== 0 ||
                      String(window.tipo_s) !== '1' || searched !== plate) return null;
                  const r = window.response.Result;
                  if (!r || !Object.prototype.hasOwnProperty.call(r, 'CodTipoEncargo')) return null;
                  let status = 'no_consultado';
                  if (r.CodTipoEncargo === 0) status = 'sin_encargo';
                  else if (r.CodTipoEncargo === 1 && Array.isArray(r.Especies) &&
                           r.Especies.length && Number(r.EUN) > 0 &&
                           typeof window.evaluarConsultaVehiculoDesdeEspecies === 'function') {
                    const value = window.evaluarConsultaVehiculoDesdeEspecies(r.Especies, r.EUN).resultado;
                    if (value === 'Sin encargo') status = 'sin_encargo';
                    else if (value === 'Encargo parcial') status = 'encargo_parcial';
                    else if (value === 'Encargo policial vigente') status = 'con_encargo';
                  }
                  return {status};
                }''', args.plate, isolated_context=False)
                if result and result['status'] in ('sin_encargo', 'con_encargo', 'encargo_parcial'):
                    report['stolenStatus'] = result['status']
                    report['officialResponseValidated'] = True
                    report['checkedAt'] = datetime.now(timezone.utc).isoformat()

            await asyncio.wait_for(lookup(), timeout=args.timeout)
        except Exception as error:
            # No incluir mensajes del navegador: pueden contener URL o tokens.
            report['errorType'] = type(error).__name__
        finally:
            report['elapsedSeconds'] = round(time.monotonic() - started, 2)
            report['attemptCounter'] = challenger.retried if 'challenger' in locals() else 0
            await context.close()
    return report


def main():
    args = arguments()
    report = asyncio.run(consult(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print('Consulta finalizada. Resultado guardado en el archivo privado indicado.')


if __name__ == '__main__':
    main()
