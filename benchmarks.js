const fs = require('node:fs');
const path = require('node:path');
const SOURCES = {CPU:'https://www.cpubenchmark.net/cpu_list.php',GPU:'https://www.videocardbenchmark.net/gpu_list.php',single:'https://www.cpubenchmark.net/singleThread.html',AMD:'https://www.cpubenchmark.net/cpu-list/amd',other:'https://www.cpubenchmark.net/cpu-list/other'};
const file = path.join(process.env.RADAR_DATA_DIR||path.join(__dirname,'data'),'benchmarks.json');
const clean = s => s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim();
function parseList(html,kind){
 const rows=[];
 for(const m of html.matchAll(/<tr\b[^>]*id=["'](?:cpu|gpu)(\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>x[1]);
  const name=clean(cells[0]||''),score=Number(clean(cells[1]||'').replace(/,/g,''));
  if(name&&score>0)rows.push({id:m[1],name,score,source:new URL((kind==='CPU'?'cpu':'gpu')+'.php?id='+m[1],SOURCES[kind]).href});
 }
 return rows;
}
function parseSingle(html){return Object.fromEntries([...html.matchAll(/<li id="rk(\d+)"[\s\S]*?<span class="count">([\d,]+)<\/span>[\s\S]*?<\/li>/g)].map(m=>[m[1],Number(m[2].replace(/,/g,''))]));}
let pending;
async function database(){
 let cached;try{cached=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 if(cached?.version===2&&Date.now()-Date.parse(cached.fetchedAt)<7*86400000)return cached;
 if(pending)return pending;
 pending=(async()=>{try{
  const html=await Promise.all(Object.values(SOURCES).map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Benchmark source returned '+r.status);return r.text()}));
  const cpuLists=[0,3,4].map(i=>parseList(html[i],'CPU'));
  if(cpuLists.some(rows=>rows.length<100))throw Error('A CPU source returned incomplete data');
  const CPU=[...new Map(cpuLists.flat().map(x=>[x.id,x])).values()],GPU=parseList(html[1],'GPU'),single=parseSingle(html[2]);
  if(CPU.length<100||GPU.length<100||Object.keys(single).length<100)throw Error('Benchmark source format changed');
  CPU.forEach(x=>x.single=single[x.id]||null);
  const result={version:2,CPU,GPU,sources:SOURCES,fetchedAt:new Date().toISOString()};
  fs.writeFileSync(file+'.tmp',JSON.stringify(result));fs.renameSync(file+'.tmp',file);return result;
 }catch(e){return cached?{...cached,stale:true,warning:'Benchmark refresh failed; using saved results.'}:{CPU:[],GPU:[],warning:'Benchmark service unavailable. Hardware detection still works; performance comparisons will retry on refresh.'}}finally{pending=null}})();return pending;
}
module.exports={database,parseList,parseSingle};
