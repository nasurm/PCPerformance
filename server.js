const {database}=require('./benchmarks');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const PORT = Number(process.env.PORT || 3030);
let origin = `http://127.0.0.1:${PORT}`;
const portable=process.env.RADAR_PORTABLE==='1';
const instance=process.env.RADAR_INSTANCE||crypto.randomUUID();
const children=new Set();
const publicDir = path.join(__dirname, 'public');
const dataDir = process.env.RADAR_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const token = crypto.randomBytes(24).toString('hex');
const pending = new Map();
const scans = new Map();
const publishers = JSON.parse(fs.readFileSync(path.join(__dirname,'publisher-requirements.json'),'utf8'));
const normalizeName = s => s.toLowerCase().replace(/[^a-z0-9]/g,'');
async function resolveGame(name) {
  if(typeof name!=='string'||!name.trim()||name.length>150) throw new Error('Invalid game title.');
  const normalized=normalizeName(name);
  if(publishers[normalized]) return {requirements:publishers[normalized]};
  const known={asphaltlegends:'1815780',asurajang:'2549130',overwatch:'2357570',overwatch2:'2357570',tomclancysrainbowsixsiege:'359550'};
  if(known[normalized]) return {id:known[normalized],matched:true,name};
  const cacheKey='match-'+crypto.createHash('sha256').update(normalized).digest('hex')+'.json';
  const cached=readJson(cacheKey,null);
  if(cached && Date.now()-Date.parse(cached.at)<7*86400000) return cached.result;
  const aliases={overwatch:'Overwatch 2',tomclancysrainbowsixsiege:'Tom Clancy\'s Rainbow Six Siege X',asphaltlegends:'Asphalt Legends Unite'};
  const term=aliases[normalized]||name;
  try {
    const response=await fetch('https://store.steampowered.com/api/storesearch/?term='+encodeURIComponent(term)+'&l=english&cc=us',{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Store search unavailable.');
    const data=await response.json();
    const exact=(data.items||[]).filter(x=>normalizeName(x.name)===normalizeName(term)||normalizeName(x.name)===normalized);
    const result=exact.length===1?{id:String(exact[0].id),name:exact[0].name,matched:true}:{candidates:(data.items||[]).slice(0,5).map(x=>({id:String(x.id),name:x.name}))};
    saveJson(cacheKey,{at:new Date().toISOString(),result});return result;
  } catch(e) { if(cached)return cached.result;throw e; }
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return fallback; } }
function saveJson(file, data) { const dest = path.join(dataDir, file); fs.writeFileSync(dest+'.tmp', JSON.stringify(data, null, 2)); fs.renameSync(dest+'.tmp', dest); }
let config = readJson('settings.json', { roots: [], manual: [] });
function scan(mode) {
  if (scans.has(mode)) return scans.get(mode);
  const p = new Promise((resolve, reject) => {
    const child=execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'), ['-NoProfile','-NoLogo','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'scan.ps1'),'-Mode',mode,'-ExtraRoots',Buffer.from(JSON.stringify(config.roots)).toString('base64')], {timeout:90000,maxBuffer:16*1024*1024,windowsHide:true}, (err, stdout) => {
      children.delete(child);
      if(err) return reject(new Error('Windows hardware scan could not finish. Try Rescan; some information may be restricted by this PC.'));
      try { const result = JSON.parse(stdout.replace(/^\uFEFF/,'')); if(mode==='games') result.games.push(...config.manual); resolve(result); } catch { reject(new Error('Windows returned an unreadable scan result.')); }
    });
    children.add(child);
  }).finally(()=>scans.delete(mode)); scans.set(mode,p); return p;
}
function plain(html='') { return html.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:li|ul|p|div)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim(); }
async function requirements(id) {
  if(!/^\d{1,10}$/.test(id)) throw new Error('Enter a numeric Steam app ID.');
  const cached = readJson(`steam-${id}.json`, null);
  if(cached && Date.now()-Date.parse(cached.fetchedAt)<7*86400000) return cached;
  if(pending.has(id)) return pending.get(id);
  const p=(async()=>{
    try {
      const r=await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`, {signal:AbortSignal.timeout(18000),headers:{'User-Agent':'LocalPCRadar/1.0'}});
      if(!r.ok) throw new Error(`Steam returned ${r.status}`);
      const json=await r.json(); const d=json[id]?.data;
      if(!json[id]?.success || !d) throw new Error('No public Steam listing found for this ID.');
      const result={id,name:d.name,type:d.type,minimum:plain(d.pc_requirements?.minimum),recommended:plain(d.pc_requirements?.recommended),source:`https://store.steampowered.com/app/${id}/`,fetchedAt:new Date().toISOString()};
      saveJson(`steam-${id}.json`,result); return result;
    } catch(e) { if(cached) return {...cached,stale:true,warning:'Offline: showing previously retrieved requirements.'}; throw new Error('Requirements unavailable. '+e.message); }
  })().finally(()=>pending.delete(id)); pending.set(id,p); return p;
}
const catalog=[['1091500','Cyberpunk 2077'],['1245620','ELDEN RING'],['1086940',"Baldur’s Gate 3"],['1174180','Red Dead Redemption 2'],['990080','Hogwarts Legacy'],['1716740','Starfield'],['2358720','Black Myth: Wukong'],['553850','HELLDIVERS 2'],['271590','Grand Theft Auto V Legacy'],['3240220','Grand Theft Auto V Enhanced'],['730','Counter-Strike 2'],['1172470','Apex Legends'],['1145360','Hades'],['413150','Stardew Valley'],['1623730','Palworld'],['1551360','Forza Horizon 5']].map(([id,name])=>({id,name,platform:'Steam',catalog:true}));
async function body(req) { let text=''; for await(const chunk of req) { text+=chunk; if(text.length>32768) throw new Error('Request too large.'); } return JSON.parse(text||'{}'); }
function send(res,status,data,type='application/json; charset=utf-8') {res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
const server=http.createServer(async(req,res)=>{
  const activePort=server.address()?.port||PORT;
  if(![`127.0.0.1:${activePort}`,`localhost:${activePort}`].includes(req.headers.host)) return send(res,403,{error:'Local requests only.'});
  if(req.headers.origin && ![`http://127.0.0.1:${activePort}`,`http://localhost:${activePort}`].includes(req.headers.origin)) return send(res,403,{error:'Origin not allowed.'});
  if(req.headers['sec-fetch-site']==='cross-site') return send(res,403,{error:'Cross-site requests blocked.'});
  try {
    const url=new URL(req.url,origin);
    if(req.method==='POST') {
      if(req.headers['x-radar-token']!==token) return send(res,403,{error:'Reload Radar and try again.'});
      if(url.pathname==='/api/exit' && portable){send(res,200,{ok:true});setTimeout(()=>{for(const child of children)child.kill();server.close();process.exit(0)},200);return;}
      if(url.pathname==='/api/reset') {
        if(scans.size||pending.size) return send(res,409,{error:'Wait for the current scan and checks to finish, then reset.'});
        for(const file of fs.readdirSync(dataDir))if(/^(?:settings|benchmarks|steam-\d+|match-[a-f0-9]+)\.json$/.test(file))fs.unlinkSync(path.join(dataDir,file));
        config={roots:[],manual:[]};saveJson('settings.json',config);return send(res,200,{ok:true});
      }
      if(url.pathname==='/api/settings') {
        const d=await body(req);
        if(!Array.isArray(d.roots)||d.roots.length>12||d.roots.some(p=>typeof p!=='string'||! /^[a-zA-Z]:\\/.test(p)||p.length>260)) return send(res,400,{error:'Use up to 12 absolute local folders, such as D:\\Games.'});
        config.roots=d.roots; saveJson('settings.json',config); return send(res,200,config);
      }
      if(url.pathname==='/api/manual') {
        const d=await body(req);
        if(typeof d.name!=='string'||!d.name.trim()||d.name.length>150||!/^(\d{1,10})?$/.test(d.id||'')) return send(res,400,{error:'Enter a game name and optional numeric Steam app ID.'});
        if(config.manual.length>=200) return send(res,400,{error:'Manual game limit reached.'});
        const game={name:d.name.trim(),id:d.id||'',platform:'Manual',path:'',size:0,evidence:'User-added',key:crypto.randomUUID()};
        config.manual.push(game);saveJson('settings.json',config);return send(res,200,game);
      }
      if(url.pathname==='/api/remove-manual') { const d=await body(req); config.manual=config.manual.filter(g=>g.key!==d.key);saveJson('settings.json',config);return send(res,200,{ok:true}); }
      return send(res,404,{error:'Unknown action.'});
    }
    if(req.method!=='GET') return send(res,405,{error:'Method not allowed.'});
    if(url.pathname==='/api/benchmarks') return send(res,200,await database());
    if(url.pathname==='/api/health') return send(res,200,{app:'PC Radar',instance});
    if(url.pathname==='/api/bootstrap') return send(res,200,{token,config,catalog,portable,dataDir});
    if(url.pathname==='/api/system') return send(res,200,await scan('system'));
    if(url.pathname==='/api/games') return send(res,200,await scan('games'));
    if(url.pathname==='/api/resolve') return send(res,200,await resolveGame(url.searchParams.get('name')));
    if(url.pathname==='/api/requirements') return send(res,200,await requirements(url.searchParams.get('id')||''));
    const files={'/':'index.html','/app.js':'app.js','/analysis.js':'analysis.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
    if(!files[url.pathname]) return send(res,404,'Not found','text/plain');
    const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    return send(res,200,fs.readFileSync(path.join(publicDir,files[url.pathname])),types[path.extname(files[url.pathname])]);
  } catch(e) {return send(res,500,{error:e.message});}
});
if(require.main===module){
 const ready=()=>{const port=server.address().port;origin=`http://127.0.0.1:${port}`;if(portable)saveJson('runtime.json',{port,instance});console.log(`PC Radar ready at ${origin}`)};
 server.on('error',e=>{if(portable&&e.code==='EADDRINUSE'){server.listen(0,'127.0.0.1',ready)}else{console.error('PC Radar could not start: '+e.code);process.exitCode=1}});
 server.listen(PORT,'127.0.0.1',ready);
}
module.exports={plain,server};
