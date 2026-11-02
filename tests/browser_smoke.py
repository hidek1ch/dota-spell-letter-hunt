"""Optional integration test: pip install playwright; requires local Chromium + running Vite.
Run SEAL_URL=http://127.0.0.1:5173/dota-spell-letter-hunt python3 tests/browser_smoke.py.
Only ?test=1 enables the scene harness. Honest victories use DOM keyboard/pointer events.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ARTIFACTS = Path('artifacts')
ARTIFACTS.mkdir(exist_ok=True)
URL = os.environ.get('SEAL_URL', 'http://127.0.0.1:5173/dota-spell-letter-hunt').rstrip('/')

CONTROLLER = r'''(targetMode) => {
  const api = window.__seal;
  const keys = new Set();
  function set(code, down) {
    if (keys.has(code) === down) return;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code, bubbles:true}));
    if(down) keys.add(code); else keys.delete(code);
  }
  function aim(x,y) {
    const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', {clientX:r.left+x*r.width/960,clientY:r.top+y*r.height/640,pointerType:'mouse',bubbles:true}));
  }
  let time = 0;
  while(api.snapshot().mode === targetMode && time < 155) {
    const w = api.world(), p = w.player;
    let target = targetMode==='training' ? w.enemies.filter(e=>e.hp>0).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0] : w.boss;
    if(!target || target.hp<=0) break;
    const dx=target.x-p.x,dy=target.y-p.y,d=Math.max(1,Math.hypot(dx,dy));
    const danger=target.state==='Telegraph';
    let x=d>67?dx/d:0,y=d>67?dy/d:0;
    if(danger && targetMode==='boss') {
      x=-dy/d;y=dx/d;
      if(p.x+x*125<95||p.x+x*125>865||p.y+y*125<120||p.y+y*125>540){x=-x;y=-y;}
    }
    set('KeyD',x>.36);set('KeyA',x<-.36);set('KeyS',y>.36);set('KeyW',y<-.36);
    aim(target.x,target.y);
    // Each press produces one attack; the controller deliberately taps, never holds.
    set('KeyJ',!danger&&d<100&&Math.floor(time*5)%2===0);
    // Tap cooldown abilities, preserving edge semantics instead of injecting combat input.
    const dodge=danger&&target.stateTime>target.attackWindup-.20&&p.dodgeCooldown<=0;
    set('Space',dodge);
    set('KeyQ',!danger&&p.dragonCooldown<=0&&p.energy>=32);
    set('KeyL',targetMode==='boss'&&!danger&&p.sealCooldown<=0&&p.energy>=24&&p.dragonCooldown>0);
    api.advance(1/60); time+=1/60;
  }
  for(const code of keys) set(code,false);
  return {seconds:time,snapshot:api.snapshot()};
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL+'/?test=1',wait_until='networkidle')
    page.wait_for_function('window.__seal !== undefined')
    assert page.get_by_role('heading',name='НАСЛЕДИЕ ПЕЧАТИ').is_visible()
    page.screenshot(path=str(ARTIFACTS/'01-menu.png'))
    page.locator('#timer').select_option('demo')
    page.locator('#difficulty').select_option('story')
    page.get_by_role('button',name='Управление',exact=True).click()
    assert page.get_by_role('heading',name='Искусство боя').is_visible()
    page.get_by_role('button',name='Понятно').click()
    page.get_by_role('button',name='Начать путь').click()
    page.wait_for_timeout(100)
    assert page.evaluate('window.__seal.snapshot().timeLeft') == 150
    assert page.locator('#timer-value').inner_text() == '02:30'
    assert 'СТАРТ ОТСЧЁТА' in page.locator('#seal-status').inner_text()
    page.keyboard.press('KeyL');page.evaluate('window.__seal.advance(.1)')
    assert 'Печать пока закрыта' in page.locator('#notification').inner_text()
    assert page.evaluate('window.__seal.snapshot().telemetry.sealCasts') == 0
    page.keyboard.press('Escape')
    paused = page.evaluate('window.__seal.snapshot()')
    page.evaluate('window.__seal.advance(3)')
    assert page.evaluate('window.__seal.snapshot().player.hp') == paused['player']['hp']
    assert page.evaluate('window.__seal.snapshot().paused')
    page.get_by_role('button',name='Продолжить',exact=True).click()
    training = page.evaluate(CONTROLLER, 'training')
    assert training['snapshot']['trainingComplete'], json.dumps(training,ensure_ascii=False)
    assert training['snapshot']['telemetry']['damageDealt'] > 0
    page.screenshot(path=str(ARTIFACTS/'02-training.png'))
    # Walk through the opened doorway without pressing E or invoking a scene shortcut.
    page.evaluate(r'''() => {
      const api=window.__seal, held=new Set();
      for(let i=0;i<500;i++){
        const p=api.world().player,dx=480-p.x,dy=135-p.y;
        if(api.snapshot().mode!=='training')break;
        for(const [code,on] of [['KeyD',dx>12],['KeyA',dx<-12],['KeyS',dy>12],['KeyW',dy<-12]]){
          if(held.has(code)!==on){window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));on?held.add(code):held.delete(code);}
        }
        api.advance(1/60);
      }
      for(const code of held)window.dispatchEvent(new KeyboardEvent('keyup',{code}));

    }''')
    assert page.evaluate('window.__seal.snapshot().mode') == 'intro', json.dumps(page.evaluate('window.__seal.snapshot()'), ensure_ascii=False)
    assert page.evaluate('window.__seal.snapshot().timeLeft') == 150
    page.evaluate('window.__seal.advance(4.5)')
    page.screenshot(path=str(ARTIFACTS/'03-ring-cinematic.png'))
    page.evaluate('window.__seal.advance(6.5)')
    assert page.evaluate('window.__seal.snapshot().mode') == 'boss'
    assert page.evaluate('window.__seal.snapshot().ringEnabled')
    assert 'ЭТАП 2/2' in page.locator('#time-panel').inner_text()
    assert page.evaluate('window.__seal.snapshot().difficulty') == 'story'
    assert page.evaluate('window.__seal.snapshot().timeLeft') < 150
    page.screenshot(path=str(ARTIFACTS/'04-boss.png'))
    # Boss pause really freezes the countdown.
    page.keyboard.press('Escape')
    remaining=page.evaluate('window.__seal.snapshot().timeLeft')
    page.evaluate('window.__seal.advance(8)')
    assert page.evaluate('window.__seal.snapshot().timeLeft') == remaining
    page.keyboard.press('Escape')
    victory=page.evaluate(CONTROLLER,'boss')
    print('DOM controller:',json.dumps(victory,ensure_ascii=False))
    assert victory['snapshot']['outcome']=='victory',json.dumps(victory,ensure_ascii=False)
    assert victory['snapshot']['telemetry']['phaseChanges']==2
    page.evaluate('window.__seal.advance(7)')
    page.screenshot(path=str(ARTIFACTS/'05-souls.png'))
    page.evaluate('window.__seal.advance(9)')
    assert page.evaluate('window.__seal.snapshot().mode')=='epilogue'
    page.screenshot(path=str(ARTIFACTS/'06-dawn.png'))
    before=page.evaluate('window.__seal.snapshot().cinemaActors[0].x')
    page.keyboard.down('KeyD');page.evaluate('window.__seal.advance(.4)');page.keyboard.up('KeyD')
    assert page.evaluate('window.__seal.snapshot().cinemaActors[0].x') > before
    page.keyboard.press('KeyE');page.evaluate('window.__seal.advance(1)')
    assert page.get_by_role('heading',name='Завет разорван').is_visible()
    # Explicit test fixtures for two failure causes; the normal gameplay path above used no HP edits.
    for outcome,title,image_name in [('health','Павший проводник','07-health-loss'),('timeout','Пятнадцатая минута','08-timeout')]:
        page.get_by_role('button',name='Ещё одно испытание' if outcome=='health' else 'Попробовать снова').click()
        page.evaluate('(o)=>window.__seal.setOutcome(o)',outcome)
        page.evaluate('window.__seal.advance(.1)')
        assert page.evaluate('window.__seal.snapshot().mode')=='ending'
        page.evaluate('window.__seal.advance(3)')
        page.screenshot(path=str(ARTIFACTS/(image_name+'.png')))
        page.evaluate('window.__seal.advance(12)')
        assert page.get_by_role('heading',name=title).is_visible()
    page.get_by_role('button',name='В меню',exact=True).click()
    page.get_by_role('button',name='Начать путь').click()
    assert page.evaluate('window.__seal.snapshot().mode')=='training'
    page.evaluate('window.__seal.beginBoss()')
    page.evaluate("window.__seal.setOutcome('health')")
    page.evaluate('window.__seal.advance(.1)')
    page.get_by_role('button',name='Пропустить').click()
    assert page.get_by_role('heading',name='Павший проводник').is_visible()
    assert not errors,errors
    print('Desktop scene flow, pause, real combat victory and both failure cinematics: PASS')
    # Landscape iPhone-size emulation with simultaneous touch input, never keyboard.
    mobile=browser.new_context(viewport={'width':844,'height':390},is_mobile=True,has_touch=True,device_scale_factor=2)
    phone=mobile.new_page();phone.on('pageerror',lambda e:errors.append(str(e)))
    phone.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    phone.goto(URL+'/?test=1',wait_until='networkidle')
    phone.wait_for_function('window.__seal !== undefined')
    phone.get_by_role('button',name='Начать путь').tap()
    phone.wait_for_timeout(100)
    phone.screenshot(path=str(ARTIFACTS/'09-mobile.png'))
    assert phone.locator('.touch-attack').is_visible()
    # Dispatch native browser touch events through CDP so multiple fingers remain down together.
    cdp=mobile.new_cdp_session(phone)
    stick=phone.locator('.touch-stick').bounding_box();sword=phone.locator('.touch-attack').bounding_box()
    sx=stick['x']+stick['width']/2;sy=stick['y']+stick['height']/2
    ax=sword['x']+sword['width']/2;ay=sword['y']+sword['height']/2
    old=phone.evaluate('window.__seal.snapshot().player.x')
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':sx,'y':sy,'id':1},{'x':ax,'y':ay,'id':2}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':sx+34,'y':sy,'id':1},{'x':ax,'y':ay,'id':2}]})
    phone.evaluate('window.__seal.advance(.8)')
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    snap=phone.evaluate('window.__seal.snapshot()')
    assert snap['player']['x']>old+10,snap
    assert sum(snap['telemetry']['comboSteps'])==1,snap
    assert phone.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    assert not errors,errors
    print('Mobile landscape touch movement + attack, layout and console: PASS')
    browser.close()
