import { generateKeyPairSync, createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.RIGHT_TO_REPLY_PLAYWRIGHT || 'playwright');
const { PNG } = require('pngjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const all = JSON.parse(readFileSync(process.env.R2R_SITES_FILE || join(root,'tests/compatibility-sites.json'),'utf8'));
const shard=Number(process.env.R2R_SHARD||0), shards=Number(process.env.R2R_SHARDS||1);
if(!Number.isInteger(shard)||!Number.isInteger(shards)||shards<1||shard<0||shard>=shards)throw Error('Invalid shard');
const targets=all.filter((_,i)=>i%shards===shard);
const out=join(root,'compatibility-results','shard-'+shard);
mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'r2r-compatibility-'));
const extension=join(temp,'extension');
cpSync(join(root,'dist','chrome'),extension,{recursive:true});
const manifestPath=join(extension,'manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const der=publicKey.export({type:'spki',format:'der'});
manifest.key=der.toString('base64');
const id=createHash('sha256').update(der).digest('hex').slice(0,32).replace(/[0-9a-f]/g,d=>String.fromCharCode(97+parseInt(d,16)));
writeFileSync(manifestPath,JSON.stringify(manifest));
// Mock only the disposable extension's background fetch. Production code and
// public party data are unchanged. No test response ever gets published.
const sourcePath=join(extension,'sources.js');
writeFileSync(sourcePath,readFileSync(sourcePath,'utf8')+
  "\n;globalThis.fetch = async url => { const p = new URL(url); "+
  "if (p.origin === 'https://raw.githubusercontent.com' && p.pathname.startsWith('/owner/compatibility-fixture/main/responses/')) "+
  "return new Response('Compatibility test reply.\\n\\nFictional reply used only by the automated test.\\n'); "+
  "return new Response('',{status:404}); };\n");
const mark='[data-right-to-reply-mark]', control='[data-right-to-reply-control]';
const clean=e=>String(e?.message||e).replace(/https?:\/\/[^\s)]+/g,'[URL]').slice(0,300);
const unique=a=>[...new Set(a)];
const pause=(p,ms)=>p.waitForTimeout(ms);
async function screenshot(page){try{return await page.screenshot({timeout:5000,animations:'disabled'});}catch{return null;}}
function pixels(a,b){
  if(!a||!b)return null;
  const x=PNG.sync.read(a),y=PNG.sync.read(b);
  if(x.width!==y.width||x.height!==y.height)return null;
  let changed=0;
  for(let i=0;i<x.data.length;i+=4)if(Math.max(...[0,1,2].map(j=>Math.abs(x.data[i+j]-y.data[i+j])))>32)changed++;
  return +(100*changed/(x.width*x.height)).toFixed(2);
}
async function task(cdp){try{return (await cdp.send('Performance.getMetrics')).metrics.find(x=>x.name==='TaskDuration')?.value??null;}catch{return null;}}
const ms=(a,b)=>a===null||b===null?null:Math.round(1000*Math.max(0,b-a));
async function articleLink(page){
  return page.evaluate(()=>{
    if([...document.querySelectorAll('article p')].filter(x=>x.innerText.length>120).length>=3)return null;
    for(const a of document.querySelectorAll('main a[href],article a[href],[role="main"] a[href]')){
      if(!a.getClientRects().length||a.innerText.trim().length<25||a.closest('nav,footer,aside'))continue;
      const u=new URL(a.href,location.href);
      if(u.origin!==location.origin||u.pathname===location.pathname||u.hash)continue;
      if(/\/(?:login|subscribe|account|video|podcast|live|comment|privacy|terms|search)(?:\/|$)/i.test(u.pathname))continue;
      if(!/(?:\/articles?\/|\/story\/|\/news\/[^/]+\/|\/\d{4}\/|-\d{5,}(?:\/|\.html|$)|\/[a-z0-9-]{35,}(?:\/|\.html|$))/i.test(u.pathname))continue;
      u.search='';return u.href;
    }
    return null;
  });
}
async function sample(page){
  return page.evaluate(()=>{
    const root=document.querySelector('main,[role="main"]')||document.body;
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility==='visible';
    const blocks=[...root.querySelectorAll('p,h1,h2')].filter(e=>visible(e)&&!e.closest('nav,footer,aside,button,[hidden],[aria-hidden="true"]')).map(e=>e.innerText.trim()).filter(s=>s.length>=50).sort((a,b)=>b.length-a.length);
    const keywords=[],excluded=new Set(['about','there','their','which','would','could','these','those','other','after','before','where','while','because','should','being','first','through']);
    for(const block of blocks.slice(0,8)){
      for(const word of block.toLowerCase().match(/[a-z]{5,18}/g)||[])if(!excluded.has(word)&&!keywords.includes(word)){keywords.push(word);break;}
      if(keywords.length>=4)break;
    }
    return {keywords,paragraphs:blocks.length,textLength:(root.innerText||'').length};
  });
}
// Keep references to existing publisher nodes to distinguish natural changes
// in advertisements/live feeds from modifications to those same nodes.
async function capture(page){
  return page.evaluate(()=>{
    function text(el){
      const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let s='';
      for(let n=w.nextNode();n;n=w.nextNode())if(!n.parentElement.closest('[data-right-to-reply-control]'))s+=n.data;
      return s.replace(/\s+/g,' ').trim();
    }
    const nodes=[...document.querySelectorAll('p,h1,h2,h3,a[href],button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[data-right-to-reply-control]')).slice(0,500);
    window.__r2rCompatibilityProbe={nodes:nodes.map(el=>({el,text:text(el),href:el.getAttribute('href'),height:el.getBoundingClientRect().height})),text};
    return {nodes:nodes.length,scrollY,documentHeight:document.documentElement.scrollHeight};
  });
}
async function compare(page){
  return page.evaluate(()=>{
    const probe=window.__r2rCompatibilityProbe;
    const s={connected:0,removed:0,textChanged:0,hrefChanged:0,layoutChanged:0,documentHeight:document.documentElement.scrollHeight,scrollY};
    if(!probe)return s;
    for(const n of probe.nodes){
      if(!n.el.isConnected){s.removed++;continue;}
      s.connected++;
      if(probe.text(n.el)!==n.text)s.textChanged++;
      if(n.el.getAttribute('href')!==n.href)s.hrefChanged++;
      if(Math.abs(n.el.getBoundingClientRect().height-n.height)>4)s.layoutChanged++;
    }
    return s;
  });
}
const data=keywords=>({schemaVersion:2,disclaimer:{},parties:[{repository:'owner/compatibility-fixture',id:'compatibility-fixture',name:'Compatibility Fixture',color:'#000000',identifiers:['Compatibility Fixture','the','and','of','to','in'],keywords}]});
let context;
const results=[];
try{
  context=await chromium.launchPersistentContext(join(temp,'profile'),{
    channel:'chromium',executablePath:process.env.RIGHT_TO_REPLY_BROWSER||undefined,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],
    viewport:{width:1280,height:900},locale:'en-GB',timezoneId:'Europe/London'
  });
  const settings=context.pages()[0];
  await settings.goto('chrome-extension://'+id+'/settings.html');
  const configure=(enabled,keywords)=>settings.evaluate(async({enabled,data})=>{
    const time=Date.now();
    await chrome.storage.local.set({enabled,sites:{},lastAttempt:time,snapshot:{data,failed:[],checkedAt:time,version:time}});
  },{enabled,data:data(keywords)});
  for(const target of targets){
    const r={id:target.id,entry:target.url,status:'inconclusive',issues:[],warnings:[]};
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    const errors=[];
    page.on('pageerror',e=>errors.push(clean(e)));
    let before,noise,after,popupImage;
    try{
      await configure(false,[]);
      await page.bringToFront();
      let response=await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:20000});
      if(!response||response.status()>=400){r.reason='HTTP '+(response?.status()??'no response');continue;}
      await pause(page,1200);
      const article=await articleLink(page);
      if(article){
        response=await page.goto(article,{waitUntil:'domcontentloaded',timeout:20000});
        if(!response||response.status()>=400){r.reason='Article HTTP '+(response?.status()??'no response');continue;}
        await pause(page,1200);
      }
      r.url=page.url().split('?')[0];r.pageType=article?'article link':'entry page';
      const s=await sample(page);r.paragraphs=s.paragraphs;
      if(!s.keywords.length||s.textLength<200){r.reason='No accessible article-sized text (possibly blocked or consent-gated)';continue;}
      const keywords=unique(['government','policy','economy','health',...s.keywords]);
      r.keywordCount=keywords.length;
      const cdp=await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      r.baseline=await capture(page);
      before=await screenshot(page);
      const t0=await task(cdp);
      await pause(page,1000);
      const t1=await task(cdp);
      noise=await screenshot(page);
      r.baselineDrift=await compare(page);
      r.baselineErrors=unique(errors);
      const errorStart=errors.length;
      await configure(true,keywords);
      try{await page.locator(mark).first().waitFor({state:'attached',timeout:10000});}
      catch{r.reason='No matching markup produced';continue;}
      const e0=await task(cdp);
      await pause(page,1000);
      const e1=await task(cdp);
      r.taskMs={off:ms(t0,t1),enable:ms(t1,e0),on:ms(e0,e1)};
      r.marks=await page.locator(mark).count();r.controls=await page.locator(control).count();
      r.enabled=await compare(page);
      after=await screenshot(page);
      r.pixelChange={baseline:pixels(before,noise),enabled:pixels(noise,after)};
      const trigger=page.locator(control+','+mark+'[role="button"]').first();
      if(await trigger.count()){
        try{
          await trigger.scrollIntoViewIfNeeded({timeout:5000});
          await trigger.press('Enter',{timeout:5000});
          r.popup=false;
          for(let i=0;i<20;i++){
            const {nodes}=await cdp.send('Accessibility.getFullAXTree');
            const dialog=nodes.find(n=>n.role.value==='dialog'&&n.name?.value==='Right to Reply');
            if(dialog&&nodes.some(n=>n.name?.value?.includes('Compatibility test reply.'))){r.popup=true;break;}
            await pause(page,150);
          }
          popupImage=await screenshot(page);
          await page.keyboard.press('Escape');
          if(!r.popup)r.issues.push('Popup did not expose the fictional reply');
        }catch(e){r.issues.push('Popup interaction: '+clean(e));}
      }else r.issues.push('No keyboard-accessible reply control');
      await page.evaluate(()=>scrollBy(0,Math.min(600,innerHeight)));
      await pause(page,700);
      r.afterScrollMarks=await page.locator(mark).count();
      await configure(false,keywords);
      await page.locator(mark+','+control).first().waitFor({state:'detached',timeout:8000});
      r.restored=await compare(page);
      if(r.enabled.textChanged>r.baselineDrift.textChanged&&r.restored.textChanged<r.enabled.textChanged)r.issues.push('Publisher text changed while enabled and recovered on disable');
      if(r.enabled.hrefChanged>r.baselineDrift.hrefChanged&&r.restored.hrefChanged<r.enabled.hrefChanged)r.issues.push('Publisher link destinations changed while enabled');
      if(r.enabled.removed>r.baselineDrift.removed)r.warnings.push('Publisher replaced original nodes');
      if(r.enabled.layoutChanged>r.baselineDrift.layoutChanged)r.warnings.push('Layout changed; inspect screenshots');
      if((r.pixelChange.enabled??0)>(r.pixelChange.baseline??0)+5)r.warnings.push('Visual change exceeds baseline by >5 percentage points');
      // A second navigation starts with the extension enabled.
      await configure(true,keywords);
      response=await page.reload({waitUntil:'domcontentloaded',timeout:20000});
      if(!response||response.status()>=400)r.warnings.push('Enabled reload blocked or unavailable');
      else{
        try{await page.locator(mark).first().waitFor({state:'attached',timeout:8000});r.reloadMarks=await page.locator(mark).count();}
        catch{r.warnings.push('No matching markup on enabled reload; content may have changed');}
      }
      r.newErrors=unique(errors.slice(errorStart)).filter(e=>!r.baselineErrors.includes(e));
      if(r.newErrors.length)r.warnings.push('New JavaScript errors after enable; causality unconfirmed');
      r.status=r.issues.length?'review-failure':r.warnings.length?'review':'pass';
    }catch(e){r.reason=clean(e);if(r.marks){r.status='review-failure';r.issues.push(r.reason);}}
    finally{
      if(r.status==='review'||r.status==='review-failure'){
        for(const [name,buffer] of [['before',before],['enabled',after],['popup',popupImage]])if(buffer)writeFileSync(join(out,target.id+'-'+name+'.png'),buffer);
      }
      results.push(r);
      console.log(target.id+': '+r.status+' ('+(r.marks??0)+' marks) '+(r.reason||r.issues.join('; ')||r.warnings.join('; ')));
      writeFileSync(join(out,'report.json'),JSON.stringify(results,null,2));
      await page.close().catch(()=>{});
    }
  }
}finally{await context?.close();rmSync(temp,{recursive:true,force:true});}
const counts=Object.fromEntries(['pass','review','review-failure','inconclusive'].map(k=>[k,results.filter(r=>r.status===k).length]));
const summary=['## Real-site compatibility — shard '+shard,'','Targets: '+results.length+' · '+Object.entries(counts).map(([k,v])=>k+': '+v).join(' · '),'','| Site | Result | Marks | Notes |','|---|---|---:|---|',...results.map(r=>'| '+r.id+' | '+r.status+' | '+(r.marks??0)+' | '+(r.reason||[...r.issues,...r.warnings].join('; ')||'—').replace(/\|/g,'/')+' |')].join('\n')+'\n';
console.log(summary);writeFileSync(join(out,'summary.md'),summary);
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
// Diagnostic only: live sites are variable. Inconclusive sites are not passes.
