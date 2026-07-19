export function renderReplUi(channel: string): string {
  const safe = channel.replace(/[<>"'&]/g, '');
  // Escapes the channel for safe embedding inside the inline <script> block
  // below. JSON.stringify alone does NOT escape "</script>" or the U+2028/
  // U+2029 line separators, so an attacker-controlled channel like
  // "</script><script>alert(1)</script>" (a URL path segment) would close
  // the script tag early and inject markup the HTML parser executes.
  // Escaping "<" to "<" inside the JS string literal preserves the
  // exact value ("<" IS "<" once JS parses the literal) while ensuring the
  // HTML parser -- which tokenizes the raw bytes before any JS runs --
  // never sees a literal "</script>" sequence.
  const channelLiteral = JSON.stringify(channel)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (ch) => (ch === '\u2028' ? '\\u2028' : '\\u2029'));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>REPL: ${safe}</title>
<style>
  html,body{height:100%;margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;background:#1e1e1e;color:#ddd}
  #app{display:flex;flex-direction:column;height:100vh;height:100dvh}
  #out{flex:1;overflow:auto;padding:10px;white-space:pre-wrap;font-size:13px;line-height:1.4}
  #out:empty::before{content:'Run a command to see output.';color:#666}
  #out .cmd{color:#4ec9b0}#out .sys{color:#888}#out .err{color:#f14c4c}
  #editor{height:32%}
  #bar{display:flex;gap:12px;align-items:center;padding:6px 10px;background:#252526;font-size:12px;border-top:1px solid #333;border-bottom:1px solid #333}
  #bar .dot{width:8px;height:8px;border-radius:50%;background:#666;display:inline-block;margin-right:4px}
  #bar .dot.on{background:#3fb950}
  button{background:#0e639c;color:#fff;border:0;padding:4px 12px;border-radius:3px;cursor:pointer}
  @media (max-width:600px){
    #bar{flex-wrap:wrap;gap:6px 12px;padding:8px 10px}
    #bar>span{white-space:nowrap}
    #owner{overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .run-wrap{flex:1 0 100%}
    #run{width:100%;min-height:44px;padding:10px 16px;font-size:15px;white-space:nowrap}
    #run .kbd-hint{display:none}
    #out{flex:1 1 0;min-height:96px}
    #editor{height:auto;flex:1 1 0;min-height:200px}
  }
</style>
</head>
<body>
<div id="app">
  <div id="out"></div>
  <div id="bar">
    <span><span id="dot" class="dot"></span><span id="state">connecting…</span></span>
    <span>channel: <b>${safe}</b></span>
    <span id="owner"></span>
    <span class="run-wrap" style="margin-left:auto"><button id="run">Run ▶ <span class="kbd-hint">(Ctrl+Enter)</span></button></span>
  </div>
  <div id="editor"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js"></script>
<script>
  const channel = ${channelLiteral};
  const channelPath = encodeURIComponent(channel);
  const out = document.getElementById('out');
  const stateEl = document.getElementById('state');
  const dot = document.getElementById('dot');
  const ownerEl = document.getElementById('owner');
  function append(text, cls){ const d=document.createElement('div'); if(cls)d.className=cls; d.textContent=text; out.appendChild(d); out.scrollTop=out.scrollHeight; }
  function appendInline(text, cls){
    let last = out.lastElementChild;
    if(!last || last.dataset.kind !== 'output' || cls){
      last = document.createElement('div');
      last.dataset.kind = 'output';
      if(cls) last.className = cls;
      out.appendChild(last);
    }
    last.textContent += text;
    out.scrollTop = out.scrollHeight;
  }

  const es = new EventSource('../' + channelPath);
  es.onopen = () => { dot.classList.add('on'); stateEl.textContent='connected'; };
  es.onerror = () => { dot.classList.remove('on'); stateEl.textContent='reconnecting…'; };
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if(ev.type==='command'){
      // data: { command, instanceId }
      append('> ' + ev.data.command, 'cmd');
      if(ev.data && ev.data.instanceId) ownerEl.textContent='owner: '+ev.data.instanceId;
    }
    else if(ev.type==='output'){
      // data is a raw string chunk, not { chunk }
      appendInline(String(ev.data));
    }
    else if(ev.type==='system'){
      const data = ev.data || {};
      if(data.ping){
        // heartbeat, id:0 -- render nothing
        return;
      }
      if(data.done){
        // command finished -- not rendered as noise
        return;
      }
      if(typeof data.error === 'string'){
        append('! ' + data.error, 'err');
        return;
      }
      // other system notices (e.g. ownership info) -- render dim
      append('[' + JSON.stringify(data) + ']', 'sys');
      if(data.instanceId) ownerEl.textContent='owner: '+data.instanceId;
    }
  };

  let editor;
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }});
  require(['vs/editor/editor.main'], function(){
    editor = monaco.editor.create(document.getElementById('editor'), {
      value: '', language: 'typescript', theme: 'vs-dark', minimap:{enabled:false}, automaticLayout:true
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
  });
  async function run(){
    const command = editor.getValue().trim();
    if(!command) return;
    editor.setValue('');
    await fetch('../' + channelPath, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ command }) });
  }
  document.getElementById('run').addEventListener('click', run);
</script>
</body>
</html>`;
}
