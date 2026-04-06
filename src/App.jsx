import { useState, useCallback, useRef, useEffect } from "react";
// Report generator loaded on demand (see generateReport function)

const T = {
  bg:"#05080E",surface:"#090D18",panel:"#0C1220",card:"#0F1628",
  border:"#141F33",borderHi:"#1C2D47",
  accent:"#00B8E8",accentLo:"#006E8A",accentHi:"#33CCFF",
  green:"#00D98A",yellow:"#F0C040",orange:"#FF8500",red:"#FF2D55",
  purple:"#9B6DFF",teal:"#00E5CC",pink:"#FF6EB4",
  text:"#C8DEFF",mid:"#567090",dim:"#243550",
  mono:"'JetBrains Mono','Fira Code',monospace",
};

// ── Supabase client ───────────────────────────────────────────────────────────
class SB {
  constructor(url,key){this.url=url?.replace(/\/$/,"")||"";this.key=key||"";this.token=null;}
  h(x={}){return{"Content-Type":"application/json",apikey:this.key,Authorization:`Bearer ${this.token||this.key}`,...x};}
  async signIn(email,password){
    const r=await fetch(`${this.url}/auth/v1/token?grant_type=password`,{method:"POST",headers:{"Content-Type":"application/json",apikey:this.key},body:JSON.stringify({email,password})});
    const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.msg||"Login failed");
    this.token=d.access_token;return{user:d.user,token:d.access_token,refreshToken:d.refresh_token};
  }
  async signOut(){await fetch(`${this.url}/auth/v1/logout`,{method:"POST",headers:this.h()}).catch(()=>{});this.token=null;}
  async setPassword(tok,pwd){
    const r=await fetch(`${this.url}/auth/v1/user`,{method:"PUT",headers:{"Content-Type":"application/json",apikey:this.key,Authorization:`Bearer ${tok}`},body:JSON.stringify({password:pwd})});
    const d=await r.json();if(!r.ok)throw new Error(d.message||"Password update failed");return d;
  }
  async refresh(rt){
    const r=await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{"Content-Type":"application/json",apikey:this.key},body:JSON.stringify({refresh_token:rt})});
    const d=await r.json();if(!r.ok)throw new Error("Session refresh failed");this.token=d.access_token;return d;
  }
  async rpc(fn,params={}){
    const r=await fetch(`${this.url}/rest/v1/rpc/${fn}`,{method:"POST",headers:this.h({"Prefer":"return=representation"}),body:JSON.stringify(params)});
    if(!r.ok){const e=await r.json();throw new Error(e.message||`RPC ${fn} failed`);}
    return r.json();
  }
  async select(table,params={}){
    const q=new URLSearchParams();
    if(params.filter)Object.entries(params.filter).forEach(([k,v])=>q.set(k,`eq.${v}`));
    if(params.order)q.set("order",params.order);
    if(params.limit)q.set("limit",params.limit);
    if(params.select)q.set("select",params.select);
    const r=await fetch(`${this.url}/rest/v1/${table}?${q}`,{headers:this.h({"Prefer":"return=representation"})});
    if(!r.ok){const e=await r.json();throw new Error(e.message||`Select failed: ${table}`);}
    return r.json();
  }
  async upsert(table,data,conflict=""){
    const q=conflict?`?on_conflict=${encodeURIComponent(conflict)}`:"";
    const r=await fetch(`${this.url}/rest/v1/${table}${q}`,{method:"POST",headers:this.h({"Prefer":`resolution=merge-duplicates,return=representation`}),body:JSON.stringify(data)});
    if(!r.ok){const e=await r.json();throw new Error(e.message||`Upsert failed: ${table}`);}
    return r.json();
  }
  async insert(table,data){
    const r=await fetch(`${this.url}/rest/v1/${table}`,{method:"POST",headers:this.h({"Prefer":"return=representation"}),body:JSON.stringify(data)});
    if(!r.ok){const e=await r.json();throw new Error(e.message||`Insert failed: ${table}`);}
    return r.json();
  }
  async update(table,data,filter){
    const q=new URLSearchParams();Object.entries(filter).forEach(([k,v])=>q.set(k,`eq.${v}`));
    const r=await fetch(`${this.url}/rest/v1/${table}?${q}`,{method:"PATCH",headers:this.h({"Prefer":"return=representation"}),body:JSON.stringify(data)});
    if(!r.ok){const e=await r.json();throw new Error(e.message||`Update failed: ${table}`);}
    return r.json();
  }
  isConfigured(){return!!(this.url&&this.key&&this.url.includes("supabase.co"));}
}

const sb=new SB(import.meta.env.VITE_SUPABASE_URL||"",import.meta.env.VITE_SUPABASE_ANON_KEY||"");
const ls={get:(k)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null;}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}},del:(k)=>{try{localStorage.removeItem(k);}catch{}},};

// ── Databases ─────────────────────────────────────────────────────────────────
const DEFI={
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b":{label:"Tornado Cash",risk:98,cat:"MIXER",protocol:"Tornado Cash"},
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf":{label:"Tornado Cash 10 ETH",risk:98,cat:"MIXER",protocol:"Tornado Cash"},
  "0xa160cdab225685da1d56aa342ad8841c3b53f291":{label:"Tornado Cash 100 ETH",risk:98,cat:"MIXER",protocol:"Tornado Cash"},
  "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936":{label:"Tornado Cash 1 ETH",risk:98,cat:"MIXER",protocol:"Tornado Cash"},
  "0x722122df12d4e14e13ac3b6895a86e84145b6967":{label:"Tornado Cash Proxy",risk:98,cat:"MIXER",protocol:"Tornado Cash"},
  "0x7f268357a8c2552623316e2562d90e642bb538e5":{label:"Blender.io",risk:100,cat:"MIXER",protocol:"Blender"},
  "0x9ad122c22b14202b4490edaf288fdb3c7cb3ff5e":{label:"Ronin Bridge (Hacked)",risk:95,cat:"HACKED_BRIDGE",protocol:"Ronin"},
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d":{label:"Uniswap V2",risk:8,cat:"DEFI",protocol:"Uniswap"},
  "0xe592427a0aece92de3edee1f18e0157c05861564":{label:"Uniswap V3",risk:8,cat:"DEFI",protocol:"Uniswap"},
  "0x1111111254eeb25477b68fb85ed929f73a960582":{label:"1inch",risk:8,cat:"DEFI",protocol:"1inch"},
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84":{label:"Lido stETH",risk:5,cat:"DEFI",protocol:"Lido"},
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2":{label:"Aave V3",risk:8,cat:"DEFI",protocol:"Aave"},
  "0xdac17f958d2ee523a2206206994597c13d831ec7":{label:"USDT ERC-20",risk:2,cat:"STABLECOIN",protocol:"Tether"},
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48":{label:"USDC ERC-20",risk:2,cat:"STABLECOIN",protocol:"Circle"},
  "0x6b175474e89094c44da98b954eedeac495271d0f":{label:"DAI",risk:2,cat:"STABLECOIN",protocol:"MakerDAO"},
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t":{label:"USDT TRC-20",risk:2,cat:"STABLECOIN",protocol:"Tether"},
};
const EX={
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be":{label:"Binance",risk:5,cat:"EXCHANGE"},
  "0xd551234ae421e3bcba99a0da6d736074f22192ff":{label:"Binance Cold",risk:3,cat:"EXCHANGE"},
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43":{label:"Coinbase Prime",risk:5,cat:"EXCHANGE"},
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3":{label:"Coinbase",risk:5,cat:"EXCHANGE"},
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3":{label:"OKX",risk:8,cat:"EXCHANGE"},
  "0xf60c2ea62edbfe808163751dd0d8693dcb30019c":{label:"Kraken",risk:5,cat:"EXCHANGE"},
  "0xab5c66752a9e8167967685f1450532fb96d5d24f":{label:"Huobi",risk:12,cat:"EXCHANGE"},
  "1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s":{label:"Binance BTC",risk:5,cat:"EXCHANGE"},
  "TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe":{label:"Binance TRON",risk:5,cat:"EXCHANGE"},
};
const SDN={
  "0x7f367cc41522ce07553e823bf3be79a889debe1b":{label:"Lazarus Group",risk:100,cat:"SANCTIONS"},
  "0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b":{label:"OFAC SDN",risk:100,cat:"SANCTIONS"},
  "12t9YDPgwueZ9NyMgw519p7AA8isjr6SMw":{label:"WannaCry",risk:100,cat:"RANSOMWARE"},
  "115p7UMMngoj1pMvkpHijcRdfJNXj6LrLn":{label:"WannaCry",risk:100,cat:"RANSOMWARE"},
  "1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx":{label:"Hydra Market",risk:95,cat:"DARKNET"},
  "TXmVpin5vgWZNu7sN4rKMmHtGrHBMqNxAn":{label:"Garantex TRX",risk:100,cat:"SANCTIONS"},
};
const WL=new Set(["0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be","0xd551234ae421e3bcba99a0da6d736074f22192ff","0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43","0x71660c4005ba85c37ccec55d0c4493e66fe775d3","1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s","TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe"]);
const OFAC={addresses:{},lastFetch:0,count:0,status:"idle"};
const HD=[1.0,0.40,0.16,0.064,0.026,0.010];

function lkp(addr){if(!addr)return null;const a=addr.toLowerCase?.();return OFAC.addresses[a]||OFAC.addresses[addr]||SDN[a]||SDN[addr]||DEFI[a]||DEFI[addr]||EX[a]||EX[addr]||null;}
function isWL(addr){return WL.has(addr?.toLowerCase())||WL.has(addr);}
function chain(a){
  const s=a?.trim()||"";
  if(/^(1|3)[A-HJ-NP-Za-km-z1-9]{25,34}$/.test(s)||/^bc1[a-zA-HJ-NP-Z0-9]{6,87}$/.test(s))return"BTC";
  if(/^0x[a-fA-F0-9]{40}$/.test(s))return"ETH";
  if(/^T[A-HJ-NP-Za-km-z1-9]{33}$/.test(s))return"TRX";
  if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s))return"SOL";
  return"UNKNOWN";
}

