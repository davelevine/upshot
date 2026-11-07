import { readFileSync } from 'node:fs';
import { classify, extract, feedArticle, clean } from './functions/api/read.js';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const d=JSON.parse(readFileSync('site/data.json','utf8')).items, feeds=JSON.parse(readFileSync('site/feeds.json','utf8'));
const words=h=>h.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length, cache={};
async function one(i){ let why='error';
  try{ const r=await fetch(i.url,{headers:{'User-Agent':UA,Accept:'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(15000)}); const h=(await r.text()).slice(0,3e6); const b=classify(r,h);
    if(b)why=b+':'+r.status; else{const a=extract(h); if(a)return{p:i.publisher,how:'page',w:words(clean(a.content,r.url||i.url))}; why='noextract';}
  }catch(e){why=e.name==='TimeoutError'?'timeout':'error'}
  if(feeds[i.publisher])try{ cache[i.publisher]??=fetch(feeds[i.publisher],{headers:{'User-Agent':UA},signal:AbortSignal.timeout(20000)}).then(r=>r.ok?r.text():'');const f=feedArticle(await cache[i.publisher],i.url); if(f)return{p:i.publisher,how:'feed',w:words(f)};}catch{}
  return{p:i.publisher,how:why,w:0}; }
const out=[],q=[...d]; await Promise.all(Array.from({length:6},async()=>{while(q.length)out.push(await one(q.shift()))}));
const by={};for(const r of out){(by[r.p]??={})[r.how]=(by[r.p][r.how]||0)+1}
const tot={};for(const r of out){const k=r.how==='page'||r.how==='feed'?r.how:'FAILED';tot[k]=(tot[k]||0)+1}
console.log('TOTAL',out.length,JSON.stringify(tot));for(const p of Object.keys(by).sort())console.log('PUB',p,JSON.stringify(by[p]));
