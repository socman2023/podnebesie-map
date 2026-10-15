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


test('desktop VK window uses compact cards and list without shrinking touch screens', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:850,height:620}});
  const page=await context.newPage();
  await launchVK(page, BASE+'/?vk_app_id=54823637&vk_platform=desktop_web#place=ardan');
  await expect(page.locator('#details-title')).toHaveText('Ардан');
  const dimensions=await page.evaluate(()=>{
    const get=id=>document.getElementById(id).getBoundingClientRect();
    const img=get('details-image');
    return {
      panel:get('details').width,
      imageHeight:img.height,
      toolbar:get('vk-favorite').height,
      cssLabel:document.getElementById('vk-favorite').textContent,
      desktopScreen:window.innerWidth
    };
  });
  expect(dimensions.panel).toBeLessThanOrEqual(320);
  expect(dimensions.imageHeight).toBeLessThanOrEqual(180);
  expect(dimensions.cssLabel).toBe('В избранное ВК');
  await page.locator('#list-toggle').click();
  await expect(page.locator('#list-panel')).toBeVisible();
  const listWidth=await page.locator('#list-panel').evaluate(e=>e.getBoundingClientRect().width);
  expect(listWidth).toBeLessThanOrEqual(320);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await context.close();
});

test('VK sharing rejection opens own copy-link panel, never browser prompt', async ({ page }) => {
  await launchVK(page, BASE+'/?vk_app_id=54823637&vk_platform=desktop_web#place=academia');
  await page.evaluate(()=>{
    window.__copied='';
    window.__nativePrompt=0;
    window.prompt=()=>{window.__nativePrompt++;throw Error('Browser prompt must never open');};
    window.vkBridge.send=(method,args)=>{
      if (method==='VKWebAppShare') return Promise.reject({error_type:'unsupported'});
      window.__vkCalls.push({method,args});
      return Promise.resolve({result:true});
    };
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText:async text=>{window.__copied=text;}
    }});
  });
  await page.locator('#location-share').click();
  await expect(page.locator('#share-panel')).toBeVisible();
  await expect(page.locator('#share-link')).toHaveValue('https://vk.com/app54823637#place=academia');
  await page.locator('#share-copy').click();
  await expect(page.locator('#share-copy-status')).toHaveText('Ссылка скопирована.');
  expect(await page.evaluate(()=>window.__copied)).toBe('https://vk.com/app54823637#place=academia');
  expect(await page.evaluate(()=>window.__nativePrompt)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#share-panel')).toBeHidden();
  await expect(page.locator('#details')).toBeVisible();
  await page.locator('#vk-share').click();
  await expect(page.locator('#share-link')).toHaveValue('https://vk.com/app54823637');
  await page.locator('#share-close').click();
  await expect(page.locator('#share-panel')).toBeHidden();
});

test('manual link remains selectable when clipboard is denied', async ({ page }) => {
  await launchVK(page, BASE+'/?vk_app_id=54823637&vk_platform=desktop_web#place=academia');
  await page.evaluate(()=>{
    window.vkBridge.send=(method)=>{
      if(method==='VKWebAppShare')return Promise.reject(new Error('Share denied'));
      return Promise.resolve({});
    };
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText:()=>Promise.reject(new Error('Permission denied'))
    }});
    document.execCommand=()=>false;
    window.prompt=()=>{throw Error('Unexpected prompt');};
  });
  await page.locator('#vk-share').click();
  await expect(page.locator('#share-panel')).toBeVisible();
  await page.locator('#share-copy').click();
  await expect(page.locator('#share-copy-status')).toContainText('скопируйте её вручную');
  const selected=await page.locator('#share-link').evaluate(el=>{
    return el.selectionStart===0 && el.selectionEnd===el.value.length;
  });
  expect(selected).toBeTruthy();
});


test('closing native VK share dialog does not open copy-link fallback', async ({ page }) => {
  await launchVK(page, BASE + '/?vk_app_id=54823637&vk_platform=desktop_web#place=academia');
  const cancellationVariants = [
    {error_type:'client_error',error_data:{error_code:4,error_reason:'User denied'}},
    {error_type:'client_error',error_data:{error_code:1,error_reason:'User cancelled'}},
    {detail:{data:{error_type:'client_error',error_data:{error_code:4,error_reason:'User denied'}}}},
    {name:'AbortError',message:'The user aborted a request'}
  ];
  for (const failure of cancellationVariants) {
    await page.evaluate(error=>{
      window.vkBridge.send = method => {
        if (method==='VKWebAppShare') return Promise.reject(error);
        return Promise.resolve({});
      };
    }, failure);
    await page.locator('#location-share').click();
    await expect(page.locator('#share-panel')).toBeHidden();
    await expect(page.locator('#details-title')).toHaveText('Академия');
    await page.locator('#vk-share').click();
    await expect(page.locator('#share-panel')).toBeHidden();
  }
  await page.evaluate(()=>{
    window.vkBridge.send = method => Promise.resolve(method==='VKWebAppShare' ? {result:[]} : {});
  });
  await page.locator('#location-share').click();
  await expect(page.locator('#share-panel')).toBeHidden();
});

test('a real VK share error still offers the copy-link fallback', async ({ page }) => {
  await launchVK(page, BASE + '/?vk_app_id=54823637&vk_platform=desktop_web#place=academia');
  await page.evaluate(()=>{
    window.vkBridge.send = method => {
      if(method==='VKWebAppShare') {
        return Promise.reject({error_type:'client_error',error_data:{
          error_code:1,error_reason:'Unsupported action'
        }});
      }
      return Promise.resolve({});
    };
  });
  await page.locator('#location-share').click();
  await expect(page.locator('#share-panel')).toBeVisible();
  await expect(page.locator('#share-link')).toHaveValue('https://vk.com/app54823637#place=academia');
});
