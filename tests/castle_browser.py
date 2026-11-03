"""Real browser regression for the two connected castle locations.

Run after npm run build and npm run preview -- --port 4180:
  SEAL_URL=http://127.0.0.1:4180/dota-spell-letter-hunt python3 tests/castle_browser.py
Requires Python Playwright and Chromium. No player-position fixtures are used.
"""
import math
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


URL = os.environ.get('SEAL_URL', 'http://127.0.0.1:4180/dota-spell-letter-hunt').rstrip('/')
ARTIFACTS = Path('artifacts')
SPEED = 190


def snapshot(page):
    return page.evaluate('window.__castle.snapshot()')


def advance(page, seconds):
    page.evaluate('(seconds) => window.__castle.advance(seconds)', seconds)


def move(page, keys, seconds):
    if isinstance(keys, str):
        keys = [keys]
    for key in keys:
        page.keyboard.down(key)
    # Release within the same JavaScript task as the deterministic update. The
    # real browser key-up below still runs, while slow protocol round trips can
    # no longer add several uncontrolled movement frames before it arrives.
    page.evaluate('''({seconds, keys}) => {
        window.__castle.advance(seconds);
        for (const code of keys) window.dispatchEvent(new KeyboardEvent('keyup', {code, bubbles:true}));
    }''', {'seconds': seconds, 'keys': keys})
    for key in reversed(keys):
        page.keyboard.up(key)
    return snapshot(page)


def move_to(page, axis, target):
    """Navigate by real key holds, using observed coordinates only to stop."""
    key_pairs = {'x': ('ArrowLeft', 'ArrowRight'), 'y': ('ArrowUp', 'ArrowDown')}
    for _ in range(3):
        difference = target - snapshot(page)['player'][axis]
        if abs(difference) <= 4:
            return snapshot(page)
        key = key_pairs[axis][difference > 0]
        page.keyboard.down(key)
        page.evaluate('''({axis,target,key,speed,direction}) => {
            const difference = target - window.__castle.snapshot().player[axis];
            if (Math.sign(difference) === direction) window.__castle.advance(Math.abs(difference) / speed);
            window.dispatchEvent(new KeyboardEvent('keyup', {code:key, bubbles:true}));
        }''', {'axis': axis, 'target': target, 'key': key, 'speed': SPEED, 'direction': 1 if difference > 0 else -1})
        page.keyboard.up(key)
        result = snapshot(page)
    assert abs(result['player'][axis] - target) <= 7, (axis, target, result)
    return result


def assert_camera(state):
    camera = state['camera']
    assert -1 <= camera['x'] <= state['width'] - camera['width'] + 1, state
    assert -1 <= camera['y'] <= state['height'] - camera['height'] + 1, state
    assert state['scenes'] == [state['location']], state['scenes']


def wait_location(page, location):
    page.wait_for_function(
        '(location) => window.__castle?.snapshot().location === location && window.__castle.snapshot().active',
        arg=location,
    )
    state = snapshot(page)
    assert not state['busy'] and not state['fade']['running'], state
    assert_camera(state)
    return state


def enter_castle(page):
    page.goto(URL + '/?test=1', wait_until='networkidle')
    page.get_by_role('button', name='Исследовать замок').click()
    return wait_location(page, 'CastleCourtyard')


def assert_session(state):
    assert state['health'] == 73, state
    assert state['inventory'] == ['Учебный меч'], state


def hold_transition(page, target, image_name):
    page.keyboard.down('KeyE')
    page.wait_for_function('window.__castle.snapshot().busy')
    before = snapshot(page)
    assert before['fade']['running'], before
    page.screenshot(path=str(ARTIFACTS / image_name))
    state = wait_location(page, target)
    # A fresh Input must reject the operating system's repeat event for held E.
    page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyE', key:'e', repeat:true, bubbles:true}))")
    advance(page, .8)
    page.wait_for_timeout(350)
    assert snapshot(page)['location'] == target and snapshot(page)['active'], snapshot(page)
    page.keyboard.up('KeyE')
    assert_session(state)
    return state


def touch(cdp, kind, points):
    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})