// ── OFAC feed ─────────────────────────────────────────────────────────────────
async function fetchOFAC(push){
  if(Date.now()-OFAC.lastFetch<3600000&&OFAC.lastFetch>0)return;
  push&&push("Fetching OFAC SDN live feed…");
  try{
    const r=await fetch("/api/ofac",{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    if(d.error)throw new Error(d.error);
    Object.assign(OFAC.addresses,d.addresses);
    OFAC.lastFetch=Date.now();OFAC.count=d.count||0;OFAC.status="ok";
    push&&push(`✓ OFAC: ${Math.round(d.count)} addresses loaded`);
  }catch(e){OFAC.status="static";push&&push("⚠ OFAC live feed unavailable — static baseline active");}
}

// ── Blockchain fetchers ───────────────────────────────────────────────────────
async function withFallback(fns,push){
  for(let i=0;i<fns.length;i++){
    try{push&&push(`  → ${fns[i].name}${i>0?" (fallback)":""}`);const r=await fns[i].fn();return{...r,_src:fns[i].name};}
    catch(e){push&&push(`  ✗ ${fns[i].name}: ${e.message}`);if(i===fns.length-1)throw e;}
  }
}
async function fetchBTC(addr,push){return withFallback([{name:"Blockstream",fn:()=>_btcBS(addr)},{name:"Mempool.space",fn:()=>_btcMP(addr)}],push);}
async function fetchETH(addr,key,push){return withFallback([{name:"Etherscan",fn:()=>_ethES(addr,key)},{name:"Blockscout",fn:()=>_ethBC(addr)}],push);}
async function fetchTRX(addr,push){return withFallback([{name:"Tronscan",fn:()=>_trxTS(addr)},{name:"TronGrid",fn:()=>_trxTG(addr)}],push);}
async function fetchSOL(addr,push,solscanKey){
  return withFallback([
    // Solscan REST API — better data, requires free key
    ...(solscanKey?[{name:"Solscan",fn:()=>_solSolscan(addr,solscanKey)}]:[]),
    {name:"Solana RPC",fn:()=>_solRPC(addr,"https://api.mainnet-beta.solana.com")},
    {name:"Solana Ankr",fn:()=>_solRPC(addr,"https://rpc.ankr.com/solana")},
  ],push);
}

async function _solSolscan(addr,key){
  const headers={"token":key,"Accept":"application/json"};
  const [accR,txR]=await Promise.all([
    fetch(`https://pro-api.solscan.io/v2.0/account/${addr}`,{headers,signal:AbortSignal.timeout(8000)}),
    fetch(`https://pro-api.solscan.io/v2.0/account/transactions?address=${addr}&limit=20`,{headers,signal:AbortSignal.timeout(8000)}),
  ]);
  if(!accR.ok)throw new Error(`Solscan HTTP ${accR.status}`);
  const ad=await accR.json(),txd=txR.ok?await txR.json():{data:[]};
  const txs=txd.data||[];
  const cps=[];const seen=new Set();
  for(const tx of txs.slice(0,15)){
    const peers=[tx.signer,...(tx.tokenTransfers||[]).map(t=>t.sourceOwner||t.destinationOwner)].filter(Boolean);
    for(const p of peers){
      if(p===addr||seen.has(p))continue;seen.add(p);
      const k=lookupAll(p);
      cps.push({address:p,amount:"—",label:k?.label||"Unknown",cat:k?.cat||"WALLET",knownRisk:k?.risk??null,direction:"—",hop:0});
    }
  }
  const balance=((ad.data?.lamports||0)/1e9).toFixed(6)+" SOL";
  return{balance,txCount:ad.data?.txCount||txs.length,firstSeen:"Unknown",counterparties:cps,tokenActivity:[],coSpendCount:0,changeAddresses:[]};
}

async function _btcBS(addr){const[aR,tR]=await Promise.all([fetch(`https://blockstream.info/api/address/${addr}`,{signal:AbortSignal.timeout(8000)}),fetch(`https://blockstream.info/api/address/${addr}/txs`,{signal:AbortSignal.timeout(8000)})]);if(!aR.ok)throw new Error(`HTTP ${aR.status}`);return _parseBTC(addr,await aR.json(),tR.ok?await tR.json():[]);}
async function _btcMP(addr){const[aR,tR]=await Promise.all([fetch(`https://mempool.space/api/address/${addr}`,{signal:AbortSignal.timeout(8000)}),fetch(`https://mempool.space/api/address/${addr}/txs`,{signal:AbortSignal.timeout(8000)})]);if(!aR.ok)throw new Error(`HTTP ${aR.status}`);return _parseBTC(addr,await aR.json(),tR.ok?await tR.json():[]);}
function _parseBTC(addr,ad,txs){
  const co=new Set();const cps=[];const ca=[];
  for(const tx of txs.slice(0,15)){
    if(tx.vin?.length>1)tx.vin.forEach(i=>i.prevout?.scriptpubkey_address&&co.add(i.prevout.scriptpubkey_address));
    const chg=(tx.vout||[]).filter(o=>o.value&&o.value%1000000!==0);
    chg.forEach(o=>{if(o.scriptpubkey_address&&o.scriptpubkey_address!==addr)ca.push(o.scriptpubkey_address);});
    (tx.vout||[]).forEach(o=>{if(o.scriptpubkey_address&&o.scriptpubkey_address!==addr){const k=lkp(o.scriptpubkey_address);cps.push({address:o.scriptpubkey_address,amount:(o.value/1e8).toFixed(8)+" BTC",label:k?.label||"Unknown",cat:k?.cat||"UNKNOWN",knownRisk:k?.risk??null,direction:"OUT",hop:0});}});
    tx.vin?.forEach(i=>{const a=i.prevout?.scriptpubkey_address;if(a&&a!==addr){const k=lkp(a);cps.push({address:a,amount:((i.prevout?.value||0)/1e8).toFixed(8)+" BTC",label:k?.label||"Unknown",cat:k?.cat||"UNKNOWN",knownRisk:k?.risk??null,direction:"IN",hop:0});}});
  }
  const first=txs[txs.length-1];
  return{balance:((ad.chain_stats?.funded_txo_sum-ad.chain_stats?.spent_txo_sum||0)/1e8).toFixed(8)+" BTC",txCount:ad.chain_stats?.tx_count||0,firstSeen:first?.status?.block_time?new Date(first.status.block_time*1000).toISOString().slice(0,10):"Unknown",counterparties:cps,coSpendCount:co.size,tokenActivity:[],changeAddresses:[...new Set(ca)]};
}
async function _ethES(addr,key){
  const b="https://api.etherscan.io/api",k=key||"YourApiKeyToken";
  const[balR,txR,tokR]=await Promise.all([fetch(`${b}?module=account&action=balance&address=${addr}&tag=latest&apikey=${k}`,{signal:AbortSignal.timeout(8000)}),fetch(`${b}?module=account&action=txlist&address=${addr}&startblock=0&endblock=99999999&page=1&offset=25&sort=desc&apikey=${k}`,{signal:AbortSignal.timeout(8000)}),fetch(`${b}?module=account&action=tokentx&address=${addr}&page=1&offset=25&sort=desc&apikey=${k}`,{signal:AbortSignal.timeout(8000)})]);
  if(!balR.ok)throw new Error(`HTTP ${balR.status}`);
  const bd=await balR.json(),txd=await txR.json(),tokd=await tokR.json();
  const txs=txd.status==="1"?txd.result||[]:[];const toks=tokd.status==="1"?tokd.result||[]:[];
  const fw=[...txs].sort((a,b)=>parseInt(a.timeStamp)-parseInt(b.timeStamp)).find(t=>t.to?.toLowerCase()===addr.toLowerCase())?.from||null;
  const nonces=txs.map(t=>parseInt(t.nonce)).sort((a,b)=>a-b);
  const ng=[];for(let i=1;i<nonces.length;i++){if(nonces[i]-nonces[i-1]>50)ng.push({from:nonces[i-1],to:nonces[i]});}
  const seen=new Set();
  const cps=txs.slice(0,20).map(tx=>{const peer=tx.from?.toLowerCase()===addr.toLowerCase()?tx.to:tx.from;if(!peer||seen.has(peer.toLowerCase()))return null;seen.add(peer.toLowerCase());const k=lkp(peer);return{address:peer,amount:(parseInt(tx.value||0)/1e18).toFixed(6)+" ETH",label:k?.label||(tx.input!=="0x"?"Contract":"Unknown"),cat:k?.cat||(tx.input!=="0x"?"CONTRACT":"UNKNOWN"),knownRisk:k?.risk??null,direction:tx.from?.toLowerCase()===addr.toLowerCase()?"OUT":"IN",hop:0,protocol:k?.protocol||null};}).filter(Boolean);
  const ta=Object.values(toks.reduce((a,t)=>{if(!a[t.tokenSymbol])a[t.tokenSymbol]={symbol:t.tokenSymbol,name:t.tokenName,count:0};a[t.tokenSymbol].count++;return a},{}));
  let cl=null;try{const cr=await fetch(`${b}?module=contract&action=getsourcecode&address=${addr}&apikey=${k}`,{signal:AbortSignal.timeout(5000)});const cd=await cr.json();if(cd.status==="1"&&cd.result?.[0]?.ContractName)cl=cd.result[0].ContractName;}catch(e){}
  const first=txs[txs.length-1];
  return{balance:bd.result?(parseInt(bd.result)/1e18).toFixed(6)+" ETH":"N/A",txCount:txs.length,firstSeen:first?new Date(parseInt(first.timeStamp)*1000).toISOString().slice(0,10):"Unknown",counterparties:cps,tokenActivity:ta,coSpendCount:0,changeAddresses:[],fundingWallet:fw,nonceGaps:ng,contractLabel:cl};
}
async function _ethBC(addr){
  const base="https://eth.blockscout.com/api/v2";
  const[aR,tR]=await Promise.all([fetch(`${base}/addresses/${addr}`,{signal:AbortSignal.timeout(8000)}),fetch(`${base}/addresses/${addr}/transactions?filter=to%20%7C%20from`,{signal:AbortSignal.timeout(8000)})]);
  if(!aR.ok)throw new Error(`HTTP ${aR.status}`);
  const ad=await aR.json(),txd=tR.ok?await tR.json():{};
  const cps=(txd.items||[]).slice(0,15).map(tx=>{const peer=tx.from?.hash?.toLowerCase()===addr.toLowerCase()?tx.to?.hash:tx.from?.hash;const k=lkp(peer);return{address:peer,amount:(parseInt(tx.value||0)/1e18).toFixed(6)+" ETH",label:k?.label||"Unknown",cat:k?.cat||"UNKNOWN",knownRisk:k?.risk??null,direction:tx.from?.hash?.toLowerCase()===addr.toLowerCase()?"OUT":"IN",hop:0};}).filter(c=>c.address);
  return{balance:(parseInt(ad.coin_balance||0)/1e18).toFixed(6)+" ETH",txCount:parseInt(ad.transactions_count||0),firstSeen:"Unknown",counterparties:cps,tokenActivity:[],coSpendCount:0,changeAddresses:[],contractLabel:ad.name||null};
}
async function _trxTS(addr){
const TRON_KEY=import.meta.env.VITE_TRONSCAN_API_KEY||"";
const tronHeaders=TRON_KEY?{"TRON-PRO-API-KEY":TRON_KEY}:{};
const[aR,tR]=await Promise.all([fetch(`https://apilist.tronscanapi.com/api/accountv2?address=${addr}`,{signal:AbortSignal.timeout(8000),headers:tronHeaders}),fetch(`https://apilist.tronscanapi.com/api/transaction?address=${addr}&limit=20&start=0&db_version=1`,{signal:AbortSignal.timeout(8000),headers:tronHeaders})]);  if(!aR.ok)throw new Error(`HTTP ${aR.status}`);
  const ad=await aR.json(),td=tR.ok?await tR.json():{data:[]};
  const txs=td.data||[];const seen=new Set();
  const cps=txs.slice(0,20).map(tx=>{const peer=tx.ownerAddress===addr?tx.toAddress:tx.ownerAddress;if(!peer||seen.has(peer))return null;seen.add(peer);const k=lkp(peer);return{address:peer,amount:((tx.contractData?.amount||0)/1e6).toFixed(4)+" TRX",label:k?.label||"Unknown",cat:k?.cat||"UNKNOWN",knownRisk:k?.risk??null,direction:tx.ownerAddress===addr?"OUT":"IN",hop:0};}).filter(Boolean);
  const first=txs[txs.length-1];
  return{balance:((ad.balance||0)/1e6).toFixed(6)+" TRX",txCount:ad.totalTransactionCount||0,firstSeen:first?new Date(first.timestamp).toISOString().slice(0,10):"Unknown",counterparties:cps,tokenActivity:[],coSpendCount:0,changeAddresses:[]};
}
async function _trxTG(addr){
  const r=await fetch(`https://api.trongrid.io/v1/accounts/${addr}/transactions?limit=20`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const d=await r.json();const txs=d.data||[];
  const cps=txs.slice(0,15).map(tx=>{const c=tx.raw_data?.contract?.[0];const owner=c?.parameter?.value?.owner_address,to=c?.parameter?.value?.to_address;const peer=owner===addr?to:owner;const k=lkp(peer);return{address:peer,amount:((c?.parameter?.value?.amount||0)/1e6).toFixed(4)+" TRX",label:k?.label||"Unknown",cat:k?.cat||"UNKNOWN",knownRisk:k?.risk??null,direction:owner===addr?"OUT":"IN",hop:0};}).filter(c=>c.address);
  return{balance:"N/A",txCount:txs.length,firstSeen:"Unknown",counterparties:cps,tokenActivity:[],coSpendCount:0,changeAddresses:[]};
}
async function _solRPC(addr,rpc){
  const post=b=>fetch(rpc,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b),signal:AbortSignal.timeout(10000)});
  const[sR,bR]=await Promise.all([post({jsonrpc:"2.0",id:1,method:"getSignaturesForAddress",params:[addr,{limit:20}]}),post({jsonrpc:"2.0",id:2,method:"getBalance",params:[addr]})]);
  const sd=await sR.json(),bd=await bR.json();const sigs=sd.result||[];const cps=[];
  for(const sig of sigs.slice(0,3)){try{const txR=await post({jsonrpc:"2.0",id:3,method:"getTransaction",params:[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}]});const txd=await txR.json();(txd.result?.transaction?.message?.accountKeys||[]).forEach(acc=>{const a=acc.pubkey||acc;if(a!==addr){const k=lkp(a);cps.push({address:a,amount:"—",label:k?.label||(acc.signer?"Signer":"Program"),cat:k?.cat||(acc.signer?"WALLET":"PROGRAM"),knownRisk:k?.risk??null,direction:"—",hop:0});}});}catch(e){}}
  const first=sigs[sigs.length-1];
  return{balance:((bd.result?.value||0)/1e9).toFixed(6)+" SOL",txCount:sigs.length,firstSeen:first?new Date(first.blockTime*1000).toISOString().slice(0,10):"Unknown",counterparties:cps,tokenActivity:[],coSpendCount:0,changeAddresses:[]};
}

async function multiHop(root,ch,cps,maxH,key,push,onUpdate){
  const graph=new Map();const visited=new Set([root.toLowerCase()]);const queue=[];
  for(const cp of cps.slice(0,8)){if(!cp.address||visited.has(cp.address.toLowerCase()))continue;visited.add(cp.address.toLowerCase());const node={...cp,hop:1,propagatedRisk:(cp.knownRisk||0)*HD[1]};graph.set(cp.address,node);if((cp.knownRisk!==null&&cp.knownRisk>30)||cp.cat==="UNKNOWN"||cp.cat==="MIXER")queue.push({address:cp.address,hop:1});}
  for(let hop=2;hop<=maxH&&queue.length>0;hop++){
    const level=queue.splice(0,Math.min(queue.length,3));push&&push(`Hop ${hop}/${maxH}: scanning ${level.length} nodes…`);
    for(const{address,hop:ph}of level){if(ph>=maxH)continue;try{await new Promise(r=>setTimeout(r,350));let hd;if(ch==="BTC")hd=await _btcBS(address).catch(()=>null);else if(ch==="ETH")hd=await _ethES(address,key).catch(()=>null);else if(ch==="TRX")hd=await _trxTS(address).catch(()=>null);if(!hd)continue;for(const cp of(hd.counterparties||[]).slice(0,5)){if(!cp.address||visited.has(cp.address.toLowerCase()))continue;visited.add(cp.address.toLowerCase());const decay=HD[hop]||0.01;const node={...cp,hop,propagatedRisk:(cp.knownRisk||0)*decay,parentAddress:address};graph.set(cp.address,node);if(node.propagatedRisk>3||cp.cat==="MIXER"||cp.cat==="SANCTIONS")queue.push({address:cp.address,hop});}}catch(e){}}
    onUpdate&&onUpdate(hop,[...graph.values()]);
  }
  return[...graph.values()];
}

