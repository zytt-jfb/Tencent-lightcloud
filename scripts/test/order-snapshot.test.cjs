const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const req = createRequire(path.resolve('apps/api/package.json'));
const { DataSource } = req('typeorm');
const { BizOrderRowEntity } = require('../../apps/api/dist/orders/biz-order-row.entity');
const { BizOrderImportBatchEntity } = require('../../apps/api/dist/orders/biz-order-import-batch.entity');
const { BizOrderImportErrorEntity } = require('../../apps/api/dist/orders/biz-order-import-error.entity');
const { BizOrderImportService } = require('../../apps/api/dist/biz-orders/biz-order-import.service');
const { BizOrderUploadPartEntity } = require('../../apps/api/dist/orders/biz-order-upload-part.entity');
const XLSX = req('xlsx');
const { ORDER_TEMPLATE_COLUMNS } = require('../../packages/shared-types/dist');
const fs = require('node:fs');
const os = require('node:os');
(async () => {
  const ds = new DataSource({type:'better-sqlite3', database:':memory:', entities:[BizOrderRowEntity,BizOrderImportBatchEntity,BizOrderImportErrorEntity,BizOrderUploadPartEntity], synchronize:true});
  await ds.initialize();
  await ds.query('CREATE TABLE biz_order_snapshot_lock (id INTEGER PRIMARY KEY, revision INTEGER)');
  await ds.query('INSERT INTO biz_order_snapshot_lock VALUES (1,0)');
  const rows=ds.getRepository(BizOrderRowEntity), batches=ds.getRepository(BizOrderImportBatchEntity);
  const empty={find:async()=>[],save:async()=>{}};
  const svc=new BizOrderImportService(batches,rows,ds.getRepository(BizOrderImportErrorEntity),empty,empty,empty,empty,empty,empty,empty,empty,ds,{}, {recalcInternal:async()=>{}});
  const auth={userId:'test',roleCode:'super_admin',dataScope:{scopeType:'all'}};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-test-'));
  async function load(id, bad=false) {
    const row=new Array(34).fill(''); row[0]='山东省';row[2]=id;row[5]=10;
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([bad?['bad']:ORDER_TEMPLATE_COLUMNS,row]),'orders');
    const file=path.join(dir,id+'.xlsx');fs.writeFileSync(file,XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
    await batches.save({id,filename:id,fileHash:id,idempotencyKey:id,status:'parsing',uploadedBy:'test',tempFilePath:file,batchPurpose:'normal'});
    await svc.processBatch(id);
  }
  try {
    await load('first'); assert.equal(await rows.countBy({isCurrent:true}),1);
    await load('second'); assert.equal(await rows.countBy({isCurrent:true}),1);assert.equal(await rows.count(),2);
    assert.equal((await rows.findOneBy({batchId:'first'})).isCurrent,false);
    assert.equal((await batches.findOneBy({id:'first'})).lifecycleStatus,'historical');
    await load('failed',true);assert.equal(await rows.countBy({isCurrent:true}),1);
    assert.equal((await batches.findOneBy({id:'failed'})).status,'failed');
    const historical=await rows.findOneBy({batchId:'first'});
    await assert.rejects(()=>svc.maintainRow(auth,historical.id,{}),/历史批次/);
    if (process.env.ORDER_REAL_FILE) {
      const file=path.join(dir,'real.xlsx');fs.copyFileSync(process.env.ORDER_REAL_FILE,file);
      await batches.save({id:'real',filename:'real.xlsx',fileHash:'real',idempotencyKey:'real',status:'parsing',uploadedBy:'test',tempFilePath:file,batchPurpose:'normal'});
      const started=Date.now();await svc.processBatch('real');
      const batch=await batches.findOneBy({id:'real'});
      assert.equal(batch.status,'imported');assert.equal(batch.totalRows,212024);
      assert.equal(await rows.countBy({isCurrent:true}),212024);
      console.log(JSON.stringify({realRows:batch.totalRows,seconds:(Date.now()-started)/1000,rssMB:Math.round(process.memoryUsage().rss/1048576)}));
    }
    console.log('ORDER_SNAPSHOT_OK replacement, history preservation, failure retention, historical maintenance rejection');
    const input={key:'parts-test',index:0,count:2,filename:'orders.xlsx'};
    const firstPart={buffer:Buffer.alloc(4*1024*1024,1)};
    await svc.uploadPart(auth,firstPart,input);
    await svc.uploadPart(auth,firstPart,input);
    assert.equal(await ds.getRepository(BizOrderUploadPartEntity).count(),1,'part retry must be idempotent');
    await assert.rejects(()=>svc.uploadPart({...auth,userId:'other'},firstPart,input),/冲突/);
    await assert.rejects(()=>svc.completeUpload(auth,input.key),/不完整/);
    const tail={buffer:Buffer.from('tail')};
    await svc.uploadPart(auth,tail,{...input,index:1});
    let merged;
    svc.upload=async (_auth,file)=>{merged=file.buffer;return {id:'merged',status:'parsing'};};
    const complete=await svc.completeUpload(auth,input.key);
    assert.equal(complete.id,'merged');
    assert.deepEqual(merged,Buffer.concat([firstPart.buffer,tail.buffer]));
    assert.equal(await ds.getRepository(BizOrderUploadPartEntity).count(),0,'parts cleaned after completion');
    console.log('ORDER_UPLOAD_PARTS_OK merge, retry, ownership, incomplete rejection, cleanup');
  } finally {await ds.destroy(); fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