def touch_point(locator, identifier=1):
    bounds = locator.bounding_box()
    assert bounds, locator
    return {'x': bounds['x'] + bounds['width'] / 2, 'y': bounds['y'] + bounds['height'] / 2, 'id': identifier}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
        headless=True,
        args=['--no-sandbox', '--disable-dev-shm-usage'],
    )
    ARTIFACTS.mkdir(exist_ok=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    for event_page in [page]:
        event_page.on('pageerror', lambda error: errors.append(str(error)))
        event_page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    state = enter_castle(page)
    assert state['width'] == 1920 and state['height'] == 1280, state
    assert abs(state['player']['x'] - 960) < 1 and abs(state['player']['y'] - 640) < 1, state
    assert page.locator('.castle-location-title').inner_text() == 'Тренировочный двор'
    page.screenshot(path=str(ARTIFACTS / 'castle-courtyard.png'))

    # Straight and diagonal directions must cover equal total distances.
    start = snapshot(page)['player']
    straight = move(page, 'ArrowDown', .4)['player']
    distance_straight = math.hypot(straight['x'] - start['x'], straight['y'] - start['y'])
    diagonal = move(page, ['ArrowDown', 'ArrowRight'], .4)['player']
    distance_diagonal = math.hypot(diagonal['x'] - straight['x'], diagonal['y'] - straight['y'])
    assert abs(distance_diagonal - distance_straight) < 8, (distance_straight, distance_diagonal)
    move_to(page, 'x', 960)
    move_to(page, 'y', 640)

    # The well is an actual circle-vs-rectangle obstacle, not just decorative art.
    well = move(page, 'ArrowLeft', 2)
    assert abs(well['player']['x'] - 762) < 2 and abs(well['player']['y'] - 640) < 7, well
    more = move(page, 'ArrowLeft', .7)
    assert abs(more['player']['x'] - well['player']['x']) < .01, more
    assert_camera(more)
    move_to(page, 'x', 1060)
    page.keyboard.press('KeyE')
    advance(page, .05)
    assert 'Не оставляй мечи во дворе' in page.locator('.castle-message').inner_text()
    assert 'Поговорить' in snapshot(page)['prompt']

    page.keyboard.down('KeyM')
    advance(page, .05)
    assert snapshot(page)['mapOpen']
    page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyM', repeat:true, bubbles:true}))")
    advance(page, .1)
    assert snapshot(page)['mapOpen'], 'Held M repeated the toggle'
    page.keyboard.up('KeyM')
    map_before = page.locator('.castle-map canvas').evaluate('(canvas) => canvas.toDataURL()')
    move(page, 'ArrowDown', .25)
    map_after = page.locator('.castle-map canvas').evaluate('(canvas) => canvas.toDataURL()')
    assert map_before != map_after, 'Player/camera marker did not update on map'
    page.screenshot(path=str(ARTIFACTS / 'castle-map.png'))
    page.keyboard.press('KeyM')
    advance(page, .05)
    assert not snapshot(page)['mapOpen']
    print('PASS: desktop movement is normalized; well blocks movement; NPC speaks; M edges and live map work.')

    # Only persistent session data is changed. Positions always use real controls.
    page.evaluate("Object.assign(window.__castle.session(), {health:73, inventory:['Учебный меч']})")
    move_to(page, 'x', 960)
    move_to(page, 'y', 140)
    assert 'оружейную' in snapshot(page)['prompt']
    page.wait_for_timeout(400)
    assert snapshot(page)['location'] == 'CastleCourtyard', 'Door transitioned without interaction'
    assert_camera(snapshot(page))
    page.screenshot(path=str(ARTIFACTS / 'castle-door-prompt.png'))
    state = hold_transition(page, 'CastleArmory', 'castle-fade-out.png')
    assert abs(state['player']['x'] - 640) < 1 and abs(state['player']['y'] - 820) < 1, state
    assert state['width'] == 1280 and state['height'] == 960, state
    assert state['visited'] == ['CastleCourtyard', 'CastleArmory'], state
    assert '73 /' in page.locator('.castle-health-value').inner_text()
    assert page.locator('.castle-inventory-items').inner_text() == 'Учебный меч'
    page.screenshot(path=str(ARTIFACTS / 'castle-armory.png'))

    bench = move(page, 'ArrowUp', 2)
    assert abs(bench['player']['y'] - 606) < 1, bench
    move_to(page, 'x', 780)
    move_to(page, 'y', 400)
    assert_camera(snapshot(page))
    north_wall = move(page, 'ArrowUp', 3)
    assert abs(north_wall['player']['y'] - 92) < 1, north_wall
    east_wall = move(page, 'ArrowRight', 4)
    assert abs(east_wall['player']['x'] - 1204) < 1, east_wall
    assert_camera(east_wall)
    page.screenshot(path=str(ARTIFACTS / 'castle-armory-camera-edge.png'))
    move_to(page, 'x', 780)
    move_to(page, 'y', 820)
    move_to(page, 'x', 640)
    assert 'Вернуться' in snapshot(page)['prompt']
    page.wait_for_timeout(300)
    assert snapshot(page)['location'] == 'CastleArmory'
    state = hold_transition(page, 'CastleCourtyard', 'castle-return-fade.png')
    assert abs(state['player']['x'] - 960) < 1 and abs(state['player']['y'] - 160) < 1, state
    assert state['visited'] == ['CastleCourtyard', 'CastleArmory'], state
    page.keyboard.press('Escape')
    advance(page, .05)
    assert snapshot(page)['paused']
    before_pause = snapshot(page)['player']
    move(page, 'ArrowDown', .5)
    assert snapshot(page)['player'] == before_pause
    page.get_by_role('button', name='Продолжить', exact=True).click()
    assert not snapshot(page)['paused']
    page.locator('.castle-menu').click()
    assert page.get_by_role('button', name='Начать путь').is_visible()
    assert page.get_by_role('button', name='Сразу к печати').is_visible()
    print('PASS: E-only doors fade both ways, held E does not bounce, HP/inventory persist, furniture/walls and camera bounds work.')

    # A separate mobile context uses real multi-touch input rather than keyboard.
    context = browser.new_context(viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True, device_scale_factor=1)
    mobile = context.new_page()
    mobile.on('pageerror', lambda error: errors.append(str(error)))
    mobile.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    enter_castle(mobile)
    assert mobile.locator('#touch-controls').get_attribute('data-mode') == 'exploration'
    assert mobile.locator('.touch-stick').is_visible()
    assert mobile.locator('.touch-interact').is_visible()
    assert mobile.locator('.touch-map').is_visible()
    assert mobile.locator('.touch-pause').is_visible()
    assert not mobile.locator('.touch-attack').is_visible()
    assert not mobile.locator('.touch-actions').is_visible()
    cdp = context.new_cdp_session(mobile)
    map_point = touch_point(mobile.locator('.touch-map'))
    touch(cdp, 'touchStart', [map_point])
    advance(mobile, .05)
    assert snapshot(mobile)['mapOpen']
    advance(mobile, .5)
    assert snapshot(mobile)['mapOpen'], 'Held mobile map button toggled repeatedly'
    touch(cdp, 'touchEnd', [])
    touch(cdp, 'touchStart', [map_point])
    advance(mobile, .05)
    touch(cdp, 'touchEnd', [])
    assert not snapshot(mobile)['mapOpen']
    stick = touch_point(mobile.locator('.touch-stick'))
    touch(cdp, 'touchStart', [stick])
    north = dict(stick, y=stick['y'] - 36)
    touch(cdp, 'touchMove', [north])
    advance(mobile, 2.6)
    touch(cdp, 'touchEnd', [])
    state = snapshot(mobile)
    assert state['player']['y'] < 190 and 'оружейную' in state['prompt'], state
    assert state['location'] == 'CastleCourtyard'
    mobile.screenshot(path=str(ARTIFACTS / 'castle-mobile-courtyard.png'))
    interact = touch_point(mobile.locator('.touch-interact'))
    touch(cdp, 'touchStart', [interact])
    wait_location(mobile, 'CastleArmory')
    advance(mobile, .8)
    assert snapshot(mobile)['location'] == 'CastleArmory', 'Held mobile E bounced to previous scene'
    touch(cdp, 'touchEnd', [])
    assert_camera(snapshot(mobile))
    mobile.screenshot(path=str(ARTIFACTS / 'castle-mobile-armory.png'))
    interact = touch_point(mobile.locator('.touch-interact'))
    touch(cdp, 'touchStart', [interact])
    touch(cdp, 'touchEnd', [])
    wait_location(mobile, 'CastleCourtyard')
    assert_camera(snapshot(mobile))
    pause = touch_point(mobile.locator('.touch-pause'))
    touch(cdp, 'touchStart', [pause]); touch(cdp, 'touchEnd', [])
    advance(mobile, .05)
    assert snapshot(mobile)['paused']
    mobile.get_by_role('button', name='Продолжить', exact=True).tap()
    assert not snapshot(mobile)['paused']
    print('PASS: 844×390 touch exploration uses joystick/E/M/pause only; joystick reaches door and touch E travels both ways.')
    assert not errors, errors
    context.close()
    browser.close()
    print('PASS: no JavaScript errors; castle screenshots saved in artifacts/.')