function scoreWallet(addr,ch,data,hopNodes){
  const direct=lkp(addr);
  if(direct){const s={sanctionsExposure:0,darknetExposure:0,mixerTumblerUsage:0,stolenFundsRisk:0,ransomwareExposure:0,scamExposure:0,peerToPeerExposure:0,exchangeRisk:0};const m={SANCTIONS:"sanctionsExposure",DARKNET:"darknetExposure",MIXER:"mixerTumblerUsage",RANSOMWARE:"ransomwareExposure",HACKED_BRIDGE:"stolenFundsRisk",EXCHANGE:"exchangeRisk"};if(m[direct.cat])s[m[direct.cat]]=direct.risk;return{overallScore:direct.risk,signals:s,entity:direct.label,directMatch:true,entitySource:"DB_MATCH"};}
  if(isWL(addr))return{overallScore:5,signals:{sanctionsExposure:0,darknetExposure:0,mixerTumblerUsage:0,stolenFundsRisk:0,ransomwareExposure:0,scamExposure:0,peerToPeerExposure:0,exchangeRisk:5},entity:"Verified Exchange",directMatch:false,entitySource:"WHITELIST"};
  const{counterparties=[],txCount=0,coSpendCount=0,changeAddresses=[],fundingWallet,nonceGaps=[],contractLabel}=data;
  const all=[...counterparties,...(hopNodes||[])];
  const sig={sanctionsExposure:0,darknetExposure:0,mixerTumblerUsage:0,stolenFundsRisk:0,ransomwareExposure:0,scamExposure:0,peerToPeerExposure:0,exchangeRisk:0};
  for(const cp of all){if(cp.knownRisk===null||cp.knownRisk===undefined)continue;const d=HD[cp.hop||0]||0.01;const p=cp.knownRisk*d;if(cp.cat==="SANCTIONS")sig.sanctionsExposure=Math.max(sig.sanctionsExposure,p);else if(cp.cat==="DARKNET")sig.darknetExposure=Math.max(sig.darknetExposure,p);else if(cp.cat==="MIXER")sig.mixerTumblerUsage=Math.max(sig.mixerTumblerUsage,p);else if(cp.cat==="RANSOMWARE")sig.ransomwareExposure=Math.max(sig.ransomwareExposure,p);else if(cp.cat==="HACKED_BRIDGE")sig.stolenFundsRisk=Math.max(sig.stolenFundsRisk,p);else if(cp.cat==="EXCHANGE")sig.exchangeRisk=Math.max(sig.exchangeRisk,cp.knownRisk*d*0.1);}
  if(ch==="BTC"&&coSpendCount>10)sig.exchangeRisk=Math.min(40,coSpendCount*1.5);
  for(const ca of changeAddresses.slice(0,5)){const k=lkp(ca);if(k&&k.risk>50)sig.mixerTumblerUsage=Math.max(sig.mixerTumblerUsage,k.risk*0.3);}
  if(fundingWallet){const k=lkp(fundingWallet);if(k&&k.risk>50)sig.sanctionsExposure=Math.max(sig.sanctionsExposure,k.risk*0.35);}
  if(nonceGaps?.length>0)sig.scamExposure=Math.min(30,nonceGaps.length*10);
  if(txCount>5000)sig.peerToPeerExposure=Math.min(55,txCount/120);else if(txCount>500)sig.peerToPeerExposure=Math.min(25,txCount/50);
  const dom=counterparties.reduce((a,c)=>{a[c.cat]=(a[c.cat]||0)+1;return a},{});
  if((dom.EXCHANGE||0)>counterparties.length*0.5)sig.peerToPeerExposure=0;
  const ur=counterparties.filter(c=>c.cat==="UNKNOWN").length/Math.max(counterparties.length,1);
  if(ur>0.8&&counterparties.length>3)sig.peerToPeerExposure=Math.max(sig.peerToPeerExposure,18);
  const w={sanctionsExposure:0.28,darknetExposure:0.20,mixerTumblerUsage:0.15,stolenFundsRisk:0.12,ransomwareExposure:0.10,scamExposure:0.07,peerToPeerExposure:0.05,exchangeRisk:0.03};
  const overallScore=Math.min(100,Math.round(Object.entries(w).reduce((s,[k,v])=>s+(sig[k]||0)*v,0)));
  const tc=Object.entries(dom).sort((a,b)=>b[1]-a[1])[0]?.[0]||"UNKNOWN";
  const eMap={EXCHANGE:"Centralized Exchange",DEFI:"DeFi Protocol",CONTRACT:"Smart Contract",STABLECOIN:"Stablecoin Contract",MIXER:"Mixing Service",DARKNET:"Darknet Entity",SANCTIONS:"Sanctioned Entity",WALLET:"Self-Custody Wallet",PROGRAM:"On-Chain Program",UNKNOWN:"Unhosted Wallet"};
  return{overallScore,signals:sig,entity:contractLabel||eMap[tc]||"Unhosted Wallet",directMatch:false,entitySource:contractLabel?"CONTRACT_LABEL":"HEURISTIC"};
}

function analyzeDiff(older,newer){
  if(!older||!newer)return null;
  const changes=[];const scoreDelta=newer.overallScore-older.overallScore;
  if(Math.abs(scoreDelta)>0)changes.push({type:scoreDelta>0?"ESCALATION":"IMPROVEMENT",field:"Risk Score",from:older.overallScore,to:newer.overallScore,delta:scoreDelta,severity:Math.abs(scoreDelta)>=15?"HIGH":Math.abs(scoreDelta)>=5?"MEDIUM":"LOW"});
  for(const k of Object.keys(newer.signals||{})){const ov=Math.round(older.signals?.[k]||0),nv=Math.round(newer.signals?.[k]||0),d=nv-ov;if(Math.abs(d)>=3)changes.push({type:d>0?"SIGNAL_UP":"SIGNAL_DOWN",field:k.replace(/([A-Z])/g," $1").trim(),from:ov,to:nv,delta:d,severity:Math.abs(d)>=20?"HIGH":Math.abs(d)>=8?"MEDIUM":"LOW"});}
  if(older.entity!==newer.entity)changes.push({type:"ENTITY_CHANGE",field:"Entity",from:older.entity,to:newer.entity,delta:null,severity:"MEDIUM"});
  if(older.decision!==newer.decision)changes.push({type:"DECISION_CHANGE",field:"Decision",from:older.decision,to:newer.decision,delta:null,severity:(older.decision==="ACCEPT"&&newer.decision==="REJECT")||(newer.decision==="ACCEPT"&&older.decision==="REJECT")?"HIGH":"MEDIUM"});
  if(older.balance!==newer.balance)changes.push({type:"BALANCE_CHANGE",field:"Balance",from:older.balance,to:newer.balance,delta:null,severity:"LOW"});
  const oa=new Set((older.counterparties||[]).map(c=>c.address?.toLowerCase()));
  for(const cp of(newer.counterparties||[]).filter(c=>!oa.has(c.address?.toLowerCase())&&c.knownRisk!==null&&c.knownRisk>40)){changes.push({type:"NEW_COUNTERPARTY",field:"New High-Risk Counterparty",from:null,to:`${cp.label} (${cp.address?.slice(0,10)}…)`,delta:cp.knownRisk,severity:cp.knownRisk>=80?"HIGH":"MEDIUM"});}
  let sf="STABLE";
  if(scoreDelta>=10)sf="ESCALATED";else if(scoreDelta<=-10)sf="IMPROVED";else if(changes.some(c=>c.type==="DECISION_CHANGE"))sf="STATUS_CHANGE";else if(changes.some(c=>c.severity==="HIGH"))sf="ALERT";
  return{changes,scoreDelta,statusFlag:sf};
}

async function persistScan(scan,user,prev){
  if(!sb.isConfigured()||!sb.token)return{ok:false,reason:"not_configured"};
  try{
    const diff=prev?analyzeDiff({...prev,overallScore:prev.overall_score,decision:prev.decision,entity:prev.entity,balance:prev.balance,counterparties:prev.counterparties||[]},scan):null;
    const sd=diff?.scoreDelta??0;const sf=diff?.statusFlag??"NEW";
    await sb.upsert("wallet_registry",{address:scan.address.toLowerCase(),chain:scan.chain,entity:scan.entity,latest_score:scan.overallScore,latest_decision:scan.decision,last_scan:new Date().toISOString(),trend:sd,status_flag:sf,balance:scan.balance,scan_count:(prev?.scan_count||0)+1,...(!prev?{first_scan:new Date().toISOString()}:{})}, "address");
    const ins=await sb.insert("wallet_scans",{address:scan.address.toLowerCase(),chain:scan.chain,scanned_at:new Date().toISOString(),overall_score:scan.overallScore,risk_level:scan.overallScore<=25?"LOW":scan.overallScore<=54?"MEDIUM":scan.overallScore<=74?"HIGH":"CRITICAL",decision:scan.decision,entity:scan.entity,entity_source:scan.entitySource,balance:scan.balance,tx_count:scan.txCount||0,first_seen:scan.firstSeen,signals:scan.signals,counterparties:(scan.counterparties||[]).slice(0,30),token_activity:scan.tokenActivity||[],hop_node_count:scan.hopNodeCount||0,direct_match:scan.directMatch||false,funding_wallet:scan.fundingWallet||null,api_source:scan._src||null,analyst_note:scan.note||null,status_flag:sf,score_delta:sd,scanned_by:user?.id||null,scanned_by_email:user?.email||null});
    const scanId=ins?.[0]?.id;
    if(diff?.changes?.length&&scanId){await sb.insert("scan_changes",diff.changes.map(c=>({address:scan.address.toLowerCase(),scan_id:scanId,change_type:c.type,field:c.field,from_value:c.from!==null?String(c.from):null,to_value:c.to!==null?String(c.to):null,delta:c.delta,severity:c.severity}))).catch(()=>{});}
    return{ok:true,scanId};
  }catch(e){return{ok:false,reason:e.message};}
}

// ── Wallet metadata helpers ───────────────────────────────────────────────────
async function loadMetadata(address){
  if(!sb.isConfigured()||!sb.token)return null;
  try{const r=await sb.select("wallet_metadata",{filter:{address:address.toLowerCase()}});return r?.[0]||null;}catch{return null;}
}
async function saveMetadata(address,data,user){
  if(!sb.isConfigured()||!sb.token)return{ok:false};
  try{
    const payload={address:address.toLowerCase(),...data,updated_by:user?.id,updated_by_email:user?.email,updated_at:new Date().toISOString()};
    const existing=await loadMetadata(address);
    if(!existing)Object.assign(payload,{created_by:user?.id,created_by_email:user?.email});
    await sb.upsert("wallet_metadata",payload);
    return{ok:true};
  }catch(e){return{ok:false,reason:e.message};}
}

// ── Risk helpers ──────────────────────────────────────────────────────────────
const rl=s=>s<=25?"LOW":s<=54?"MEDIUM":s<=74?"HIGH":"CRITICAL";
const RM={LOW:{label:"LOW RISK",color:"#00D98A",bg:"#001910"},MEDIUM:{label:"MEDIUM RISK",color:"#F0C040",bg:"#1A1400"},HIGH:{label:"HIGH RISK",color:"#FF8500",bg:"#1A0C00"},CRITICAL:{label:"CRITICAL RISK",color:"#FF2D55",bg:"#1A000A"}};
const cc={SANCTIONS:"#FF2D55",DARKNET:"#FF2D55",MIXER:"#FF8500",RANSOMWARE:"#FF2D55",HACKED_BRIDGE:"#FF8500",EXCHANGE:"#00D98A",DEFI:"#00B8E8",STABLECOIN:"#00E5CC",CONTRACT:"#9B6DFF",WALLET:"#567090",PROGRAM:"#2E4060",UNKNOWN:"#567090"};
const ROLES={admin:"ADMIN",analyst:"ANALYST",junior_analyst:"JUNIOR ANALYST"};
const ROLE_COLOR={admin:T.red,analyst:T.accent,junior_analyst:T.mid};

