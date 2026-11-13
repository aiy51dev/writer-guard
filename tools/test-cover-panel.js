/* ============================================================
 * 封面设计 · 右侧属性面板结构测试（CDP）
 * 验证：默认展开 / 可折叠 / 面板顺序（对齐→工具→文字→图层→…→画布背景）/
 *       文字内容框无「内容」标签
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT_STATIC = 8904;
const PORT_CDP = 9349;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => server.listen(PORT_STATIC, () => r(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK = `
(function(){
  var mem={}, ls=[];
  function cb(o,f){ if(typeof f==='function'){setTimeout(function(){f(o)},0);return;} return Promise.resolve(o); }
  var local={get:function(k,f){var o={};if(k==null)o=Object.assign({},mem);else if(typeof k==='string'){if(k in mem)o[k]=mem[k];}else if(Array.isArray(k))k.forEach(function(x){if(x in mem)o[x]=mem[x];});else if(typeof k==='object')Object.keys(k).forEach(function(x){o[x]=(x in mem)?mem[x]:k[x];});return cb(o,f);},set:function(o,f){Object.assign(mem,o);ls.forEach(function(x){try{x(o,'local')}catch(e){}});return cb({},f);},remove:function(k,f){(Array.isArray(k)?k:[k]).forEach(function(x){delete mem[x]});return cb({},f);},clear:function(f){Object.keys(mem).forEach(function(x){delete mem[x]});return cb({},f);}};
  window.chrome=window.chrome||{};
  window.chrome.storage={local:local,sync:local,onChanged:{addListener:function(f){ls.push(f)},removeListener:function(){}}};
  window.chrome.runtime={id:'t',getURL:function(p){return '/'+p},sendMessage:function(){},onMessage:{addListener:function(){}},lastError:null};
  window.chrome.tabs={query:function(o,f){if(f)f([]);return Promise.resolve([])},sendMessage:function(){}};
})();
`;

const SCRIPT = `(async function(){
  var out=[];
  var chk=function(n,ok,ex){out.push({n:n,ok:!!ok,ex:ex===undefined?'':String(ex)})};
  var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    var app=document.getElementById('cover-app');
    chk('封面视图已加载', !!app);
    chk('右侧面板默认展开', app.classList.contains('is-right-open'), app.className);

    var ins=document.getElementById('cv-inspector');
    chk('属性面板容器存在', !!ins);

    /* 加一个文字层 */
    var add='';
    if(ins.querySelector('[data-add="text"]')){ ins.querySelector('[data-add="text"]').click(); }
    var kids=Array.prototype.map.call(ins.children,function(el){return el.className});

    chk('第 1 块是左/中/右对齐', !!(ins.children[0]&&ins.children[0].classList.contains('cv-align-group')), kids[0]);
    chk('第 2 块是添加工具', !!(ins.children[1]&&ins.children[1].classList.contains('cv-add-row-top')), kids[1]);
    chk('第 3 块是文字内容框', !!(ins.children[2]&&ins.children[2].classList.contains('cv-text-block')), kids[2]);

    var tb=ins.querySelector('.cv-text-block');
    chk('文字框能直接改字', !!(tb&&tb.querySelector('textarea[data-k="text"]')));
    chk('文字框不再有「内容」标签', !(tb&&/内容/.test(tb.textContent)), tb?tb.textContent.slice(0,30):'');
    chk('工具顺序：文字/图片/矩形/圆形/线条',
      /文字[\\s\\S]*图片[\\s\\S]*矩形[\\s\\S]*圆形[\\s\\S]*线条/.test(ins.querySelector('.cv-add-row-top').textContent),
      ins.querySelector('.cv-add-row-top').textContent.replace(/\\s+/g,' '));

    var last=ins.children[ins.children.length-1];
    chk('画布背景在面板最底部', !!(last&&last.classList.contains('cv-bg-group')),
      last?last.className:'?');

    /* 点右三角折叠 / 再点展开 */
    document.getElementById('cv-tri-right').click();
    chk('点折叠区可收起', !app.classList.contains('is-right-open'), app.className);
    document.getElementById('cv-tri-right').click();
    chk('再点可展开回来', app.classList.contains('is-right-open'), app.className);

    /* ---------- 复制成图片（不丢背景和内容） ---------- */
    var copyBtn=document.getElementById('cv-copy');
    chk('有「复制」按钮', !!copyBtn);
    chk('复制排在「插入编辑器」前面',
      !!(copyBtn&&copyBtn.nextElementSibling&&copyBtn.nextElementSibling.id==='cv-insert'),
      copyBtn&&copyBtn.nextElementSibling?copyBtn.nextElementSibling.id:'none');

    var wrote=null;
    try{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        write:function(items){ wrote=items; return Promise.resolve(); }
      }});
    }catch(e){ /* 覆盖不了就走真实剪贴板 */ }

    copyBtn.click();
    for(var wi=0;wi<60&&!wrote;wi++){ await wait(50); }
    chk('点「复制」会写剪贴板', !!wrote, wrote?'ok':'没触发写入');
    var item=(wrote||[])[0];
    var types=(item&&item.types)||[];
    chk('剪贴板同时带 PNG 和 HTML（公众号走 HTML 才不糊）',
      types.indexOf('image/png')>=0 && types.indexOf('text/html')>=0, types.join(',')||'none');

    var htmlBlob=null;
    try{ htmlBlob=item?await item.getType('text/html'):null; }catch(e){}
    var htmlTxt=htmlBlob?await htmlBlob.text():'';
    chk('HTML 版本里是原始像素的 <img>',
      htmlTxt.indexOf('<img src="data:image/png;base64,')===0, htmlTxt.slice(0,40));

    var blob=null;
    try{ blob=item?await item.getType('image/png'):null; }catch(e){}
    chk('能取出图片数据', !!blob&&blob.size>1000, blob?blob.size+'B':'none');

    var bmp=null;
    try{ bmp=await createImageBitmap(blob); }catch(e){}
    chk('图片能正常解码', !!bmp, bmp?bmp.width+'x'+bmp.height:'fail');
    if(bmp){
      chk('导出的是高清图（900×383 → 3 倍 2700×1149，公众号里不糊）',
        bmp.width>=2700&&bmp.height>=1149, bmp.width+'x'+bmp.height);

      var c2=document.createElement('canvas');
      c2.width=bmp.width; c2.height=bmp.height;
      var x2=c2.getContext('2d');
      x2.drawImage(bmp,0,0);
      var d=x2.getImageData(0,0,bmp.width,bmp.height).data;
      var px=function(x,y){var i=(y*bmp.width+x)*4;return [d[i],d[i+1],d[i+2],d[i+3]];};
      var tl=px(2,2), tr=px(bmp.width-3,2), bl=px(2,bmp.height-3), br=px(bmp.width-3,bmp.height-3);

      chk('四角都有背景（alpha 全 255，不是透明底）',
        tl[3]===255&&tr[3]===255&&bl[3]===255&&br[3]===255,
        [tl[3],tr[3],bl[3],br[3]].join('/'));

      var bg=WG.__coverTest.S.bg;
      if(bg.type==='corners'){
        var uniq={}; [tl,tr,bl,br].forEach(function(p){uniq[p.slice(0,3).join()]=1;});
        chk('四角渐变背景完整保留（四色各不相同）', Object.keys(uniq).length>=3,
          Object.keys(uniq).join(' | '));
      }else{
        chk('背景色铺满画布', tl[3]===255&&tl[0]===br[0]&&tl[1]===br[1], tl.join(',')+' vs '+br.join(','));
      }

      /* 内容层：文字是浅色（#fff）画在深色背景上 */
      var light=0,total=0;
      for(var pi=0;pi<d.length;pi+=4*29){ total++; if(d[pi]>200&&d[pi+1]>200&&d[pi+2]>200) light++; }
      chk('画面里有编辑好的内容（文字像素）', light>0, light+'/'+total+' 亮像素');
    }
  }catch(e){ chk('脚本异常', false, (e&&e.message)||String(e)); }
  return out;
})()`;

(async () => {
  const server = await serve();
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1440,900', '--remote-debugging-port=' + PORT_CDP, '--user-data-dir=C:/Users/Aiy51/AppData/Local/Temp/wgcover-' + Date.now(), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    await sleep(350);
    try { list = await (await fetch('http://127.0.0.1:' + PORT_CDP + '/json/list')).json(); if (list && list.length) break; } catch (e) { /* wait */ }
  }
  if (!list) { console.log('FAIL: CDP 没起来'); server.close(); chrome.kill(); process.exit(1); }

  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0; const waits = new Map(); let ctxId = null;

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
    if (m.method === 'Runtime.executionContextCreated') {
      const c = m.params.context;
      if (c.auxData && c.auxData.isDefault && c.auxData.frameId === page.id) ctxId = c.id;
    }
  };
  function send(method, params) {
    const id = ++mid;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => waits.set(id, r));
  }

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT_STATIC + '/workbench/workbench.html#cover' });
  await sleep(3200);

  const res = await send('Runtime.evaluate', { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId || undefined });
  const val = res.result && res.result.result && res.result.result.value;
  let pass = 0; let fail = 0;
  if (!val) { console.log('FAIL: 没返回值'); console.log(JSON.stringify(res.result).slice(0, 800)); fail = 1; }
  else val.forEach((t) => { console.log((t.ok ? 'PASS ' : 'FAIL ') + t.n + (t.ex ? '  [' + t.ex + ']' : '')); if (t.ok) pass++; else fail++; });

  console.log('\nRESULT: ' + pass + ' pass / ' + fail + ' fail');
  try { ws.close(); } catch (e) { /* ignore */ }
  server.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})();
