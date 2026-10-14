"""Run against `npm run dev`; uses Playwright and installed Chrome."""
import copy
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

base = os.environ.get('BRIEF_URL', 'http://127.0.0.1:4173/')
with urllib.request.urlopen(base + 'data/index.json') as response:
    manifest = json.load(response)
with urllib.request.urlopen(base + 'data/' + manifest['editions'][0]['file']) as response:
    brief = json.load(response)

os.makedirs('test-results', exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base)
    page.wait_for_load_state('networkidle')
    page.wait_for_selector('.story')
    assert page.locator('.story').count() == len(brief['items'])
    assert page.locator('.lead').count() == min(3, len(brief['items']))
    assert page.locator('.story a').first.get_attribute('rel') == 'noopener noreferrer'
    page.screenshot(path='test-results/desktop.png', full_page=True)
    page.get_by_role('button', name='AI 前沿', exact=True).click()
    assert page.locator('.story').count() == len([i for i in brief['items'] if i['category'] == 'ai'])
    assert page.locator('#highlights').is_hidden()
    page.get_by_role('button', name='全部', exact=True).click()

    # New data is discovered without replacing the DOM or moving the viewport.
    newer = copy.deepcopy(brief)
    newer['generatedAt'] = datetime.now(timezone.utc).isoformat()
    newer['items'][0]['title'] = '更新验收：新一期内容'
    state = copy.deepcopy(manifest)
    state['editions'][0]['file'] = 'editions/2099-01-01-1234.json'
    state['editions'][0]['generatedAt'] = newer['generatedAt']
    old = copy.deepcopy(brief)
    old['generatedAt'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    state['editions'].append({'date': '2026-10-13', 'file': 'editions/2026-10-13-1234.json', 'generatedAt': old['generatedAt']})
    page.route('**/data/index.json', lambda route: route.fulfill(json=state))
    page.route('**/data/editions/2099-01-01-1234.json', lambda route: route.fulfill(json=newer))
    page.route('**/data/editions/2026-10-13-1234.json', lambda route: route.fulfill(json=old))
    page.evaluate('window.scrollTo(0, 700)')
    y = page.evaluate('window.scrollY')
    original = page.locator('.story h3').first.inner_text()
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.locator('#apply-update').wait_for(state='visible')
    assert page.locator('.story h3').first.inner_text() == original
    assert abs(page.evaluate('window.scrollY') - y) < 2
    page.locator('#apply-update').click()
    page.wait_for_function("document.querySelector('.story h3').textContent.includes('更新验收')")
    page.select_option('#edition', '2026-10-13')
    page.wait_for_function("document.querySelector('#status').textContent.includes('历史简报')")
    page.select_option('#edition', 'latest')
    page.wait_for_function("document.querySelector('.story h3').textContent.includes('更新验收')")

    # A later network failure keeps the already rendered news visible.
    page.route('**/data/index.json', lambda route: route.fulfill(status=503, body='Unavailable'))
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_function("document.querySelector('#status').textContent.includes('仍显示')")
    assert page.locator('.story').count() == len(brief['items'])

    mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=1)
    mobile.on('pageerror', lambda e: errors.append(str(e)))
    mobile.goto(base)
    mobile.wait_for_load_state('networkidle')
    mobile.wait_for_selector('.story')
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert mobile.locator('#news-grid').evaluate("e => getComputedStyle(e).gridTemplateColumns.split(' ').length") == 1
    mobile.get_by_role('button', name='环球财经', exact=True).click()
    assert mobile.locator('.story').count() == len([i for i in brief['items'] if i['category'] == 'finance'])
    mobile.get_by_role('button', name='全部', exact=True).click()
    mobile.screenshot(path='test-results/mobile.png', full_page=True)

    # Empty data, stale warning, and literal text instead of HTML execution.
    edge = browser.new_page()
    empty = copy.deepcopy(brief)
    empty['items'] = []
    empty['generatedAt'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    edge.route('**/data/editions/*.json', lambda route: route.fulfill(json=empty))
    edge.goto(base)
    edge.wait_for_load_state('networkidle')
    assert edge.locator('#empty').is_visible()
    assert '超过24小时' in edge.locator('#status').inner_text()
    empty['items'] = [copy.deepcopy(brief['items'][0])]
    empty['items'][0]['title'] = '<img src=x onerror="window.pwned=1">'
    edge.reload()
    edge.wait_for_load_state('networkidle')
    assert edge.locator('.story img').count() == 0
    assert edge.evaluate('window.pwned') is None
    assert not errors, errors
    browser.close()
print('Browser checks passed: desktop, mobile, categories, history, new-version notification, scroll, failure retention, empty/stale states, XSS.')