// ── UI components ─────────────────────────────────────────────────────────────
function Dot({c,s=8}){return<span style={{display:"inline-block",width:s,height:s,borderRadius:"50%",background:c,boxShadow:`0 0 5px ${c}`,flexShrink:0}}/> ;}
function Badge({score}){const m=RM[rl(score)];return<span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:3,fontSize:9.5,fontWeight:700,letterSpacing:"0.12em",background:m.bg,color:m.color,border:`1px solid ${m.color}50`,fontFamily:T.mono}}><Dot c={m.color}/>{m.label}</span>;}
function DecBadge({dec}){const c=dec==="ACCEPT"?T.green:dec==="REVIEW"?T.yellow:T.red;return<span style={{fontSize:9,fontWeight:700,color:c,letterSpacing:"0.1em",fontFamily:T.mono}}>{dec}</span>;}
function StatusChip({flag}){
  const map={NEW:{c:T.accent,label:"NEW"},STABLE:{c:T.mid,label:"STABLE"},ESCALATED:{c:T.red,label:"▲ ESCALATED"},IMPROVED:{c:T.green,label:"▼ IMPROVED"},STATUS_CHANGE:{c:T.yellow,label:"⚡ STATUS CHANGE"},ALERT:{c:T.orange,label:"⚠ ALERT"}};
  const m=map[flag]||map.STABLE;
  return<span style={{fontSize:8,fontWeight:700,color:m.c,letterSpacing:"0.1em",fontFamily:T.mono,padding:"2px 7px",borderRadius:3,border:`1px solid ${m.c}40`,background:`${m.c}10`}}>{m.label}</span>;
}
function RoleBadge({role}){
  const c=ROLE_COLOR[role]||T.dim;
  return<span style={{fontSize:8,fontWeight:700,color:c,letterSpacing:"0.1em",fontFamily:T.mono,padding:"2px 8px",borderRadius:3,border:`1px solid ${c}40`,background:`${c}10`}}>{ROLES[role]||role?.toUpperCase()}</span>;
}
function Gauge({score}){
  const m=RM[rl(score)];const r=44,cx=56,cy=56;
  const a=(score/100)*Math.PI;const ex=cx+r*Math.cos(Math.PI-a),ey=cy-r*Math.sin(Math.PI-a);
  return<svg width={112} height={68} viewBox="0 0 112 68">
    <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={T.border} strokeWidth={8} strokeLinecap="round"/>
    {score>0&&<path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke={m.color} strokeWidth={8} strokeLinecap="round" style={{filter:`drop-shadow(0 0 7px ${m.color})`}}/>}
    <text x={cx} y={cy-5} textAnchor="middle" fill={m.color} fontSize={20} fontWeight={800} fontFamily={T.mono}>{score}</text>
    <text x={cx} y={cy+9} textAnchor="middle" fill={T.mid} fontSize={8} fontFamily={T.mono}>/100</text>
  </svg>;
}
function Bar({label,value,prevValue}){
  const m=RM[rl(value)];const delta=prevValue!==undefined?Math.round(value-prevValue):null;
  return<div style={{marginBottom:10}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,gap:4}}>
      <span style={{fontSize:9,color:T.mid,fontFamily:T.mono}}>{label.replace(/([A-Z])/g," $1").toUpperCase()}</span>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        {delta!==null&&Math.abs(delta)>=2&&<span style={{fontSize:8,color:delta>0?T.red:T.green,fontFamily:T.mono}}>{delta>0?`+${delta}`:delta}</span>}
        <span style={{fontSize:10,color:m.color,fontFamily:T.mono,fontWeight:700}}>{Math.round(value)}</span>
      </div>
    </div>
    <div style={{height:3,borderRadius:2,background:T.border,position:"relative"}}>
      {prevValue!==undefined&&<div style={{position:"absolute",height:"100%",width:`${prevValue}%`,background:T.dim,borderRadius:2,opacity:0.6}}/>}
      <div style={{position:"absolute",height:"100%",width:`${value}%`,background:m.color,borderRadius:2,transition:"width 0.8s cubic-bezier(0.16,1,0.3,1)"}}/>
    </div>
  </div>;
}
function TimelineChart({scans,width=640,height=90}){
  if(!scans||scans.length<2)return<div style={{padding:"16px",textAlign:"center",color:T.dim,fontSize:9,fontFamily:T.mono}}>Need 2+ scans to display timeline</div>;
  const pts=[...scans].reverse();const scores=pts.map(s=>s.overall_score??s.overallScore);
  const minS=Math.max(0,Math.min(...scores)-5),maxS=Math.min(100,Math.max(...scores)+5),range=maxS-minS||10;
  const pad=16,W=width-pad*2,H=height-pad*2;
  const x=i=>(i/(pts.length-1))*W+pad;const y=s=>H-(((s-minS)/range)*H)+pad;
  const pathD=pts.map((p,i)=>`${i===0?"M":"L"}${x(i)},${y(scores[i])}`).join(" ");
  const areaD=`${pathD} L${x(pts.length-1)},${H+pad} L${pad},${H+pad} Z`;
  return<svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{overflow:"visible"}}>
    <defs><linearGradient id="tlG" x1="0"y1="0"x2="0"y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.25}/><stop offset="100%" stopColor={T.accent} stopOpacity={0}/></linearGradient></defs>
    {[25,50,75].map(v=><line key={v} x1={pad}y1={y(v)}x2={W+pad}y2={y(v)} stroke={T.border} strokeWidth={0.5} strokeDasharray="3,3"/>)}
    <path d={areaD} fill="url(#tlG)"/><path d={pathD} fill="none" stroke={T.accent} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>
    {pts.map((p,i)=>{const sc=scores[i];const m=RM[rl(sc)];return<circle key={i} cx={x(i)} cy={y(sc)} r={3.5} fill={m.color} stroke={T.bg} strokeWidth={1.5}/>;}) }
    <text x={pad} y={H+pad+12} fontSize={7} fill={T.dim} fontFamily={T.mono} textAnchor="middle">{pts[0]?.scanned_at?.slice(0,16)||pts[0]?.ts?.slice(0,16)}</text>
    <text x={W+pad} y={H+pad+12} fontSize={7} fill={T.dim} fontFamily={T.mono} textAnchor="middle">{pts[pts.length-1]?.scanned_at?.slice(0,16)||pts[pts.length-1]?.ts?.slice(0,16)}</text>
  </svg>;
}
function DiffRow({change,i}){
  const sevColor={HIGH:T.red,MEDIUM:T.orange,LOW:T.yellow}[change.severity]||T.mid;
  const typeIcon={ESCALATION:"▲",IMPROVEMENT:"▼",SIGNAL_UP:"↑",SIGNAL_DOWN:"↓",ENTITY_CHANGE:"⟳",DECISION_CHANGE:"⚡",BALANCE_CHANGE:"≈",NEW_COUNTERPARTY:"⊕"}[change.type]||"·";
  const typeColor={ESCALATION:T.red,IMPROVEMENT:T.green,SIGNAL_UP:T.orange,SIGNAL_DOWN:T.green,ENTITY_CHANGE:T.yellow,DECISION_CHANGE:T.red,BALANCE_CHANGE:T.mid,NEW_COUNTERPARTY:T.red}[change.type]||T.mid;
  const from=change.from_value??change.from;const to=change.to_value??change.to;const delta=change.delta;
  return<div style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",borderBottom:`1px solid ${T.border}15`,background:i%2?`${T.panel}50`:"transparent"}}>
    <span style={{fontSize:12,color:typeColor,width:16,textAlign:"center",flexShrink:0}}>{typeIcon}</span>
    <span style={{fontSize:9,color:T.mid,fontFamily:T.mono,flex:1.5}}>{change.field}</span>
    <span style={{fontSize:9,color:T.dim,fontFamily:T.mono,flex:2}}>{from!==null&&from!==undefined?<><span style={{color:T.dim}}>{from}</span><span style={{color:T.mid}}> → </span></>:null}<span style={{color:typeColor,fontWeight:700}}>{String(to)}</span></span>
    {delta!==null&&delta!==undefined&&<span style={{fontSize:9,color:typeColor,fontFamily:T.mono,fontWeight:700,width:36,textAlign:"right",flexShrink:0}}>{Number(delta)>0?`+${Math.round(delta)}`:`${Math.round(delta)}`}</span>}
    <span style={{fontSize:8,color:sevColor,fontFamily:T.mono,width:36,textAlign:"right",flexShrink:0,letterSpacing:"0.08em"}}>{change.severity}</span>
  </div>;
}

