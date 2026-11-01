const fs=require('fs');
const js=fs.readFileSync('webview-sync.js','utf8');
const tpl=[
'<!DOCTYPE html>',
'<html lang="zh-CN"><head><meta charset="utf-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>网页同步扩展 · webview-sync.js</title>',
'<style>',
'  :root{--bg:#0f1420;--card:#182031;--fg:#e8eefc;--muted:#8ea0c0;}',
'  *{box-sizing:border-box}',
'  body{margin:0;background:var(--bg);color:var(--fg);font-size:15px;line-height:1.7;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:40px 20px}',
'  main{max-width:860px;margin:0 auto}',
'  h1{margin:0 0 6px;font-size:26px}',
'  .sub{color:var(--muted);margin-bottom:26px}',
'  .card{background:var(--card);border:1px solid #253049;border-radius:12px;padding:20px 22px;margin-bottom:18px}',
'  code,pre{font-family:Consolas,ui-monospace,monospace;font-size:13px}',
'  pre{background:#0c1120;border:1px solid #253049;border-radius:8px;padding:14px;overflow:auto}',
'  .ok{color:#4ade80}',
'</style></head>',
'<body><main>',
'  <h1>网页同步扩展 <span class="ok">已加载 OK</span></h1>',
'  <div class="sub">Scratch 3 / Gandi IDE 扩展 · 在舞台上方叠加并同步显示网页 · v1.0.0</div>',
'  <div class="card">',
'    <b>在 Gandi 中加载</b>',
'    <pre id="url"></pre>',
'    把这行地址填进「扩展 → 自定义扩展 → URL」。',
'  </div>',
'  <div class="card">',
'    <b>积木</b>',
'    <pre>显示：在舞台上显示网页 (URL) / ...并且禁止鼠标操作 / 加载网页 / 刷新网页 / 隐藏网页 / 关闭网页并移除图层',
'同步：四周内缩 N、位置 x y 宽 高、铺满整个舞台、页面缩放 %、允许鼠标操作、吃掉鼠标点击、立即同步',
'取值：当前网页地址、正在显示？、舞台屏幕宽/高、网页X/Y 换算成 Scratch X/Y、被网站禁止嵌套？</pre>',
'    <span class="sub">设置了 X-Frame-Options / CSP 的站点（百度、淘宝、B站等）无法被嵌入，属浏览器安全策略。</span>',
'  </div>',
'</main>',
'<script>',
'document.getElementById(\'url\').textContent = location.href.replace(/[^/]*$/, \'webview-sync.js\');',
'</script>',
'<!-- ==================== 扩展源码（原文内嵌） ==================== -->',
'<script type="text/plain" id="ext-source">',
js,
'</script>',
'</body></html>',
''].join('\n');
fs.writeFileSync('index.html',tpl,'utf8');
fs.writeFileSync('.nojekyll','','utf8');
// verify round-trip
const h=fs.readFileSync('index.html','utf8');
const a=h.indexOf('id="ext-source">')+16;
const b=h.indexOf('</script>',a);
const extracted=h.slice(a,b).replace(/^\n/,'').replace(/\n$/,'');
console.log('embedded matches source:', extracted === js, '| bytes', Buffer.byteLength(h));
