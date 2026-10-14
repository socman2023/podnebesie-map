const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:8765';
const VK_MOCK = [
  'window.__vkCalls = [];',
  'window.__vkEmit = null;',
  'window.vkBridge = {',
  '  isEmbedded: () => true,',
  '  subscribe(handler) { window.__vkEmit = handler; },',
  '  send(method, args) {',
  '    window.__vkCalls.push({method, args: args || null});',
  '    return Promise.resolve({result:true});',
  '  }',
  '};'
].join('\n');

async function launchVK(page, url) {
  await page.route('**/vendor/vk-bridge/browser.min.js', route =>
    route.fulfill({status: 200, contentType: 'application/javascript', body: VK_MOCK}));
  await page.goto(url, {waitUntil:'domcontentloaded'});
  await expect(page.locator('#loading-state')).toBeHidden({timeout:30000});
}

test('normal web keeps the standalone map, clean links and no VK favorites', async ({ page }) => {
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.goto(BASE + '/#place=academia', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('#loading-state')).toBeHidden({timeout:30000});
  await expect(page.locator('#details-title')).toHaveText('Академия');
  await expect(page.locator('#vk-favorite')).toBeHidden();
  await expect(page.locator('#vk-share')).toBeVisible();
  const shared = await page.evaluate(() => window.PodnebesieVK.getLink('academia'));
  expect(shared).toBe(BASE + '/#place=academia');
  expect(errors).toEqual([]);
});

test('VK init, direct location routing, favorite and sharing without profile requests', async ({ browser }) => {
  for (const width of [320, 390, 900, 1024]) {
    const context=await browser.newContext({
      viewport:{width,height:780},isMobile:width<600,hasTouch:width<600,
      deviceScaleFactor:width<600?2:1, permissions:['clipboard-read','clipboard-write']
    });
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await launchVK(page, BASE + '/?vk_app_id=54823637&vk_platform=mobile_android&sign=secret#place=academia');
    await expect(page.locator('#details-title')).toHaveText('Академия');
    await expect(page.locator('#vk-favorite')).toBeVisible();
    await expect(page.locator('#location-share')).toBeVisible();

    const overflow=await page.evaluate(() =>
      document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('#location-share').click();
    await page.locator('#vk-favorite').click();
    let calls=await page.evaluate(() => window.__vkCalls);
    expect(calls.some(c=>c.method==='VKWebAppInit')).toBeTruthy();
    expect(calls.some(c=>c.method==='VKWebAppShare' &&
      c.args.link==='https://vk.com/app54823637#place=academia')).toBeTruthy();
    expect(calls.some(c=>c.method==='VKWebAppAddToFavorites')).toBeTruthy();

    await page.locator('#search-input').fill('Златоград');
    await page.locator('#search-results button').first().click();
    await expect(page.locator('#details-title')).toHaveText('Златоград');
    await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('#place=zlatograd');
    calls=await page.evaluate(() => window.__vkCalls);
    expect(calls.some(c=>c.method==='VKWebAppSetLocation' &&
      c.args.location==='place=zlatograd')).toBeTruthy();

    await page.evaluate(() => window.__vkEmit({
      detail:{type:'VKWebAppChangeFragment',data:{location:'place=polunoch'}}
    }));
    await expect(page.locator('#details-title')).toHaveText('Полуночные горы');
    expect(await page.evaluate(()=>window.location.hash)).toBe('#place=polunoch');

    await page.goBack();
    await expect(page.locator('#details-title')).toHaveText('Академия');
    if(width<600){
      const pin=await page.locator('.map-pin--selected').first().boundingBox();
      const sheet=await page.locator('#details').boundingBox();
      expect(pin).not.toBeNull();
      expect(sheet).not.toBeNull();
      expect(pin.y+pin.height/2).toBeLessThan(sheet.y-5);
    }
    calls=await page.evaluate(()=>window.__vkCalls);
    const permitted=new Set(['VKWebAppInit','VKWebAppSetLocation','VKWebAppShare','VKWebAppAddToFavorites']);
    expect(calls.every(c=>permitted.has(c.method))).toBeTruthy();
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('can enter another place from VK fragment event and return to map', async ({ page })=>{
  await launchVK(page, BASE + '/?vk_app_id=54823637&vk_platform=desktop_web');
  await expect(page.locator('#details')).toBeHidden();
  await page.evaluate(()=>window.__vkEmit({
    detail:{type:'VKWebAppChangeFragment',data:{location:'#place=academia'}}
  }));
  await expect(page.locator('#details-title')).toHaveText('Академия');
  await page.evaluate(()=>window.__vkEmit({
    detail:{type:'VKWebAppChangeFragment',data:{location:''}}
  }));
  await expect(page.locator('#details')).toBeHidden();
});

test('registered VK ID remains fixed even with untrusted launch parameters', async ({ page }) => {
  await launchVK(page, BASE + '/?vk_app_id=54823637&vk_platform=mobile_android#place=academia');
  const link = await page.evaluate(() => window.PodnebesieVK.getLink('academia'));
  expect(link).toBe('https://vk.com/app54823637#place=academia');
});