// ── MetadataField — defined OUTSIDE MetadataPanel to prevent focus loss ────────
function MetadataField({label,k,type="text",options=null,half=false,data,setData,canEdit}){
  return(
    <div style={{marginBottom:12,width:half?"calc(50% - 6px)":"100%"}}>
      <div style={{fontSize:8.5,color:T.mid,marginBottom:4,letterSpacing:"0.1em"}}>{label}</div>
      {options?(
        <select value={data[k]} onChange={e=>setData(p=>({...p,[k]:e.target.value}))} disabled={!canEdit}
          style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 10px",color:data[k]?T.text:T.dim,fontSize:11,fontFamily:T.mono,outline:"none",cursor:canEdit?"pointer":"default",opacity:canEdit?1:0.6}}>
          <option value="">— select —</option>
          {options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ):(
        <input type={type} value={data[k]} onChange={e=>setData(p=>({...p,[k]:e.target.value}))} disabled={!canEdit}
          placeholder={canEdit?"Enter "+label.toLowerCase():"—"}
          style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 10px",color:T.text,fontSize:11,fontFamily:T.mono,outline:"none",boxSizing:"border-box",opacity:canEdit?1:0.6}}
          onFocus={e=>{if(canEdit)e.target.style.borderColor=T.accent;}} onBlur={e=>e.target.style.borderColor=T.border}/>
      )}
    </div>
  );
}

// ── Metadata Panel ────────────────────────────────────────────────────────────
function MetadataPanel({address,user,role,onClose,onSaved}){
  const [data,setData]=useState({owner_name:"",wallet_reference:"",entity_type:"",jurisdiction:"",id_reference:"",relationship_manager:"",risk_classification:"",contact_number:"",contact_email:"",notes:""});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [err,setErr]=useState("");
  const canEdit=role==="admin"||role==="analyst";

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const m=await loadMetadata(address);
      if(m)setData({owner_name:m.owner_name||"",wallet_reference:m.wallet_reference||"",entity_type:m.entity_type||"",jurisdiction:m.jurisdiction||"",id_reference:m.id_reference||"",relationship_manager:m.relationship_manager||"",risk_classification:m.risk_classification||"",contact_number:m.contact_number||"",contact_email:m.contact_email||"",notes:m.notes||""});
      setLoading(false);
    })();
  },[address]);

  const save=async()=>{
    setSaving(true);setErr("");
    const r=await saveMetadata(address,data,user);
    if(r.ok){setSaved(true);setTimeout(()=>setSaved(false),2000);onSaved&&onSaved(data);}
    else setErr(r.reason||"Save failed");
    setSaving(false);
  };



  return(
    <div style={{position:"fixed",top:0,right:0,width:420,height:"100vh",background:T.surface,borderLeft:`1px solid ${T.border}`,zIndex:100,display:"flex",flexDirection:"column",boxShadow:"-8px 0 32px #000A"}}>
      <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.14em",color:T.text}}>WALLET METADATA</div>
          <div style={{fontSize:8.5,color:T.mid,marginTop:2,fontFamily:T.mono}}>{address.slice(0,14)}…{address.slice(-8)}</div>
        </div>
        <button onClick={onClose} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.mid,width:28,height:28,borderRadius:4,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
      {loading?(
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:T.dim,fontSize:10}}>Loading…</div>
      ):(
        <div style={{flex:1,overflow:"auto",padding:20}}>
          {!canEdit&&<div style={{marginBottom:16,padding:"8px 12px",background:`${T.yellow}10`,border:`1px solid ${T.yellow}30`,borderRadius:4,fontSize:9,color:T.yellow}}>Read-only — your role cannot edit metadata</div>}
          <div style={{fontSize:8,color:T.dim,letterSpacing:"0.18em",marginBottom:12}}>OWNERSHIP</div>
          <MetadataField label="Owner Name" k="owner_name" data={data} setData={setData} canEdit={canEdit}/>
          <MetadataField label="Wallet Reference" k="wallet_reference" data={data} setData={setData} canEdit={canEdit}/>
          <div style={{fontSize:8,color:T.dim,letterSpacing:"0.18em",margin:"16px 0 12px"}}>KYC DETAILS <span style={{color:T.dim,fontWeight:400}}>— all optional</span></div>
          <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
            <MetadataField label="Entity Type" k="entity_type" options={["Individual","Corporate","Trust","Fund","Other"]} half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="Risk Classification" k="risk_classification" options={["Low","Medium","High","Critical"]} half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="Jurisdiction / Country" k="jurisdiction" half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="ID Reference" k="id_reference" half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="Contact Number" k="contact_number" half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="Contact Email" k="contact_email" type="email" half data={data} setData={setData} canEdit={canEdit}/>
            <MetadataField label="Relationship Manager / Introducer" k="relationship_manager" data={data} setData={setData} canEdit={canEdit}/>
            <div style={{width:"100%",marginBottom:12}}>
              <div style={{fontSize:8.5,color:T.mid,marginBottom:4,letterSpacing:"0.1em"}}>NOTES</div>
              <textarea value={data.notes} onChange={e=>setData(p=>({...p,notes:e.target.value}))} disabled={!canEdit}
                placeholder={canEdit?"Additional notes…":"—"}
                style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 10px",color:T.text,fontSize:11,fontFamily:T.mono,resize:"vertical",minHeight:64,outline:"none",boxSizing:"border-box",opacity:canEdit?1:0.6}}
                onFocus={e=>{if(canEdit)e.target.style.borderColor=T.accent;}} onBlur={e=>e.target.style.borderColor=T.border}/>
            </div>
          </div>
        </div>
      )}
      {canEdit&&<div style={{padding:"14px 20px",borderTop:`1px solid ${T.border}`,flexShrink:0}}>
        {err&&<div style={{fontSize:9,color:T.red,marginBottom:8}}>⚠ {err}</div>}
        <div style={{display:"flex",gap:10}}>
          <button onClick={save} disabled={saving} style={{flex:1,padding:"9px",borderRadius:5,background:saved?T.green:saving?T.border:`linear-gradient(135deg,${T.accent},${T.accentLo})`,border:"none",color:T.bg,fontFamily:T.mono,fontSize:11,fontWeight:700,letterSpacing:"0.12em",cursor:saving?"not-allowed":"pointer"}}>
            {saved?"✓ SAVED":saving?"SAVING…":"SAVE METADATA"}
          </button>
          <button onClick={onClose} style={{padding:"9px 16px",borderRadius:5,background:"transparent",border:`1px solid ${T.border}`,color:T.mid,fontFamily:T.mono,fontSize:11,cursor:"pointer"}}>SKIP</button>
        </div>
      </div>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null);
  const [role,setRole]=useState(null); // 'admin' | 'analyst' | 'junior_analyst'
  const [loginEmail,setLoginEmail]=useState("");
  const [loginPwd,setLoginPwd]=useState("");
  const [loginErr,setLoginErr]=useState("");
  const [loginLoading,setLoginLoading]=useState(false);
  const [inviteToken,setInviteToken]=useState(null);
  const [newPwd,setNewPwd]=useState("");
  const [newPwdConfirm,setNewPwdConfirm]=useState("");
  const [pwdLoading,setPwdLoading]=useState(false);
  const [pwdErr,setPwdErr]=useState("");
  const [pwdDone,setPwdDone]=useState(false);

  const [addr,setAddr]=useState("");
  const [keys,setKeys]=useState(()=>ls.get("apiKeys")||{etherscan:"",solscan:""});
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState(null);
  const [status,setStatus]=useState([]);
  const [hopNodes,setHopNodes]=useState([]);
  const [maxHops,setMaxHops]=useState(2);
  const [policy,setPolicy]=useState(()=>ls.get("policy")||{accept:25,review:54});
  const [note,setNote]=useState("");
  const [showKeys,setShowKeys]=useState(false);
  const [tab,setTab]=useState("screen");
  const [registry,setRegistry]=useState([]);
  const [regLoading,setRegLoading]=useState(false);
  const [selectedWallet,setSelectedWallet]=useState(null);
  const [walletScans,setWalletScans]=useState([]);
  const [walletChanges,setWalletChanges]=useState([]);
  const [walletMeta,setWalletMeta]=useState(null);
  const [historyTab,setHistoryTab]=useState("timeline");
  const [compareA,setCompareA]=useState(null);
  const [compareB,setCompareB]=useState(null);
  const [syncStatus,setSyncStatus]=useState("idle");
  const [reportLoading,setReportLoading]=useState(false);
  const [reportError,setReportError]=useState("");
  const [ofacStatus,setOfacStatus]=useState("idle");
  const [showMeta,setShowMeta]=useState(false);
  const [metaAddress,setMetaAddress]=useState(null);
  const stRef=useRef([]);
  const push=useCallback(msg=>{stRef.current=[...stRef.current,msg];setStatus([...stRef.current]);},[]);

  useEffect(()=>{
    (async()=>{
      const hash=window.location.hash;
      if(hash){const p=new URLSearchParams(hash.replace("#",""));const type=p.get("type");const tok=p.get("access_token");if(tok&&(type==="invite"||type==="recovery")){setInviteToken(tok);window.history.replaceState(null,"",window.location.pathname);return;}}
      const sess=ls.get("sbSession");
      if(sess){try{const ref=await sb.refresh(sess.refreshToken);sb.token=ref.access_token;setUser(sess.user);ls.set("sbSession",{...sess,token:ref.access_token});await loadRole(sess.user,ref.access_token);}catch{ls.del("sbSession");}}
      setOfacStatus("loading");await fetchOFAC(push);setOfacStatus(OFAC.status);
    })();
  },[]);

  const loadRole=async(u, tokenOverride)=>{
    if(!sb.isConfigured())return;
    if(tokenOverride) sb.token=tokenOverride;
    if(!sb.token)return;
    try{
      const rows=await sb.select("user_roles",{filter:{user_id:u?.id}});
      const r=rows?.[0]?.role;
      setRole(r||"junior_analyst");
      if(!r) console.warn("No role found for",u?.id,"— check user_roles table in Supabase");
    }catch(e){
      console.error("loadRole failed:",e.message);
      setRole("junior_analyst");
    }
  };

  useEffect(()=>{if(user){refreshRegistry();};},[user,role]);
  useEffect(()=>{ls.set("apiKeys",keys);},[keys]);
  useEffect(()=>{ls.set("policy",policy);},[policy]);

  const refreshRegistry=async()=>{
    if(!sb.isConfigured()||!sb.token)return;
    setRegLoading(true);
    try{const r=await sb.select("wallet_registry",{order:"last_scan.desc",limit:200});setRegistry(r||[]);}catch{}
    setRegLoading(false);
  };

  const handleLogin=async()=>{
    setLoginLoading(true);setLoginErr("");
    try{
      const{user:u,token,refreshToken}=await sb.signIn(loginEmail,loginPwd);
      sb.token=token;setUser(u);ls.set("sbSession",{user:u,token,refreshToken});
      await loadRole(u,token);
    }catch(e){setLoginErr(e.message);}
    setLoginLoading(false);
  };

  const handleLogout=async()=>{await sb.signOut();setUser(null);setRole(null);setRegistry([]);ls.del("sbSession");};

  const handleSetPassword=async()=>{
    if(newPwd!==newPwdConfirm){setPwdErr("Passwords do not match");return;}
    if(newPwd.length<8){setPwdErr("Minimum 8 characters");return;}
    setPwdLoading(true);setPwdErr("");
    try{await sb.setPassword(inviteToken,newPwd);setPwdDone(true);setTimeout(()=>{setInviteToken(null);setPwdDone(false);},2000);}
    catch(e){setPwdErr(e.message);}
    setPwdLoading(false);
  };

  const openHistory=async(address)=>{
    setSelectedWallet(address);setTab("history");setHistoryTab("timeline");
    try{
      const[scans,changes,meta]=await Promise.all([
        sb.select("wallet_scans",{filter:{address:address.toLowerCase()},order:"scanned_at.desc",limit:100}),
        sb.select("scan_changes",{filter:{address:address.toLowerCase()},order:"created_at.desc",limit:200}),
        loadMetadata(address),
      ]);
      setWalletScans(scans||[]);setWalletChanges(changes||[]);setWalletMeta(meta);
      if(scans?.length>=2){setCompareA(scans[0]);setCompareB(scans[1]);}
    }catch{}
  };

  const screen=useCallback(async()=>{
    const a=addr.trim();if(!a)return;
    const ch=chain(a);
    if(ch==="UNKNOWN"){setErr("Unrecognised address. Supported: BTC, ETH/EVM, TRX, SOL");return;}
    setLoading(true);setErr(null);setResult(null);setNote("");setHopNodes([]);stRef.current=[];setStatus([]);
    try{
      push(`Chain: ${ch}`);
      let data;
      if(ch==="BTC"){push("Fetching BTC…");data=await fetchBTC(a,push);}
      else if(ch==="ETH"){push("Fetching ETH…");data=await fetchETH(a,keys.etherscan,push);}
      else if(ch==="TRX"){push("Fetching TRX…");data=await fetchTRX(a,push);}
      else{push("Fetching SOL…");data=await fetchSOL(a,push,keys.solscan);}
      push(`${data.txCount} txs · ${data.balance}`);
      push(`${maxHops}-hop traversal…`);
      const hops=await multiHop(a,ch,data.counterparties,maxHops,keys.etherscan,push,(h,n)=>setHopNodes([...n]));
      setHopNodes(hops);
      const score=scoreWallet(a,ch,data,hops);
      const decision=score.overallScore<=policy.accept?"ACCEPT":score.overallScore<=policy.review?"REVIEW":"REJECT";
      const ts=new Date().toISOString().replace("T"," ").slice(0,19);
      const full={address:a,chain:ch,...data,...score,decision,ts,hopNodeCount:hops.length,note:""};
      setResult(full);
      if(sb.isConfigured()&&sb.token){
        push("Saving to Supabase…");setSyncStatus("syncing");
        let prev=null;
        try{const p=await sb.select("wallet_scans",{filter:{address:a.toLowerCase()},order:"scanned_at.desc",limit:1});prev=p?.[0]||null;}catch{}
        const p=await persistScan(full,user,prev);
        if(p.ok){push(`✓ Saved`);setSyncStatus("ok");}else{push(`⚠ Save failed: ${p.reason}`);setSyncStatus("error");}
        await refreshRegistry();
        if(selectedWallet?.toLowerCase()===a.toLowerCase())await openHistory(a);
      }
    }catch(e){setErr(e.message);setSyncStatus("error");}
    setLoading(false);
  },[addr,keys,policy,maxHops,push,user,selectedWallet]);

  const openMeta=(address)=>{setMetaAddress(address);setShowMeta(true);};

  const exportCSV=async()=>{
    const rows=[["Timestamp","Address","Chain","Score","Risk","Entity","Decision","Balance","TX Count","Scanned By","Score Delta","Owner","Wallet Ref","Entity Type","Jurisdiction"]];
    const allScans=await Promise.all(registry.map(w=>sb.select("wallet_scans",{filter:{address:w.address},order:"scanned_at.desc",limit:100}).catch(()=>[])));
    const allMeta=await Promise.all(registry.map(w=>loadMetadata(w.address)));
    allScans.flat().sort((a,b)=>new Date(b.scanned_at)-new Date(a.scanned_at)).forEach(e=>{
      const m=allMeta.find(x=>x?.address===e.address);
      rows.push([e.scanned_at,e.address,e.chain,e.overall_score,e.risk_level,e.entity,e.decision,e.balance,e.tx_count,e.scanned_by_email||"",e.score_delta||0,m?.owner_name||"",m?.wallet_reference||"",m?.entity_type||"",m?.jurisdiction||""]);
    });
    const el=document.createElement("a");el.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"}));el.download=`vigilante_aml_${Date.now()}.csv`;el.click();
  };

  // ── Report generation ──
  const generateReport = async(scanData, format="both") => {
    if(!scanData){ setReportError("No scan data available"); return; }
    setReportLoading(true); setReportError("");
    try {
      const { generatePDF, generateDOCX, downloadBlob, reportFilename } = await import("./reportGenerator.js");
      // Fetch KYC metadata for this wallet
      const kyc = await loadMetadata(scanData.address).catch(()=>null);
      // Fetch scan history
      let history = [];
      if(sb.isConfigured()&&sb.token){
        history = await sb.select("wallet_scans",{filter:{address:(scanData.address||"").toLowerCase()},order:"scanned_at.desc",limit:50}).catch(()=>[]);
      }
      // Fetch change log
      let changesLog = [];
      if(sb.isConfigured()&&sb.token){
        changesLog = await sb.select("scan_changes",{filter:{address:(scanData.address||"").toLowerCase()},order:"created_at.desc",limit:100}).catch(()=>[]);
      }
      // Normalise scan data (handle both live result and Supabase row shapes)
      const normalised = {
        ...scanData,
        overall_score: scanData.overall_score ?? scanData.overallScore ?? 0,
        tx_count: scanData.tx_count ?? scanData.txCount ?? 0,
        first_seen: scanData.first_seen ?? scanData.firstSeen ?? "Unknown",
        hop_node_count: scanData.hop_node_count ?? scanData.hopNodeCount ?? 0,
        counterparties: scanData.counterparties || [],
        signals: scanData.signals || {},
      };
      if(format==="pdf"||format==="both"){
        const pdfData = await generatePDF(normalised, kyc, history, changesLog);
        downloadBlob(pdfData, reportFilename(normalised,"pdf"), "application/pdf");
      }
      if(format==="docx"||format==="both"){
        const docxData = await generateDOCX(normalised, kyc, history, changesLog);
        downloadBlob(docxData, reportFilename(normalised,"docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      }
    } catch(e) {
      console.error("Report generation failed:", e);
      setReportError("Report generation failed: " + e.message);
    }
    setReportLoading(false);
  };

  const decCol=result?(result.decision==="ACCEPT"?T.green:result.decision==="REVIEW"?T.yellow:T.red):T.mid;

  // ── Tabs visible per role ──
  const tabs=[
    {id:"screen",label:"SCREEN",show:true},
    {id:"wallets",label:"REGISTRY",show:role==="admin"||role==="analyst"},
    {id:"history",label:"HISTORY",show:true},
    {id:"log",label:"AUDIT LOG",show:role==="admin"},
  ];

  // ── Invite / password set screen ──
  if(inviteToken)return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:T.mono,padding:24}}>
      <div style={{background:T.panel,border:`1px solid ${T.borderHi}`,borderRadius:10,padding:32,width:"100%",maxWidth:400}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <svg width={26} height={26} viewBox="0 0 28 28"><polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke={T.accent} strokeWidth={1.5}/><circle cx={14} cy={14} r={2.5} fill={T.accent}/></svg>
          <div><div style={{fontSize:12,fontWeight:700,letterSpacing:"0.18em"}}>SET YOUR PASSWORD</div><div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.15em"}}>VIGILANTE — ACCOUNT SETUP</div></div>
        </div>
        {pwdDone?<div style={{padding:16,background:`${T.green}15`,border:`1px solid ${T.green}40`,borderRadius:6,color:T.green,fontSize:11,textAlign:"center"}}>✓ Password set — redirecting to login…</div>:<>
          {[{label:"New Password",val:newPwd,set:setNewPwd},{label:"Confirm Password",val:newPwdConfirm,set:setNewPwdConfirm}].map(({label,val,set})=>(
            <div key={label} style={{marginBottom:14}}>
              <div style={{fontSize:9,color:T.mid,marginBottom:5,letterSpacing:"0.1em"}}>{label.toUpperCase()}</div>
              <input type="password" value={val} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSetPassword()} placeholder="••••••••" style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"10px 14px",color:T.text,fontSize:12,fontFamily:T.mono,outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
            </div>
          ))}
          {pwdErr&&<div style={{marginBottom:12,fontSize:10,color:T.red,padding:"7px 10px",background:`${T.red}10`,border:`1px solid ${T.red}30`,borderRadius:4}}>{pwdErr}</div>}
          <button onClick={handleSetPassword} disabled={pwdLoading||!newPwd||!newPwdConfirm} style={{width:"100%",padding:11,borderRadius:5,background:pwdLoading?T.border:`linear-gradient(135deg,${T.accent},${T.accentLo})`,border:"none",color:T.bg,fontFamily:T.mono,fontSize:11,fontWeight:700,letterSpacing:"0.12em",cursor:pwdLoading?"not-allowed":"pointer"}}>{pwdLoading?"SETTING…":"SET PASSWORD & CONTINUE"}</button>
          <div style={{marginTop:12,fontSize:8.5,color:T.dim,textAlign:"center"}}>Minimum 8 characters</div>
        </>}
      </div>
    </div>
  );

  // ── Login screen ──
  if(!user)return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:T.mono,padding:24}}>
      <div style={{background:T.panel,border:`1px solid ${T.borderHi}`,borderRadius:10,padding:32,width:"100%",maxWidth:400}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:28}}>
          <svg width={28} height={28} viewBox="0 0 28 28"><polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke={T.accent} strokeWidth={1.5}/><polygon points="14,7 21,11 21,17 14,21 7,17 7,11" fill={`${T.accent}20`} stroke={T.accent} strokeWidth={1}/><circle cx={14} cy={14} r={2.5} fill={T.accent}/></svg>
          <div><div style={{fontSize:13,fontWeight:700,letterSpacing:"0.18em"}}>VIGILANTE</div><div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.2em"}}>AML SCREENING · DFSA COMPLIANCE</div></div>
        </div>
        {[{k:"email",label:"EMAIL",val:loginEmail,set:setLoginEmail,type:"email",ph:"you@asascapital.com"},{k:"pwd",label:"PASSWORD",val:loginPwd,set:setLoginPwd,type:"password",ph:"••••••••"}].map(({k,label,val,set,type,ph})=>(
          <div key={k} style={{marginBottom:14}}>
            <div style={{fontSize:9,color:T.mid,marginBottom:5,letterSpacing:"0.1em"}}>{label}</div>
            <input type={type} value={val} onChange={e=>set(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder={ph} style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"10px 14px",color:T.text,fontSize:12,fontFamily:T.mono,outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
        ))}
        {loginErr&&<div style={{marginBottom:12,fontSize:10,color:T.red,padding:"7px 10px",background:`${T.red}10`,border:`1px solid ${T.red}30`,borderRadius:4}}>{loginErr}</div>}
        <button onClick={handleLogin} disabled={loginLoading||!loginEmail||!loginPwd} style={{width:"100%",padding:12,borderRadius:5,background:loginLoading?T.border:`linear-gradient(135deg,${T.accent},${T.accentLo})`,border:"none",color:loginLoading?T.dim:T.bg,fontFamily:T.mono,fontSize:12,fontWeight:700,letterSpacing:"0.12em",cursor:loginLoading||!loginEmail||!loginPwd?"not-allowed":"pointer",marginBottom:16}}>{loginLoading?"SIGNING IN…":"SIGN IN"}</button>
        <div style={{padding:"10px 12px",background:`${T.accent}08`,border:`1px solid ${T.accent}20`,borderRadius:4,fontSize:8.5,color:T.dim,lineHeight:1.7}}>Team members receive an invite email. Click the link to set your password here.</div>
      </div>
    </div>
  );

  // ── Main app ──
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:T.mono}}>

      {/* Metadata panel overlay */}
      {showMeta&&metaAddress&&<MetadataPanel address={metaAddress} user={user} role={role} onClose={()=>setShowMeta(false)} onSaved={(data)=>{setWalletMeta(data);setShowMeta(false);}}/>}
      {showMeta&&<div onClick={()=>setShowMeta(false)} style={{position:"fixed",inset:0,background:"#000A",zIndex:99}}/>}

      {/* Header */}
      <div style={{borderBottom:`1px solid ${T.border}`,padding:"11px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:`${T.surface}EE`,backdropFilter:"blur(16px)",position:"sticky",top:0,zIndex:20,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <svg width={22} height={22} viewBox="0 0 28 28"><polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke={T.accent} strokeWidth={1.5}/><polygon points="14,7 21,11 21,17 14,21 7,17 7,11" fill={`${T.accent}20`} stroke={T.accent} strokeWidth={1}/><circle cx={14} cy={14} r={2.5} fill={T.accent}/></svg>
          <div><div style={{fontSize:12,fontWeight:700,letterSpacing:"0.18em"}}>VIGILANTE <span style={{fontSize:8,color:T.accentLo}}>v4.0</span></div><div style={{fontSize:7,color:T.dim,letterSpacing:"0.18em"}}>ON-CHAIN AML · TEAM · DFSA</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}><Dot c={syncStatus==="ok"?T.green:syncStatus==="error"?T.red:syncStatus==="syncing"?T.yellow:T.dim} s={5}/><span style={{fontSize:8,color:T.mid}}>SUPABASE {syncStatus.toUpperCase()}</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><Dot c={ofacStatus==="ok"?T.green:T.yellow} s={5}/><span style={{fontSize:8,color:T.mid}}>OFAC {ofacStatus==="ok"?OFAC.count:ofacStatus}</span></div>
          {role&&<RoleBadge role={role}/>}
          <div style={{fontSize:8.5,color:T.mid,padding:"3px 8px",background:`${T.accent}10`,border:`1px solid ${T.accent}20`,borderRadius:3}}>{user?.email}</div>
          <button onClick={()=>setShowKeys(!showKeys)} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.mid,padding:"3px 10px",borderRadius:3,cursor:"pointer",fontSize:8.5}}>API KEYS</button>
          <button onClick={handleLogout} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.mid,padding:"3px 10px",borderRadius:3,cursor:"pointer",fontSize:8.5,letterSpacing:"0.1em"}}>SIGN OUT</button>
        </div>
      </div>

      {showKeys&&<div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"14px 24px"}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:10}}>
          <div style={{flex:1,minWidth:220}}>
            <div style={{fontSize:8.5,color:T.mid,marginBottom:5}}>Etherscan API Key <span style={{color:T.dim}}>— free at etherscan.io/apis · ETH/EVM chains</span></div>
            <div style={{display:"flex",gap:8}}>
              <input type="password" value={keys.etherscan||""} onChange={e=>setKeys(p=>({...p,etherscan:e.target.value}))}
                onKeyDown={e=>{if(e.key==="Enter"){ls.set("apiKeys",keys);setShowKeys(false);}}}
                placeholder="YourApiKeyToken"
                style={{flex:1,background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 12px",color:keys.etherscan?T.green:T.dim,fontSize:11,fontFamily:T.mono,outline:"none",boxSizing:"border-box"}}/>
              <button onClick={()=>{ls.set("apiKeys",keys);setShowKeys(false);}} style={{padding:"7px 14px",borderRadius:4,background:`${T.green}20`,border:`1px solid ${T.green}40`,color:T.green,fontSize:10,fontFamily:T.mono,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:"0.08em"}}>SAVE ↵</button>
            </div>
          </div>
          <div style={{flex:1,minWidth:220}}>
            <div style={{fontSize:8.5,color:T.mid,marginBottom:5}}>Solscan API Key <span style={{color:T.dim}}>— free at solscan.io · improves SOL data</span></div>
            <div style={{display:"flex",gap:8}}>
              <input type="password" value={keys.solscan||""} onChange={e=>setKeys(p=>({...p,solscan:e.target.value}))}
                onKeyDown={e=>{if(e.key==="Enter"){ls.set("apiKeys",keys);setShowKeys(false);}}}
                placeholder="Your Solscan API key"
                style={{flex:1,background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 12px",color:keys.solscan?T.green:T.dim,fontSize:11,fontFamily:T.mono,outline:"none",boxSizing:"border-box"}}/>
              <button onClick={()=>{ls.set("apiKeys",keys);setShowKeys(false);}} style={{padding:"7px 14px",borderRadius:4,background:`${T.green}20`,border:`1px solid ${T.green}40`,color:T.green,fontSize:10,fontFamily:T.mono,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:"0.08em"}}>SAVE ↵</button>
            </div>
          </div>
        </div>
        <div style={{fontSize:8,color:T.dim}}>BTC → Blockstream (no key needed) · ETH → Etherscan → Blockscout · SOL → Solscan → mainnet RPC · TRX → Tronscan → TronGrid</div>
      </div>}

      {/* Policy */}
      <div style={{background:`${T.surface}80`,borderBottom:`1px solid ${T.border}`,padding:"6px 24px",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <span style={{fontSize:7.5,color:T.dim,letterSpacing:"0.18em"}}>POLICY</span>
        {[{k:"accept",label:"ACCEPT ≤",c:T.green},{k:"review",label:"REVIEW ≤",c:T.yellow}].map(({k,label,c})=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:6}}>
            <Dot c={c} s={5}/><span style={{fontSize:8.5,color:c}}>{label}</span>
            <input type="number" min={0} max={100} value={policy[k]} onChange={e=>setPolicy(p=>({...p,[k]:+e.target.value}))} style={{width:42,background:T.bg,border:`1px solid ${T.border}`,borderRadius:3,padding:"2px 5px",color:T.text,fontSize:10,fontFamily:T.mono,outline:"none",textAlign:"center"}}/>
          </div>
        ))}
        <span style={{fontSize:8.5,color:T.dim}}>REJECT &gt; {policy.review}</span>
        <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:6}}>
          <span style={{fontSize:7.5,color:T.dim}}>HOPS</span>
          {[1,2,3].map(h=><button key={h} onClick={()=>setMaxHops(h)} style={{width:22,height:22,borderRadius:3,background:maxHops===h?`${T.purple}30`:"transparent",border:`1px solid ${maxHops===h?T.purple:T.border}`,color:maxHops===h?T.purple:T.dim,fontSize:9.5,cursor:"pointer",fontFamily:T.mono}}>{h}</button>)}
        </div>
        <span style={{marginLeft:"auto",fontSize:8.5,color:T.dim}}>{registry.length} wallet{registry.length!==1?"s":""} tracked</span>
      </div>

      {/* Tabs */}
      <div style={{padding:"0 24px",borderBottom:`1px solid ${T.border}`,display:"flex",overflowX:"auto"}}>
        {tabs.filter(t=>t.show).map(({id,label})=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"10px 16px",fontSize:8.5,letterSpacing:"0.14em",fontFamily:T.mono,background:"transparent",border:"none",cursor:"pointer",color:tab===id?T.accent:T.dim,borderBottom:tab===id?`2px solid ${T.accent}`:"2px solid transparent",whiteSpace:"nowrap"}}>
            {label}{id==="wallets"&&registry.length>0&&<span style={{fontSize:7,background:T.accent,color:T.bg,borderRadius:10,padding:"1px 5px",marginLeft:4,fontWeight:700}}>{registry.length}</span>}
          </button>
        ))}
      </div>

      <div style={{padding:24}}>

        {/* ══ SCREEN ══ */}
        {tab==="screen"&&<>
          <div style={{display:"flex",gap:10,marginBottom:18,maxWidth:820}}>
            <div style={{flex:1,position:"relative"}}>
              <input value={addr} onChange={e=>setAddr(e.target.value)} onKeyDown={e=>e.key==="Enter"&&screen()}
                placeholder="Wallet address — BTC · ETH/EVM · TRX · SOL"
                style={{width:"100%",background:T.panel,border:`1px solid ${T.borderHi}`,borderRadius:6,padding:"12px 16px",color:T.text,fontSize:12,fontFamily:T.mono,outline:"none",boxSizing:"border-box"}}
                onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.borderHi}/>
              {addr&&<span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:8.5,color:T.accentLo,pointerEvents:"none"}}>{chain(addr.trim())}</span>}
            </div>
            <button onClick={()=>addr.trim()&&openMeta(addr.trim())} title="Add owner / KYC info" style={{padding:"0 14px",borderRadius:6,background:T.panel,border:`1px solid ${T.border}`,color:T.mid,fontFamily:T.mono,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}} disabled={!addr.trim()}>📋 KYC</button>
            <button onClick={screen} disabled={loading||!addr.trim()} style={{padding:"0 22px",borderRadius:6,background:loading?T.border:`linear-gradient(135deg,${T.accent},${T.accentLo})`,border:"none",color:loading?T.dim:T.bg,fontFamily:T.mono,fontSize:11,fontWeight:700,letterSpacing:"0.12em",cursor:loading||!addr.trim()?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
              {loading?"SCANNING…":"SCREEN"}
            </button>
          </div>

          {status.length>0&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,padding:"12px 16px",marginBottom:18,maxWidth:820,maxHeight:170,overflow:"auto"}}>
            {status.map((s,i)=><div key={i} style={{fontSize:9,color:i===status.length-1?T.accent:T.mid,padding:"1.5px 0"}}>{i===status.length-1?"▶ ":"✓ "}{s}</div>)}
          </div>}

          {err&&<div style={{background:`${T.red}10`,border:`1px solid ${T.red}40`,borderRadius:6,padding:"9px 14px",marginBottom:14,fontSize:10,color:T.red,maxWidth:820}}>⚠ {err}</div>}

          {result&&!loading&&(()=>{
            const prev=walletScans[0];
            const diff=prev?analyzeDiff({...prev,overallScore:prev.overall_score,decision:prev.decision,entity:prev.entity,balance:prev.balance,counterparties:prev.counterparties||[]},result):null;
            return<div style={{display:"grid",gridTemplateColumns:"minmax(0,270px) 1fr",gap:16,maxWidth:1120}}>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16}}>
                  <div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.2em",marginBottom:10}}>RISK SCORE</div>
                  <div style={{display:"flex",justifyContent:"center"}}><Gauge score={result.overallScore}/></div>
                  <div style={{textAlign:"center",marginTop:5}}><Badge score={result.overallScore}/></div>
                  {diff&&<div style={{marginTop:8,textAlign:"center"}}><StatusChip flag={diff.statusFlag}/>{Math.abs(diff.scoreDelta)>0&&<div style={{fontSize:9,color:diff.scoreDelta>0?T.red:T.green,marginTop:4,fontFamily:T.mono}}>{diff.scoreDelta>0?`▲ +${diff.scoreDelta}`:` ▼ ${diff.scoreDelta}`} from last scan</div>}</div>}
                  <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`,textAlign:"center"}}>
                    <div style={{fontSize:7.5,color:T.dim,marginBottom:4}}>DECISION</div>
                    <div style={{fontSize:17,fontWeight:800,color:decCol,letterSpacing:"0.15em",textShadow:`0 0 16px ${decCol}50`}}>{result.decision}</div>
                  </div>
                </div>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16}}>
                  <div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.2em",marginBottom:10}}>METADATA</div>
                  {[["ADDRESS",result.address.slice(0,8)+"…"+result.address.slice(-6)],["CHAIN",result.chain],["ENTITY",result.entity],["BALANCE",result.balance],["TX COUNT",(result.txCount||0).toLocaleString()],["FIRST SEEN",result.firstSeen],["SCANNED BY",user?.email?.split("@")[0]]].map(([k,v])=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:7,gap:8}}><span style={{fontSize:8,color:T.dim,flexShrink:0}}>{k}</span><span style={{fontSize:9.5,color:T.mid,textAlign:"right",wordBreak:"break-all"}}>{String(v)}</span></div>
                  ))}
                  {result.tokenActivity?.length>0&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:3}}>{result.tokenActivity.slice(0,8).map(t=><span key={t.symbol} style={{fontSize:8,padding:"2px 6px",borderRadius:3,background:`${T.teal}15`,color:T.teal,border:`1px solid ${T.teal}30`}}>{t.symbol}</span>)}</div>}
                  <div style={{marginTop:12,display:"flex",gap:8}}>
                    <button onClick={()=>openMeta(result.address)} style={{flex:1,padding:"6px",borderRadius:4,background:`${T.teal}15`,border:`1px solid ${T.teal}40`,color:T.teal,fontSize:9,fontFamily:T.mono,cursor:"pointer",letterSpacing:"0.1em"}}>📋 {walletMeta?"EDIT KYC":"ADD KYC"}</button>
                    <button onClick={()=>openHistory(result.address)} style={{flex:1,padding:"6px",borderRadius:4,background:`${T.purple}15`,border:`1px solid ${T.purple}40`,color:T.purple,fontSize:9,fontFamily:T.mono,cursor:"pointer",letterSpacing:"0.1em"}}>HISTORY →</button>
                  </div>
                  <div style={{marginTop:8,display:"flex",gap:6}}>
                    <button onClick={()=>generateReport(result,"pdf")} disabled={reportLoading} style={{flex:1,padding:"6px",borderRadius:4,background:`${T.red}15`,border:`1px solid ${T.red}40`,color:T.red,fontSize:9,fontFamily:T.mono,cursor:reportLoading?"not-allowed":"pointer",letterSpacing:"0.1em"}}>{reportLoading?"GENERATING…":"⬇ PDF REPORT"}</button>
                    <button onClick={()=>generateReport(result,"docx")} disabled={reportLoading} style={{flex:1,padding:"6px",borderRadius:4,background:`${T.orange}15`,border:`1px solid ${T.orange}40`,color:T.orange,fontSize:9,fontFamily:T.mono,cursor:reportLoading?"not-allowed":"pointer",letterSpacing:"0.1em"}}>{reportLoading?"…":"⬇ WORD REPORT"}</button>
                  </div>
                  <div style={{marginTop:6}}>
                    <button onClick={()=>generateReport(result,"both")} disabled={reportLoading} style={{width:"100%",padding:"6px",borderRadius:4,background:`${T.green}15`,border:`1px solid ${T.green}40`,color:T.green,fontSize:9,fontFamily:T.mono,cursor:reportLoading?"not-allowed":"pointer",letterSpacing:"0.1em"}}>{reportLoading?"GENERATING…":"⬇ DOWNLOAD BOTH FORMATS"}</button>
                  </div>
                  {reportError&&<div style={{marginTop:6,padding:"6px 10px",background:`${T.red}15`,border:`1px solid ${T.red}40`,borderRadius:4,fontSize:8.5,color:T.red,wordBreak:"break-all"}}>{reportError}</div>}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16}}>
                  <div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.2em",marginBottom:14}}>RISK SIGNALS</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>{Object.entries(result.signals||{}).map(([k,v])=><Bar key={k} label={k} value={v} prevValue={prev?.signals?.[k]}/>)}</div>
                </div>
                {result.counterparties?.length>0&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"12px 16px 8px",fontSize:7.5,color:T.dim,letterSpacing:"0.2em"}}>COUNTERPARTIES</div>
                  <div style={{maxHeight:190,overflow:"auto"}}>{[...result.counterparties,...hopNodes].slice(0,20).map((cp,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:`1px solid ${T.border}10`,background:i%2?`${T.panel}50`:"transparent"}}>
                      <span style={{fontSize:9,color:cp.hop>0?T.purple:cp.direction==="IN"?T.green:T.orange,width:18,textAlign:"center",flexShrink:0}}>{cp.hop>0?`H${cp.hop}`:cp.direction==="IN"?"↓":"↑"}</span>
                      <span style={{fontSize:9,color:T.accent,fontFamily:T.mono,flex:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cp.address?.slice(0,10)}…{cp.address?.slice(-6)}</span>
                      <span style={{fontSize:8.5,color:cc[cp.cat]||T.mid,flex:1}}>{cp.cat}</span>
                      <span style={{fontSize:9,color:T.mid,flex:1.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cp.label}</span>
                      <span style={{fontSize:9.5,color:cp.knownRisk!==null?RM[rl(cp.knownRisk)].color:T.dim,width:28,textAlign:"right",fontWeight:cp.knownRisk!==null?700:400,flexShrink:0}}>{cp.knownRisk!==null?cp.knownRisk:"—"}</span>
                    </div>
                  ))}</div>
                </div>}
                {diff&&diff.changes.length>0&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"12px 16px 8px",fontSize:7.5,color:T.dim,letterSpacing:"0.2em",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>CHANGES SINCE LAST SCAN</span><StatusChip flag={diff.statusFlag}/></div>
                  {diff.changes.map((c,i)=><DiffRow key={i} change={c} i={i}/>)}
                </div>}
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16}}>
                  <div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.2em",marginBottom:8}}>ANALYST NOTES</div>
                  <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="EDD rationale, override justification, compliance notes…"
                    style={{width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:4,padding:"8px 12px",color:T.text,fontSize:10,fontFamily:T.mono,resize:"vertical",minHeight:52,outline:"none",boxSizing:"border-box",lineHeight:1.6}}
                    onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
                </div>
              </div>
            </div>;
          })()}

          {!result&&!loading&&!err&&<div style={{textAlign:"center",padding:"60px 0",color:T.dim}}>
            <svg width={44} height={44} viewBox="0 0 56 56" style={{margin:"0 auto 14px",display:"block",opacity:0.15}}><polygon points="28,3 53,16 53,40 28,53 3,40 3,16" fill="none" stroke={T.accent} strokeWidth={1.5}/><circle cx={28} cy={28} r={4} fill={T.accent}/></svg>
            <div style={{fontSize:10,letterSpacing:"0.18em",marginBottom:5}}>ENTER A WALLET ADDRESS TO BEGIN</div>
            <div style={{fontSize:8.5,opacity:0.4,lineHeight:1.9}}>BTC · ETH/EVM · TRX · SOL · Scans sync to Supabase · KYC metadata optional</div>
          </div>}
        </>}

        {/* ══ REGISTRY (admin + analyst) ══ */}
        {tab==="wallets"&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <span style={{fontSize:9,color:T.mid,letterSpacing:"0.12em"}}>{registry.length} WALLET{registry.length!==1?"S":""} TRACKED</span>
            <button onClick={refreshRegistry} style={{fontSize:8.5,background:"transparent",border:`1px solid ${T.border}`,color:T.mid,padding:"4px 12px",borderRadius:4,cursor:"pointer"}}>↺ REFRESH</button>
          </div>
          {regLoading&&<div style={{color:T.dim,fontSize:10,padding:20}}>Loading…</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
            {registry.map((w,i)=>{
              const score=w.latest_score??0;const m=RM[rl(score)];const tc=(w.trend||0)>0?T.red:(w.trend||0)<0?T.green:T.mid;
              return<div key={i} style={{background:T.panel,border:`1px solid ${selectedWallet===w.address?T.purple:T.border}`,borderRadius:8,padding:16,cursor:"pointer",transition:"border-color 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=T.purple} onMouseLeave={e=>e.currentTarget.style.borderColor=selectedWallet===w.address?T.purple:T.border}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div onClick={()=>openHistory(w.address)} style={{flex:1}}>
                    <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,marginBottom:3}}>{w.address?.slice(0,12)}…{w.address?.slice(-8)}</div>
                    <div style={{fontSize:8.5,color:T.mid}}>{w.chain} · {w.entity}</div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {(role==="admin"||role==="analyst")&&<button onClick={e=>{e.stopPropagation();openMeta(w.address);}} style={{fontSize:8,background:`${T.teal}15`,border:`1px solid ${T.teal}30`,color:T.teal,padding:"3px 7px",borderRadius:3,cursor:"pointer",fontFamily:T.mono}}>KYC</button>}
                    <button onClick={e=>{e.stopPropagation();generateReport(w,"both");}} disabled={reportLoading} style={{fontSize:8,background:`${T.green}10`,border:`1px solid ${T.green}30`,color:T.green,padding:"3px 7px",borderRadius:3,cursor:"pointer",fontFamily:T.mono}}>⬇ REPORT</button>
                    <StatusChip flag={w.status_flag||"STABLE"}/>
                  </div>
                </div>
                <div onClick={()=>openHistory(w.address)} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:m.color,fontFamily:T.mono,lineHeight:1}}>{score}</div><div style={{fontSize:7.5,color:T.dim,marginTop:1}}>SCORE</div></div>
                  <div style={{flex:1}}><Badge score={score}/><div style={{marginTop:5,display:"flex",gap:8,alignItems:"center"}}><DecBadge dec={w.latest_decision}/>{(w.trend||0)!==0&&<span style={{fontSize:8.5,color:tc,fontFamily:T.mono}}>{(w.trend||0)>0?`▲ +${w.trend}`:` ▼ ${w.trend}`}</span>}</div></div>
                </div>
                <div onClick={()=>openHistory(w.address)} style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                  {[["SCANS",w.scan_count],["BALANCE",w.balance?.split(" ").slice(0,2).join(" ")],["LAST",w.last_scan?.slice(0,16)]].map(([k,v])=>(
                    <div key={k} style={{textAlign:"center"}}><div style={{fontSize:7,color:T.dim,marginBottom:2,letterSpacing:"0.1em"}}>{k}</div><div style={{fontSize:9,color:T.mid,fontFamily:T.mono}}>{v}</div></div>
                  ))}
                </div>
              </div>;
            })}
          </div>
        </>}

        {/* ══ HISTORY ══ */}
        {tab==="history"&&<>
          {!selectedWallet&&<div style={{color:T.dim,fontSize:10,padding:20,textAlign:"center"}}>{role==="junior_analyst"?"Screen a wallet to see its history here.":"Select a wallet from REGISTRY to view its scan history."}</div>}
          {selectedWallet&&<>
            <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:14,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:T.accent,fontFamily:T.mono,marginBottom:2}}>{selectedWallet}</div>
                <div style={{fontSize:8.5,color:T.mid,marginBottom:6}}>{walletScans.length} scan{walletScans.length!==1?"s":""} · {walletChanges.length} change events</div>
                {walletMeta&&<div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:6}}>
                  {walletMeta.owner_name&&<span style={{fontSize:9,color:T.text,padding:"2px 8px",background:`${T.accent}10`,border:`1px solid ${T.accent}20`,borderRadius:3}}>👤 {walletMeta.owner_name}</span>}
                  {walletMeta.wallet_reference&&<span style={{fontSize:9,color:T.mid,padding:"2px 8px",background:`${T.border}`,borderRadius:3}}>REF: {walletMeta.wallet_reference}</span>}
                  {walletMeta.entity_type&&<span style={{fontSize:9,color:T.teal,padding:"2px 8px",background:`${T.teal}10`,border:`1px solid ${T.teal}20`,borderRadius:3}}>{walletMeta.entity_type}</span>}
                  {walletMeta.jurisdiction&&<span style={{fontSize:9,color:T.mid,padding:"2px 8px",background:`${T.border}`,borderRadius:3}}>📍 {walletMeta.jurisdiction}</span>}
                  {walletMeta.risk_classification&&<span style={{fontSize:9,color:RM[walletMeta.risk_classification?.toUpperCase()]?.color||T.mid,padding:"2px 8px",borderRadius:3,border:`1px solid ${RM[walletMeta.risk_classification?.toUpperCase()]?.color||T.border}40`,background:`${RM[walletMeta.risk_classification?.toUpperCase()]?.color||T.dim}10`}}>INTERNAL: {walletMeta.risk_classification}</span>}
                </div>}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                {(role==="admin"||role==="analyst")&&<button onClick={()=>openMeta(selectedWallet)} style={{padding:"5px 12px",borderRadius:4,background:`${T.teal}15`,border:`1px solid ${T.teal}40`,color:T.teal,fontSize:9,fontFamily:T.mono,cursor:"pointer",letterSpacing:"0.1em"}}>📋 {walletMeta?"EDIT KYC":"ADD KYC"}</button>}
                <button onClick={()=>{setAddr(selectedWallet);setTab("screen");}} style={{padding:"5px 12px",borderRadius:4,background:`${T.accent}15`,border:`1px solid ${T.accent}40`,color:T.accent,fontSize:9,fontFamily:T.mono,cursor:"pointer",letterSpacing:"0.1em"}}>RE-SCREEN</button>
              </div>
            </div>

            <div style={{display:"flex",borderBottom:`1px solid ${T.border}`,marginBottom:16}}>
              {[["timeline","TIMELINE"],["scans","SCAN LIST"],["changes","CHANGE LOG"],["compare","COMPARE"]].map(([id,label])=>(
                <button key={id} onClick={()=>setHistoryTab(id)} style={{padding:"8px 14px",fontSize:8.5,letterSpacing:"0.12em",fontFamily:T.mono,background:"transparent",border:"none",cursor:"pointer",color:historyTab===id?T.purple:T.dim,borderBottom:historyTab===id?`2px solid ${T.purple}`:"2px solid transparent"}}>{label}</button>
              ))}
            </div>

            {historyTab==="timeline"&&<>
              <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:20,marginBottom:14}}>
                <div style={{fontSize:8,color:T.dim,letterSpacing:"0.18em",marginBottom:12}}>RISK SCORE OVER TIME — {walletScans.length} scan{walletScans.length!==1?"s":""}</div>
                <TimelineChart scans={walletScans} width={700} height={100}/>
              </div>
              {walletScans.length>1&&(()=>{const scores=walletScans.map(s=>s.overall_score);const latest=walletScans[0],oldest=walletScans[walletScans.length-1];const td=latest.overall_score-oldest.overall_score;
                return<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
                  {[["LATEST",latest.overall_score,RM[rl(latest.overall_score)].color],["PEAK",Math.max(...scores),RM[rl(Math.max(...scores))].color],["LOWEST",Math.min(...scores),RM[rl(Math.min(...scores))].color],["TOTAL DRIFT",td>0?`+${td}`:td,td>0?T.red:td<0?T.green:T.mid]].map(([k,v,c])=>(
                    <div key={k} style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,padding:"12px 14px",textAlign:"center"}}><div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.12em",marginBottom:4}}>{k}</div><div style={{fontSize:20,fontWeight:800,color:c,fontFamily:T.mono}}>{v}</div></div>
                  ))}</div>;
              })()}
              <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"12px 16px",fontSize:7.5,color:T.dim,letterSpacing:"0.18em"}}>SCAN EVENT LOG</div>
                {walletScans.map((scan,i)=>{const m=RM[rl(scan.overall_score)];return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",borderBottom:`1px solid ${T.border}15`,background:i%2?`${T.panel}50`:"transparent"}}>
                    <div style={{width:3,alignSelf:"stretch",background:m.color,borderRadius:2,flexShrink:0,opacity:0.8}}/>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                        <span style={{fontSize:8.5,color:T.dim,fontFamily:T.mono}}>{scan.scanned_at?.slice(0,16)}</span>
                        <StatusChip flag={scan.status_flag||"STABLE"}/>
                        {scan.scanned_by_email&&<span style={{fontSize:8,color:T.dim}}>by {scan.scanned_by_email}</span>}
                      </div>
                      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                        <Badge score={scan.overall_score}/><DecBadge dec={scan.decision}/>
                        {(scan.score_delta||0)!==0&&<span style={{fontSize:9,color:(scan.score_delta||0)>0?T.red:T.green,fontFamily:T.mono,fontWeight:700}}>{(scan.score_delta||0)>0?`▲ +${scan.score_delta}`:` ▼ ${scan.score_delta}`}</span>}
                        <span style={{fontSize:9,color:T.dim}}>{scan.balance}</span>
                      </div>
                    </div>
                  </div>);
                })}
              </div>
            </>}

            {historyTab==="scans"&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
              {walletScans.map((scan,i)=>(
                <div key={i} style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${T.border}`,background:`${T.card}80`,flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:9,color:T.dim,fontFamily:T.mono}}>{scan.scanned_at?.slice(0,16)}</span>
                      <Badge score={scan.overall_score}/><DecBadge dec={scan.decision}/><StatusChip flag={scan.status_flag||"STABLE"}/>
                      {scan.scanned_by_email&&<span style={{fontSize:8,color:T.dim}}>by {scan.scanned_by_email}</span>}
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      {(scan.score_delta||0)!==0&&<span style={{fontSize:9,color:(scan.score_delta||0)>0?T.red:T.green,fontFamily:T.mono,fontWeight:700}}>{(scan.score_delta||0)>0?`▲ +${scan.score_delta}`:` ▼ ${scan.score_delta}`}</span>}
                      <button onClick={()=>{setCompareA(scan);setCompareB(walletScans[i+1]||null);setHistoryTab("compare");}} style={{fontSize:8,background:"transparent",border:`1px solid ${T.border}`,color:T.mid,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:T.mono}}>COMPARE</button>
                      <button onClick={()=>generateReport(scan,"pdf")} disabled={reportLoading} style={{fontSize:8,background:`${T.red}10`,border:`1px solid ${T.red}30`,color:T.red,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:T.mono}}>PDF</button>
                      <button onClick={()=>generateReport(scan,"docx")} disabled={reportLoading} style={{fontSize:8,background:`${T.orange}10`,border:`1px solid ${T.orange}30`,color:T.orange,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:T.mono}}>DOCX</button>
                    </div>
                  </div>
                  <div style={{padding:"12px 16px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {Object.entries(scan.signals||{}).map(([k,v])=>(
                      <div key={k}><div style={{fontSize:7.5,color:T.dim,marginBottom:2}}>{k.replace(/([A-Z])/g," $1").trim().toUpperCase()}</div><div style={{height:2,borderRadius:1,background:T.border}}><div style={{height:"100%",width:`${v}%`,background:RM[rl(v)].color,borderRadius:1}}/></div><div style={{fontSize:8.5,color:RM[rl(v)].color,fontFamily:T.mono,marginTop:2}}>{Math.round(v)}</div></div>
                    ))}
                  </div>
                  {scan.analyst_note&&<div style={{padding:"8px 16px",borderTop:`1px solid ${T.border}`,fontSize:9,color:T.mid,fontStyle:"italic"}}>"{scan.analyst_note}"</div>}
                </div>
              ))}
            </div>}

            {historyTab==="changes"&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
              <div style={{padding:"12px 16px",fontSize:7.5,color:T.dim,letterSpacing:"0.18em"}}>{walletChanges.length} CHANGE EVENT{walletChanges.length!==1?"S":""}</div>
              {walletChanges.length===0&&<div style={{padding:20,textAlign:"center",color:T.dim,fontSize:10}}>No changes recorded yet.</div>}
              {walletChanges.map((c,i)=><DiffRow key={i} change={c} i={i}/>)}
            </div>}

            {historyTab==="compare"&&<>
              <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                {["Scan A (Newer)","Scan B (Older)"].map((label,li)=>(
                  <div key={li} style={{flex:1,minWidth:220}}>
                    <div style={{fontSize:8,color:T.dim,marginBottom:5,letterSpacing:"0.1em"}}>{label}</div>
                    <select value={li===0?compareA?.id||"":compareB?.id||""} onChange={e=>{const s=walletScans.find(x=>x.id===e.target.value)||null;li===0?setCompareA(s):setCompareB(s);}} style={{width:"100%",background:T.panel,border:`1px solid ${T.border}`,borderRadius:4,padding:"7px 12px",color:T.text,fontSize:10,fontFamily:T.mono,outline:"none",cursor:"pointer"}}>
                      <option value="">— select —</option>
                      {walletScans.map(s=><option key={s.id} value={s.id}>{s.scanned_at?.slice(0,16)} · {s.overall_score} · {s.decision} · {s.scanned_by_email||"?"}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {compareA&&compareB&&(()=>{
                const older={...compareB,overallScore:compareB.overall_score,decision:compareB.decision,entity:compareB.entity,balance:compareB.balance,counterparties:compareB.counterparties||[]};
                const newer={...compareA,overallScore:compareA.overall_score,decision:compareA.decision,entity:compareA.entity,balance:compareA.balance,counterparties:compareA.counterparties||[]};
                const diff=analyzeDiff(older,newer);
                return<>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:16,marginBottom:14,alignItems:"center"}}>
                    {[older,newer].map((scan,si)=>(
                      <div key={si} style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16,textAlign:"center"}}>
                        <div style={{fontSize:7.5,color:T.dim,marginBottom:8,letterSpacing:"0.15em"}}>{si===0?"OLDER":"NEWER"}</div>
                        <Gauge score={scan.overallScore}/><Badge score={scan.overallScore}/>
                        <div style={{marginTop:8,fontSize:8.5,color:T.mid,fontFamily:T.mono}}>{(scan.scanned_at||scan.ts)?.slice(0,16)}</div>
                        <div style={{marginTop:4}}><DecBadge dec={scan.decision}/></div>
                        {scan.scanned_by_email&&<div style={{marginTop:4,fontSize:8,color:T.dim}}>by {scan.scanned_by_email}</div>}
                      </div>
                    ))}
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:7.5,color:T.dim,marginBottom:5}}>NET CHANGE</div>
                      <div style={{fontSize:26,fontWeight:800,color:diff.scoreDelta>0?T.red:diff.scoreDelta<0?T.green:T.mid,fontFamily:T.mono}}>{diff.scoreDelta>0?`+${diff.scoreDelta}`:diff.scoreDelta}</div>
                      <div style={{marginTop:5}}><StatusChip flag={diff.statusFlag}/></div>
                    </div>
                  </div>
                  <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,padding:16,marginBottom:14}}>
                    <div style={{fontSize:7.5,color:T.dim,letterSpacing:"0.18em",marginBottom:12}}>SIGNAL COMPARISON</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>{Object.entries(newer.signals||{}).map(([k,v])=><Bar key={k} label={k} value={v} prevValue={older.signals?.[k]}/>)}</div>
                  </div>
                  {diff.changes.length>0&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
                    <div style={{padding:"12px 16px 8px",fontSize:7.5,color:T.dim,letterSpacing:"0.18em"}}>{diff.changes.length} CHANGE{diff.changes.length!==1?"S":""} DETECTED</div>
                    {diff.changes.map((c,i)=><DiffRow key={i} change={c} i={i}/>)}
                  </div>}
                </>;
              })()}
              {(!compareA||!compareB)&&<div style={{color:T.dim,fontSize:10,padding:20,textAlign:"center"}}>Select two scans to compare.</div>}
            </>}
          </>}
        </>}

        {/* ══ AUDIT LOG (admin only) ══ */}
        {tab==="log"&&role==="admin"&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <span style={{fontSize:9,color:T.mid,letterSpacing:"0.14em"}}>DFSA COMPLIANCE AUDIT LOG — all users · all wallets</span>
            <button onClick={exportCSV} style={{fontSize:9,background:"transparent",border:`1px solid ${T.border}`,color:T.accent,padding:"4px 12px",borderRadius:4,cursor:"pointer",letterSpacing:"0.1em"}}>↓ EXPORT ALL CSV</button>
          </div>
          <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:8,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:9.5,fontFamily:T.mono,minWidth:900}}>
              <thead><tr style={{background:T.bg}}>{["LAST SCAN","ADDRESS","CHAIN","SCORE","RISK","ENTITY","DECISION","BALANCE","SCANS","TREND"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",color:T.dim,fontWeight:600,letterSpacing:"0.08em",borderBottom:`1px solid ${T.border}`,fontSize:7.5,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{registry.length===0?<tr><td colSpan={10} style={{padding:24,textAlign:"center",color:T.dim}}>No scans recorded</td></tr>:registry.map((w,i)=>{
                const score=w.latest_score??0;const m=RM[rl(score)];const dc=w.latest_decision==="ACCEPT"?T.green:w.latest_decision==="REVIEW"?T.yellow:T.red;const tc=(w.trend||0)>0?T.red:(w.trend||0)<0?T.green:T.mid;
                return<tr key={i} style={{borderBottom:`1px solid ${T.border}15`,background:i%2?`${T.panel}60`:"transparent",cursor:"pointer"}} onClick={()=>openHistory(w.address)}>
                  <td style={{padding:"8px 12px",color:T.dim,fontSize:8.5,whiteSpace:"nowrap"}}>{w.last_scan?.slice(0,16)}</td>
                  <td style={{padding:"8px 12px",color:T.accent,fontSize:9}}>{w.address?.slice(0,10)}…{w.address?.slice(-5)}</td>
                  <td style={{padding:"8px 12px",color:T.mid}}>{w.chain}</td>
                  <td style={{padding:"8px 12px",color:m.color,fontWeight:700}}>{score}</td>
                  <td style={{padding:"8px 12px"}}><Badge score={score}/></td>
                  <td style={{padding:"8px 12px",color:T.mid,fontSize:8.5}}>{w.entity}</td>
                  <td style={{padding:"8px 12px",color:dc,fontWeight:700}}>{w.latest_decision}</td>
                  <td style={{padding:"8px 12px",color:T.dim,fontSize:8.5}}>{w.balance}</td>
                  <td style={{padding:"8px 12px",color:T.purple,fontWeight:700}}>{w.scan_count}</td>
                  <td style={{padding:"8px 12px",color:tc,fontWeight:700,fontSize:9}}>{(w.trend||0)>0?`▲ +${w.trend}`:(w.trend||0)<0?` ▼ ${w.trend}`:"—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');*{box-sizing:border-box;}input::placeholder,textarea::placeholder{color:${T.dim};}select option{background:${T.panel};}::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:${T.bg};}::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px;}`}</style>
    </div>
  );
}
