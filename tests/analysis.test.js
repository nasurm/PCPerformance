const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const A=require('../public/analysis');
const {plain,server}=require('../server');
const {parseList,parseSingle}=require('../benchmarks');
// Deliberately synthetic data: the engine must not depend on this user's hardware.
const cpu=(name,score,single)=>({name,score,single,source:'https://www.cpubenchmark.net/'});
const gpu=(name,score)=>({name,score,source:'https://www.videocardbenchmark.net/'});
A.setDatabase({CPU:[cpu('Intel Core i5-1234',200,150),cpu('Intel Core i5-1234U',80,70),cpu('AMD Ryzen 5 4321',250,100),cpu('Intel Core i7-9876',400,300)],GPU:[gpu('GeForce GTX 123',100),gpu('GeForce GTX 123 Ti',150),gpu('GeForce GTX 123 Ti (Mobile)',120),gpu('Radeon RX 456',300)]});
const machine={cpu:[{Name:'Intel(R) Core(TM) i5-1234 CPU @ 3.60GHz',NumberOfCores:6,NumberOfLogicalProcessors:6,MaxClockSpeed:3600}],gpus:[{Name:'NVIDIA GeForce GTX 123 Ti',vramGB:6}],computer:[{TotalPhysicalMemory:16*2**30}]};
const check=(processor,graphics='GTX 123',memory='8 GB')=>A.compare(machine,{recommended:'Processor: '+processor+'\nGraphics: '+graphics+'\nMemory: '+memory});
test('retrieved names preserve CPU and GPU variants',()=>{
 assert.equal(A.models(machine.cpu[0].Name,'CPU')[0].score,200);
 assert.equal(A.models('i5-1234U','CPU')[0].score,80);
 assert.equal(A.models('GTX 123 Ti (Mobile)','GPU')[0].score,120);
 assert.equal(A.models('GTX 123 Ti','GPU')[0].score,150);
 assert.deepEqual(A.models('i5-1234H','CPU'),[]);
});
test('above and below comparisons use retrieved scores',()=>{
 assert.deepEqual(check('i5-1234U').rows.map(r=>r.status),['above','above','above']);
 assert.deepEqual(check('i7-9876','RX 456','32 GB').below.map(r=>r.kind),['GPU','CPU','RAM']);
});
test('mixed CPU evidence cannot trigger an upgrade',()=>{
 assert.equal(check('Ryzen 5 4321').rows[1].status,'unknown');
 assert.equal(check('i7-9876 or Ryzen 5 4321').rows[1].status,'unknown');
 assert.equal(check('i7-9876 or i5-1234U').rows[1].status,'above');
});
test('numeric requirements and family labels are checked literally',()=>{
 assert.equal(check('3.0+ GHz Quad core').rows[1].status,'meets');
 assert.equal(check('8 hardware CPU threads').rows[1].status,'below');
 assert.equal(check('Intel Core i5 or AMD equivalent').rows[1].status,'meets');
 assert.equal(check('Intel Core i7 or AMD Ryzen 5').rows[1].status,'unknown');
});
test('VRAM and RAM shortages are independent of benchmark score',()=>{
 assert.equal(check('i5-1234U','GTX 123 8 GB').rows[0].status,'below');
 assert.equal(check('i5-1234U','2 GB dedicated memory').rows[0].status,'meets');
 assert.equal(check('i5-1234U','Unknown GPU').rows[0].status,'unknown');
});
test('missing facts and fallback remain explicit',()=>{
 assert.equal(A.compare(null,null).below.length,0);
 assert.ok(A.compare(machine,null).rows.every(r=>r.status==='unknown'));
 assert.deepEqual(A.models('','GPU'),[]);
 assert.ok(A.compare(machine,{minimum:'Processor: i5-1234U\nGraphics: GTX 123\nMemory: 8 GB'}).rows.every(r=>r.fallback));
});
test('storage counts installed files and distinguishes moving from upgrading',()=>{
 const s={disks:[{DeviceID:'D:',FreeSpace:10*2**30,MediaType:'HDD'},{DeviceID:'C:',FreeSpace:100*2**30,MediaType:'SSD'}]};
 const game={path:'D:\\Games',size:40*2**30};
 assert.equal(A.storage(s,{minimum:'Storage: 50 GB'},game).status,'meets');
 const r=A.storage(s,{minimum:'Storage: 50 GB SSD required'},game);assert.equal(r.label,'Move to SSD');assert.equal(r.upgrade,false);
 assert.equal(A.storage(s,{minimum:'Storage: 100 GB'},game).status,'space');
 assert.equal(A.storage(s,null,{}).status,'unknown');
});
test('source parsers extract real table shapes and reject empty responses',()=>{
 const rows=parseList('<TR id="gpu12"><TD><A HREF="gpu.php?id=12">GPU Test</A></TD><TD>1,234</TD></TR>','GPU');assert.equal(rows[0].score,1234);assert.match(rows[0].source,/id=12/);
 assert.equal(parseSingle('<li id="rk10"><span class="count">2,345</span></li>')['10'],2345);
 assert.deepEqual(parseList('<html>Service unavailable</html>','CPU'),[]);
 assert.equal(A.fields(plain('<li>Memory: 8 GB</li>')).memory,'8 GB');
});
test('loopback API denies host spoofing, cross-origin and tokenless writes',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:url,method,headers:{Host:'127.0.0.1:'+port,...headers}},res=>{let b='';res.on('data',x=>b+=x);res.on('end',()=>resolve({status:res.statusCode,body:b,headers:res.headers}))});r.on('error',reject);r.end()});
 try {assert.equal((await request('/api/bootstrap',{Host:'evil.test:3030'})).status,403);assert.equal((await request('/api/bootstrap',{Origin:'https://evil.test'})).status,403);assert.equal((await request('/api/bootstrap',{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await request('/api/settings',{},'POST')).status,403);assert.equal((await request('/server.js')).status,404);assert.equal((await request('/data/settings.json')).status,404);const index=await request('/');assert.equal(index.status,200);assert.match(index.headers['content-security-policy'],/frame-ancestors 'none'/);assert.match(index.body,/PC RADAR/);}finally{await new Promise(resolve=>server.close(resolve))}
});
