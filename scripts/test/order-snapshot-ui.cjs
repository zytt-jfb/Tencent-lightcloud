const { chromium } = require('@playwright/test');
const fs = require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.addInitScript(()=>localStorage.setItem('biz_access_token','test'));
  await page.route('**/api/**', async route=>{
    const url=route.request().url();
    let body={items:[],total:0,page:1,pageSize:20};
    if(url.includes('/auth/me'))body={id:'test',roleCode:'super_admin',permissions:['operation.order.upload'],dataScope:{scopeType:'all'},name:'管理员'};
    if(url.includes('/snapshot/metadata'))body={status:'none',lastRun:null};
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  });
  fs.mkdirSync('.artifacts/order-snapshot',{recursive:true});
  for(const [name,size] of [['desktop',{width:1440,height:900}],['mobile',{width:515,height:698}]]){
    await page.setViewportSize(size);await page.goto('http://127.0.0.1:4178/#/biz/orders');
    await page.getByText('上传订单全量总表', {exact:false}).waitFor();
    await page.screenshot({path:'.artifacts/order-snapshot/'+name+'.png',fullPage:true});
  }
  await browser.close();console.log('ORDER_SNAPSHOT_UI_OK desktop/mobile');
})().catch(e=>{console.error(e);process.exitCode=1});
