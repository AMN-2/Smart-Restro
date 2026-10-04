const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/frappe/.cache/ms-playwright-go/1.50.1/package');
const base = process.env.URYPOS_QA_URL || 'http://127.0.0.1:8099';
(async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/home/frappe/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless:true, args:['--no-sandbox']});
 const failures=[], passes=[];
 try {
 for (const [lang,width,scheme] of [['en',1440,'light'],['ar',1280,'dark'],['ar',768,'light'],['ar',390,'dark']]) {
  const page = await browser.newPage({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning' && m.text().includes('[Vue'))errors.push(m.text());});
  await page.addInitScript(lang=>localStorage.setItem('ury_language',lang),lang);
  // All API traffic is intercepted. No live orders, invoices or payments.
  await page.route('**/api/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));
  await page.route('**/socket.io/**',r=>r.abort());
  await page.goto(base+'/urypos/');
  await page.locator('#userId').waitFor();
  assert.equal(await page.locator('#password').getAttribute('type'),'password');
  await page.locator('#password + button').click();
  assert.equal(await page.locator('#password').getAttribute('type'),'text');
  await page.evaluate(async()=>{
   const [{useAuthStore},{useMenuStore},{useTableStore},{useInvoiceDataStore},{usetoggleRecentOrder},{useCustomerStore},{default:unusedRouter},{posClosing},{posOpening},{useNotificationModal}] = await Promise.all([
    import('/src/stores/Auth.js'),import('/src/stores/Menu.js'),import('/src/stores/Table.js'),import('/src/stores/invoiceData.js'),import('/src/stores/recentOrder.js'),import('/src/stores/Customer.js'),import('/src/router/index.js'),import('/src/stores/posClosing.js'),import('/src/stores/posOpening.js'),import('/src/stores/NotificationModal.js')]);
   const router=document.querySelector("#app").__vue_app__.config.globalProperties.$router;
   const auth=useAuthStore(),menu=useMenuStore(),table=useTableStore(),invoice=useInvoiceDataStore(),recent=usetoggleRecentOrder(),customer=useCustomerStore(),close=posClosing(),opening=posOpening(),modal=useNotificationModal();
   Object.assign(auth,{userAuth:true,cashier:true,hasAccess:true,sessionUser:'qa',removeTableOrderItem:1,restrictTableOrder:false,viewItemImage:1});
   invoice.posProfile='QA';invoice.currency='IQD';invoice.modeOfPaymentList=[{mode_of_payment:'Cash',opening_amount:0}];
   recent.handleStatusChange=()=>{};customer.fectchCustomerFavouriteItem=()=>{};
   const products=Array.from({length:25},(_,i)=>({item:'QA-'+i,item_name:'QA Product '+i,rate:10+i,course:i%2?'Drinks':'Food',special_dish:0}));
   const tiles=[{name:'QA-1',restaurant_room:'Room A',occupied:0,is_take_away:0,no_of_seats:4},{name:'QA-2',restaurant_room:'Room B',occupied:1,is_take_away:0,latest_invoice_time:'10:00:00'}];
   const get=async(method,args)=>{if(method.includes('getRestaurantMenu'))return {message:{items:structuredClone(products),name:'Menu '+args.room}};
    if(method.includes('get_order_invoice'))return {message:args.table==='QA-2'?{name:'INV-2',customer:'QA customer',waiter:'qa',items:[{item_code:'QA-0',item_name:'QA Product 0',rate:8,qty:2}],invoice_printed:0}:{}};
    return {message:[]};};
   table.call={get};table.fetchTable=async()=>{};table.rooms=[{name:'Room A'},{name:'Room B'}];table.selectedRoom='Room A';table.tables=tiles;
   window.qa={auth,menu,table,invoice,recent,customer,router,products,tiles,get,close,opening,modal};
   await router.push('/Table');
  });

  await page.locator('.table-scene').first().waitFor({timeout:5000});
  await page.locator('article footer button').first().click();
  await page.locator('.pos-product-card').first().waitFor();
  assert.equal(await page.locator('.pos-product-card').count(),20,'products render after table selection');
  await page.locator('.pos-product-card').first().locator('button').click();
  assert.equal(await page.evaluate(()=>qa.menu.cart.length),1);
  const search=page.locator('input[type=search]').first();
  await search.fill('no-such-product');
  assert.equal(await page.locator('.pos-product-card').count(),0);
  await search.fill('QA Product 0');
  assert.equal(await page.locator('.pos-product-card').count(),1);
  await search.fill('');
  await page.locator('.pos-product-card .pos-stepper-value').first().click();
  await page.locator('#itemComments').fill('QA note');
  await page.locator('[role=dialog] footer button').last().click();
  assert.equal(await page.evaluate(()=>qa.menu.cart[0].comment),'QA note');
  for(const path of ['/Customer','/Cart','/recentOrder','/PosOpen','/PosClose','/Table','/Menu','/Cart','/Menu']) {
   await page.evaluate(path=>qa.router.push(path),path);
   await page.waitForTimeout(120);
   assert.ok((await page.locator('main').innerText()).trim().length>0,'nonempty route '+path);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
   assert.equal(overflow,false,'horizontal overflow '+path+' '+width);
  }
  await page.evaluate(async()=>{
   qa.menu.showModal(qa.menu.cart[0]);
  });
  await page.locator('[role=dialog]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[role=dialog]').waitFor({state:'hidden'});
  if(width>=1280) assert.ok(await page.locator('.menu-cart-rail').isVisible());
  else assert.equal(await page.locator('.menu-cart-rail').isVisible(),false);
  const result=await page.evaluate(async()=>{
    const {table,menu,invoice,recent,tiles,get,auth}=qa;
    const out={};
    table.call={get:async()=>{throw Error('offline test')}};
    const oldCart=menu.cart;
    out.failed=await table.addToSelectedTables(tiles[1]);
    out.preserved=oldCart===menu.cart;
    table.call={get};
    recent.invoiceNumber='STALE';recent.draftInvoice='STALE';invoice.invoiceNumber='STALE';
    menu.searchTerm='stale-filter';menu.currentPage=99;
    out.loaded=await table.addToSelectedTables(tiles[1]);
    out.invoice=invoice.invoiceNumber;out.stale=recent.draftInvoice;out.qty=menu.cart[0].qty;out.rate=menu.cart[0].rate;out.filter=menu.searchTerm;
    auth.cashier=false;auth.hasAccess=false;auth.sessionUser='different';
    table.alert.createAlert=async()=>{};
    out.denied=await table.addToSelectedTables(tiles[1]);
    auth.cashier=true;
    let release;table.call={get:async(...args)=>{await new Promise(r=>release=r);return get(...args)}};
    // Dedicated lock check avoids starting unresolved API calls.
    table.openingTable=true;out.locked=await table.addToSelectedTables(tiles[0]);table.openingTable=false;
    table.call={get};
    await table.addToSelectedTables(tiles[0]);
    out.cleared=invoice.invoiceNumber==='' && menu.cart.length===0;
    return out;
  });
  assert.deepEqual(result,{failed:false,preserved:true,loaded:true,invoice:'INV-2',stale:'',qty:2,rate:8,filter:'',denied:false,locked:false,cleared:true});

  const operations = await page.evaluate(async()=>{
   const {table,menu,invoice,recent,customer,auth,modal,close,opening}=qa;
   const out={};
   auth.cashier=false;customer.numberOfPax=2;table.invoiceNo='';invoice.invoiceNumber='';
   menu.cart=[{item:'QA-0',item_name:'QA Product 0',qty:1,rate:10}];
   let writes=0,release;
   invoice.call={post:async()=>{writes++;await new Promise(r=>release=r);return {message:{name:'SAVED',items:[{item_code:'QA-0',qty:1}],modified:'v1',grand_total:10}}}};
   const first=invoice.invoiceCreation();
   await invoice.invoiceCreation();
   out.writes=writes;release();await first;
   out.saved=invoice.invoiceNumber==='SAVED' && !invoice.invoiceUpdating;
   table.invoiceNo='SAVED';table.previousOrderdItem=[{item_code:'QA-0',qty:2,item_name:'QA Product 0'}];
   const cancellation=invoice.invoiceCreation();modal.handleCancel();await cancellation;
   out.cancelled=!invoice.invoiceUpdating && invoice.showUpdateButtton && writes===1;
   table.previousOrderdItem=[{item_code:'QA-0',qty:1,comment:''}];table.previousOrder={custom_comments:''};
   menu.comments='unsent note';out.dirtyNote=table.isOpenOrderDirty();menu.comments='';
   invoice.call={post:async()=>{throw Error('Network failure')}};
   await invoice.invoiceCreation();out.failedSend=!invoice.invoiceUpdating && invoice.showUpdateButtton && menu.cart.length===1;
   close.call={get:async()=>({message:[
    {name:'I1',modified:'2026-10-04 10:00:00',grand_total:12,net_total:10,total_qty:1,taxes:[{account_head:'Tax',rate:20,tax_amount:2}],payments:[{mode_of_payment:'Cash',amount:12}]},
    {name:'I2',modified:'2026-10-04 11:00:00',grand_total:24,net_total:20,total_qty:2,taxes:[{account_head:'Tax',rate:20,tax_amount:4}],payments:[{mode_of_payment:'Card',amount:24}]}
   ]})};
   await close.getInvoice();await close.getInvoice();
   out.totals=[close.grandTotal,close.netTotal,close.totalQty,close.totalInvoices,close.taxes[0].tax_amount];
   close.openingBalance=[{mode_of_payment:'Cash',opening_amount:10,closing_amount:22},{mode_of_payment:'Card',opening_amount:0,closing_amount:23}];
   close.db={createDoc:async(type,payload)=>{out.reconciliation=payload.payment_reconciliation.map(r=>[r.expected_amount,r.closing_amount,r.difference]);return {name:'QA-CLOSE'}}};
   close.savePosClosing();
   opening.db={createDoc:async()=>({name:'QA-OPEN'})};opening.savePosOpening();
   await new Promise(r=>setTimeout(r,0));
   out.opening=opening.posOpenSaved;
   auth.cashier=true;invoice.invoiceNumber='';table.invoiceNo='';recent.invoiceNumber='';
   return out;
  });
  assert.deepEqual(operations,{writes:1,saved:true,cancelled:true,dirtyNote:true,failedSend:true,totals:[36,30,3,2,6],reconciliation:[[22,22,0],[24,23,-1]],opening:true});
  await page.evaluate(()=>qa.router.push('/PosOpen'));
  await page.locator('input[inputmode=decimal]').first().fill('25');
  await page.evaluate(()=>qa.router.push('/PosClose'));
  await page.locator('input[inputmode=decimal]').nth(1).fill('50');
  assert.equal(await page.locator('input[inputmode=decimal]').nth(3).inputValue(),'23');
  await page.evaluate(()=>qa.router.push('/Menu'));
  await page.waitForTimeout(400);
  await page.screenshot({path:'/tmp/urypos-qa-'+lang+'-'+width+'.png',fullPage:true});

  let documentLoads=0;
  const onRequest = request => { if(request.isNavigationRequest()) documentLoads++; };
  page.on('request',onRequest);
  const cartBefore=await page.evaluate(()=>JSON.stringify(qa.menu.cart));
  await page.locator('.pos-brand-mark').click();
  await page.waitForURL('**/urypos/Table');
  assert.equal(documentLoads,0,'Home must not reload document');
  assert.equal(await page.locator('#userId').count(),0,'Home must not flash login');
  assert.equal(await page.evaluate(()=>JSON.stringify(qa.menu.cart)),cartBefore);
  await page.evaluate(()=>{
    qa.auth.auth={getLoggedInUser:()=>new Promise(resolve=>window.resolveSession=resolve)};
    qa.invoice.fetchInvoiceDetails=async()=>{};qa.table.fetchRoom=()=>{};qa.auth.fetchUserRole=()=>{};
    window.sessionCheck=qa.auth.fetchUserDetails();
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#userId').count(),0,'pending session is not login');
  assert.ok(await page.locator('main [role=status]').isVisible());
  await page.evaluate(async()=>{resolveSession('qa');await sessionCheck});
  assert.equal(await page.locator('#userId').count(),0,'valid session stays signed in');
  await page.evaluate(()=>{window.sessionCheck=qa.auth.fetchUserDetails()});
  await page.evaluate(async()=>{resolveSession('Guest');await sessionCheck});
  await page.locator('#userId').waitFor();
  assert.deepEqual(errors,[],'browser errors');
  passes.push(lang+' '+width+' '+scheme+': navigation, menu, cart, dialog, search, room switch, failures, permissions, submit/cancel, opening/closing totals');
  await page.close();
 }
 }catch(e){failures.push(e.stack)}finally{await browser.close()}
 console.log(JSON.stringify({passes,failures},null,2));if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
