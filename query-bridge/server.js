const http = require('node:http');
const dgram = require('node:dgram');

const HOST = process.env.SCUM_HOST || '176.57.174.127';
const PRIMARY_PORT = Number(process.env.SCUM_QUERY_PORT || '28215');
const FALLBACK_PORTS = String(process.env.SCUM_QUERY_FALLBACK_PORTS || '')
  .split(',').map(v => Number(v.trim())).filter(Number.isInteger).filter(v => v > 0 && v <= 65535);
const QUERY_PORTS = [...new Set([PRIMARY_PORT, ...FALLBACK_PORTS])];
const BRIDGE_PORT = Number(process.env.PORT || '8787');
const BRIDGE_KEY = process.env.BRIDGE_KEY || '';
const REQUIRE_KEY = process.env.REQUIRE_KEY !== 'false';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const TIMEOUT_MS = Math.max(1000, Number(process.env.QUERY_TIMEOUT_MS || '3000'));

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO_REQUEST = Buffer.concat([HEADER, Buffer.from([0x54]), Buffer.from('Source Engine Query\0', 'ascii')]);

function cstring(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end < 0) throw new Error('Invalid A2S string');
  return { value: buf.toString('utf8', offset, end), next: end + 1 };
}
function u8(buf, o) { return { value: buf.readUInt8(o), next: o + 1 }; }
function u16(buf, o) { return { value: buf.readUInt16LE(o), next: o + 2 }; }
function i32(buf, o) { return { value: buf.readInt32LE(o), next: o + 4 }; }
function f32(buf, o) { return { value: buf.readFloatLE(o), next: o + 4 }; }

function parseInfo(packet) {
  if (packet.length < 6 || packet.readInt32LE(0) !== -1) throw new Error('Invalid A2S header');
  const type = packet.readUInt8(4);
  if (type === 0x41) return { challenge: packet.readInt32LE(5) };
  if (type !== 0x49) throw new Error(`Unsupported A2S_INFO response type 0x${type.toString(16)}`);

  let o = 5, r;
  r = u8(packet,o); const protocol=r.value; o=r.next;
  r = cstring(packet,o); const name=r.value; o=r.next;
  r = cstring(packet,o); const map=r.value; o=r.next;
  r = cstring(packet,o); const folder=r.value; o=r.next;
  r = cstring(packet,o); const game=r.value; o=r.next;
  r = u16(packet,o); const appId=r.value; o=r.next;
  r = u8(packet,o); const players=r.value; o=r.next;
  r = u8(packet,o); const maxPlayers=r.value; o=r.next;
  r = u8(packet,o); const bots=r.value; o=r.next;
  r = u8(packet,o); const serverType=r.value; o=r.next;
  r = u8(packet,o); const environment=r.value; o=r.next;
  r = u8(packet,o); const visibility=r.value; o=r.next;
  r = u8(packet,o); const vac=r.value; o=r.next;
  r = cstring(packet,o); const version=r.value; o=r.next;
  return { protocol,name,map,folder,game,appId,players,maxPlayers,bots,serverType,environment,visibility,vac,version };
}

function parsePlayers(packet) {
  if (packet.length < 6 || packet.readInt32LE(0) !== -1) throw new Error('Invalid A2S_PLAYER header');
  const type = packet.readUInt8(4);
  if (type === 0x41) return { challenge: packet.readInt32LE(5) };
  if (type !== 0x44) throw new Error(`Unsupported A2S_PLAYER response type 0x${type.toString(16)}`);
  let o=5;
  const count=packet.readUInt8(o++);
  const players=[];
  for(let i=0;i<count && o<packet.length;i++){
    if(o+1>packet.length) break;
    const index=packet.readUInt8(o++);
    const n=cstring(packet,o); o=n.next;
    if(o+8>packet.length) break;
    const score=packet.readInt32LE(o); o+=4;
    const duration=packet.readFloatLE(o); o+=4;
    players.push({ index, name:n.value, score, duration });
  }
  return { count:players.length, players };
}

