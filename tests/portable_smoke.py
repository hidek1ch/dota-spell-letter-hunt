"""Test portable HTML offline; attempt file:// and report a managed-policy fallback.
Optional prerequisites: Python playwright and /usr/bin/chromium (or CHROMIUM).
Build first: npm run portable; then python3 tests/portable_smoke.py.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
entry = root / 'release' / 'START_GAME.html'
assert entry.is_file(), 'Run npm run portable first'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True,
                               args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width':1280,'height':900}, offline=True)
    page = context.new_page()
    errors, remote_requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('request', lambda request: remote_requests.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith('http://portable.invalid/') else None)
    direct_file = True
    try:
        page.goto(entry.as_uri() + '?test=1', wait_until='load')
    except Exception as error:
        if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(error):
            raise
        direct_file = False
        print('NOTE: managed browser policy blocks file://; verifying the same standalone HTML in memory, not claiming a direct-file check.')
        # Intercept this reserved test URL: the response is the exact portable HTML
        # from disk, supplied from memory, with the browser still offline. No server runs.
        context.route('http://portable.invalid/**', lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=entry.read_text()))
        page.goto('http://portable.invalid/?test=1', wait_until='load')
        remote_requests.clear()
    page.wait_for_function('window.__seal !== undefined')
    assert page.get_by_role('heading', name='НАСЛЕДИЕ ПЕЧАТИ').is_visible()
    page.get_by_role('button', name='Начать путь').click()
    assert page.evaluate('window.__seal.snapshot().mode') == 'training'
    before = page.evaluate('window.__seal.snapshot().player.y')
    page.keyboard.down('KeyW'); page.evaluate('window.__seal.advance(.75)'); page.keyboard.up('KeyW')
    assert page.evaluate('window.__seal.snapshot().player.y') < before - 50
    page.keyboard.down('KeyJ'); page.evaluate('window.__seal.advance(1.5)'); page.keyboard.up('KeyJ')
    assert page.evaluate('window.__seal.snapshot().telemetry.comboSteps.every(count => count > 0)')
    page.keyboard.press('KeyQ'); page.evaluate('window.__seal.advance(.8)')
    page.keyboard.press('Space'); page.evaluate('window.__seal.advance(.1)')
    assert page.evaluate('window.__seal.snapshot().telemetry.dragonCasts') > 0
    assert page.evaluate('window.__seal.snapshot().telemetry.dodges') > 0
    page.evaluate('window.__seal.beginBoss()')
    page.keyboard.press('KeyL'); page.evaluate('window.__seal.advance(.8)')
    assert page.evaluate('window.__seal.snapshot().telemetry.sealCasts') == 1
    assert page.evaluate('window.__seal.snapshot().telemetry.damageDealt') > 0
    assert not errors, errors
    assert not remote_requests, remote_requests
    (root / 'artifacts').mkdir(exist_ok=True)
    page.screenshot(path=str(root / 'artifacts' / 'portable-offline.png'))
    print(('PASS: file:// launch' if direct_file else 'PASS: standalone in-memory HTML') + ', menu, movement, combo3, dragon, dodge, ring damage; no external assets or console errors.')
    browser.close()
