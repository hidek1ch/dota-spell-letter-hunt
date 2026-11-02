"""Regressions for real click edges, combo reset, menu settings and the ring.
Run against a built preview: SEAL_URL=http://127.0.0.1:4175/dota-spell-letter-hunt python3 tests/player_flow.py.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL=os.environ.get('SEAL_URL','http://127.0.0.1:4175/dota-spell-letter-hunt').rstrip('/')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1440,'height':1000})
 errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
 page.goto(URL+'/?test=1',wait_until='networkidle')
 page.wait_for_function('window.__seal !== undefined')
 page.locator('#timer').select_option('demo');page.locator('#difficulty').select_option('hard')
 page.get_by_role('button',name='Начать путь').click()
 assert page.locator('#timer-value').inner_text()=='02:30'
 assert 'ПЕПЕЛ' in page.locator('#time-panel').inner_text()
 # Isolate physical input from enemy hit-stun; real enemy combat is covered by browser_smoke.py.
 page.evaluate('window.__seal.world().enemies.forEach(enemy=>enemy.hp=0)')
 page.evaluate('window.__seal.advance(.1)')
 assert not page.evaluate('window.__seal.snapshot().ringEnabled')
 assert 'после арки' in page.locator('#link').inner_text().lower()
 canvas=page.locator('canvas').bounding_box()
 aim_x=canvas['x']+600*canvas['width']/960;aim_y=canvas['y']+470*canvas['height']/640
 def telemetry():return page.evaluate('window.__seal.snapshot().telemetry')
 def strikes():return sum(telemetry()['comboSteps'])
 # The original two-strike defect is reproduced by holding a single real mouse press.
 before=strikes();page.mouse.move(aim_x,aim_y);page.mouse.down();page.evaluate('window.__seal.advance(1.5)')
 assert strikes()==before+1,telemetry()
 page.mouse.up();page.evaluate('window.__seal.advance(.7)')
 assert strikes()==before+1,telemetry()
 # Three separate clicks produce exactly the three successive combo steps, no fourth.
 base=telemetry()['comboSteps']
 for duration in [.46,.46,.65]:
  page.mouse.click(aim_x,aim_y);page.evaluate('(seconds)=>window.__seal.advance(seconds)',duration)
 after=telemetry()['comboSteps']
 assert [a-b for a,b in zip(after,base)]==[1,1,1],telemetry()
 page.evaluate('window.__seal.advance(.8)');page.mouse.click(aim_x,aim_y);page.evaluate('window.__seal.advance(.45)')
 reset=telemetry()['comboSteps'];assert reset[0]==after[0]+1 and reset[1:]==after[1:],telemetry()
 # Keyboard auto-repeat and a held J must not create any extra presses.
 page.evaluate('window.__seal.advance(.8)');before=strikes();page.keyboard.down('KeyJ')
 page.evaluate("for(let i=0;i<8;i++)window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ',repeat:true}))")
 page.evaluate('window.__seal.advance(1.4)');page.keyboard.up('KeyJ')
 assert strikes()==before+1,telemetry()
 # Even two rapid click pairs before the next frame remain two edges, not four hits.
 page.evaluate('window.__seal.advance(.8)');before=strikes()
 page.evaluate('''() => {const canvas=document.querySelector('canvas');for(let i=0;i<2;i++){
  canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,clientX:700,clientY:500,bubbles:true}));
  window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0,bubbles:true}));
 }}''')
 page.evaluate('window.__seal.advance(1.3)')
 assert strikes()==before+2,telemetry()
 assert telemetry()['acceptedSwordInputs']==strikes(),telemetry()
 print('PASS: mouse hold/release=1 strike, 3 clicks=combo3, idle reset, J auto-repeat=1, rapid double-click=2.')
 # New explicit shortcut still plays consent before unlocking the ring or timer.
 page.keyboard.press('Escape');page.get_by_role('button',name='В меню',exact=True).click()
 page.locator('#timer').select_option('canonical');page.locator('#difficulty').select_option('hard')
 page.get_by_role('button',name='Сразу к печати').click()
 assert page.evaluate('window.__seal.snapshot().mode')=='intro'
 page.get_by_role('button',name='Пропустить').click()
 snap=page.evaluate('window.__seal.snapshot()')
 assert snap['mode']=='boss' and snap['timeLimit']==900 and snap['difficulty']=='hard',snap
 assert snap['boss']['maxHp']==6900 and snap['ringEnabled'],snap
 assert page.locator('#timer-value').inner_text().startswith('14:') or page.locator('#timer-value').inner_text()=='15:00'
 page.keyboard.press('KeyL');page.evaluate('window.__seal.advance(.8)')
 snap=page.evaluate('window.__seal.snapshot()')
 assert snap['telemetry']['sealCasts']==1 and snap['telemetry']['damageDealt']>0,snap
 page.keyboard.press('Escape');page.evaluate('window.__seal.advance(.05)')
 remaining=page.evaluate('window.__seal.snapshot().timeLeft');page.evaluate('window.__seal.advance(3)')
 assert page.evaluate('window.__seal.snapshot().timeLeft')==remaining
 page.get_by_role('button',name='Продолжить',exact=True).click()
 Path('artifacts').mkdir(exist_ok=True);page.screenshot(path='artifacts/fixed-boss-ring.png')
 assert not errors,errors
 print('PASS: 15:00+hard selection reaches boss through consent; ring actually damages boss; pause freezes timer.')
 browser.close()