function udpRequest(port, buildPacket, parsePacket) {
  return new Promise((resolve,reject)=>{
    const socket=dgram.createSocket('udp4');
    let timer=null, challenge=null, tries=0;
    const cleanup=()=>{ if(timer) clearTimeout(timer); try{socket.close();}catch{} };
    const send=()=>{
      const packet=buildPacket(challenge);
      socket.send(packet,0,packet.length,port,HOST,(err)=>{ if(err){cleanup();reject(err);} });
    };
    socket.on('message',(msg)=>{
      try{
        const parsed=parsePacket(msg);
        if(parsed.challenge!==undefined){
          challenge=parsed.challenge;
          if(++tries>2) throw new Error('A2S challenge loop');
          send();
          return;
        }
        cleanup(); resolve(parsed);
      }catch(err){cleanup();reject(err);}
    });
    socket.on('error',(err)=>{cleanup();reject(err);});
    timer=setTimeout(()=>{cleanup();reject(new Error(`UDP timeout ${TIMEOUT_MS}ms`));},TIMEOUT_MS);
    socket.bind(0,send);
  });
}

function info(port){
  const started=Date.now();
  return udpRequest(port,(challenge)=> challenge===null ? INFO_REQUEST : Buffer.concat([INFO_REQUEST,Buffer.from([challenge&255,(challenge>>8)&255,(challenge>>16)&255,(challenge>>24)&255])]),parseInfo)
    .then(data=>({data,ping:Date.now()-started,port}));
}
function players(port){
  return udpRequest(port,(challenge)=>{
    const c=challenge===null ? -1 : challenge;
    const b=Buffer.alloc(4); b.writeInt32LE(c,0);
    return Buffer.concat([HEADER,Buffer.from([0x55]),b]);
  },parsePlayers).then(x=>x.players||[]);
}

async function query(){
  const attempts=await Promise.all(QUERY_PORTS.map(async port=>{
    try{return {ok:true,port,result:await info(port)};}catch(error){return {ok:false,port,error:String(error.message||error)};}
  }));
  const winner=attempts.find(x=>x.ok);
  if(!winner) return {ok:false,attempts};
  let livePlayers=[];
  try{ livePlayers=await players(winner.port); }catch{}
  const infoData=winner.result.data;
  return {
    ok:true,
    queryPort:winner.port,
    server:{
      online:true,
      name:infoData.name,
      map:infoData.map || null,
      version:infoData.version || null,
      players:infoData.players,
      maxPlayers:infoData.maxPlayers,
      ping:winner.result.ping
    },
    players:livePlayers,
    attempts:attempts.map(x=>({port:x.port,ok:x.ok,error:x.ok?null:x.error}))
  };
}

function headers(){return {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Access-Control-Allow-Origin':ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type, X-Shadow-Forge-Key'
};}
function send(res,status,body){res.writeHead(status,headers());res.end(JSON.stringify(body));}
function auth(req){return !REQUIRE_KEY || (!!BRIDGE_KEY && req.headers['x-shadow-forge-key']===BRIDGE_KEY);}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,headers());return res.end();}
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname==='/health') return send(res,200,{ok:true,service:'shadow-forge-scum-query-bridge',timestamp:new Date().toISOString()});
  if(url.pathname!=='/query'||req.method!=='GET') return send(res,404,{ok:false,error:'Not found'});
  if(!auth(req)) return send(res,401,{ok:false,error:'Unauthorized'});
  try{
    const started=Date.now();
    const result=await query();
    if(!result.ok) return send(res,200,{ok:false,source:'SCUM A2S / Source Query',responseMs:Date.now()-started,server:null,players:[],attempts:result.attempts});
    return send(res,200,{ok:true,source:'SCUM A2S / Source Query',responseMs:Date.now()-started,server:result.server,players:result.players});
  }catch(error){return send(res,200,{ok:false,error:String(error.message||error),server:null,players:[]});}
});

server.listen(BRIDGE_PORT,'0.0.0.0',()=>{
  console.log(`Shadow Forge Query Bridge listening on :${BRIDGE_PORT}`);
  console.log(`SCUM target: ${HOST}; query ports: ${QUERY_PORTS.join(', ')}`);
});
