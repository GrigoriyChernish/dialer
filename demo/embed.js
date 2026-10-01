// Імітація завантажувача embed.js: плаваюча кнопка й панель з віджетом в iframe.
// API як у docs/architecture.md: Dialer.mount(...) → { on, open, close, setTheme, setToken, call, unmount }.
(()=>{
// адреса віджета відносно embed.js: у репозиторії ../index.html, на Pages — widget/ (атрибут data-widget)
const WIDGET=new URL(document.currentScript.dataset.widget||'../index.html',document.currentScript.src);
const PHONE='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.6 3.6a1 1 0 0 1-.25 1z"/></svg>';
const CSS=`
.dlr-btn{all:unset;position:fixed;z-index:2147483000;width:64px;height:64px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  background:#6366f1;color:#fff;box-shadow:0 10px 30px -6px rgba(99,102,241,.6);transition:transform .15s}
.dlr-btn:active{transform:scale(.94)}.dlr-btn:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}
.dlr-btn svg{width:28px;height:28px}
.dlr-btn.live{background:#22c55e;animation:dlr-p 1.6s infinite}
@keyframes dlr-p{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}100%{box-shadow:0 0 0 22px rgba(34,197,94,0)}}
@media (prefers-reduced-motion:reduce){.dlr-btn.live{animation:none}}
.dlr-panel{position:fixed;z-index:2147483001;width:400px;display:flex;flex-direction:column;border-radius:24px;overflow:hidden;
  background:#0b0d12;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 70px -20px rgba(0,0,0,.55)}
.dlr-panel[hidden]{display:none}
.dlr-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 8px 8px 16px;background:#161a24;color:#f3f5fa;font:600 14px/1 Inter,system-ui,sans-serif}
.dlr-x{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:20px;color:#98a2b6}
.dlr-x:hover{background:rgba(255,255,255,.08)}.dlr-x:focus-visible{outline:2px solid #6366f1}
.dlr-panel iframe{flex:1;width:100%;border:0;background:#0b0d12}
@media (max-width:479px){.dlr-panel{inset:0!important;width:auto;height:auto!important;border-radius:0;border:0}}`;

window.Dialer={mount({token,server='',theme='auto',position='bottom-right',offset={x:24,y:24}}){
  if(!document.getElementById('dlr-css'))document.head.append(Object.assign(document.createElement('style'),{id:'dlr-css',textContent:CSS}));
  const ls={},emit=(e,d)=>(ls[e]||[]).forEach(f=>f(d));
  const side=position==='bottom-left'?'left':'right';
  const btn=Object.assign(document.createElement('button'),{className:'dlr-btn',innerHTML:PHONE});
  btn.style.cssText=`${side}:${offset.x}px;bottom:calc(${offset.y}px + env(safe-area-inset-bottom,0px))`;
  const panel=Object.assign(document.createElement('div'),{className:'dlr-panel',hidden:true});
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Дзвонілка');
  panel.style.cssText=`${side}:${offset.x}px;bottom:${offset.y+76}px;height:min(640px,calc(100vh - ${offset.y+92}px))`;
  panel.innerHTML='<div class="dlr-bar">Дзвонілка<button class="dlr-x" aria-label="Згорнути">–</button></div>';
  const src=new URL(WIDGET);src.search=new URLSearchParams({token,theme,host:location.origin,...(server&&{server}),_:Date.now()});  // _ обходить кеш iframe: статичний сервер не задає Cache-Control
  const frame=Object.assign(document.createElement('iframe'),{src,title:'Дзвонілка'});
  frame.allow='camera; microphone; autoplay; display-capture';  // без цього камера й мікрофон в iframe недоступні
  panel.append(frame);document.body.append(panel,btn);

  let open=false,state='idle';
  function setOpen(v,focusBtn){if(open===v)return;open=v;panel.hidden=!v;
    btn.setAttribute('aria-expanded',v);btn.setAttribute('aria-label',v?'Згорнути дзвонілку':'Відкрити дзвонілку');
    emit(v?'open':'close');if(v)frame.focus();else if(focusBtn)btn.focus();}
  btn.setAttribute('aria-expanded',false);btn.setAttribute('aria-label','Відкрити дзвонілку');
  btn.onclick=()=>setOpen(!open,true);
  panel.querySelector('.dlr-x').onclick=()=>setOpen(false,true);
  const onKey=e=>{if(e.key==='Escape'&&open)setOpen(false,true)};
  // приймаємо повідомлення лише від свого iframe і з його origin
  const onMsg=e=>{if(e.source!==frame.contentWindow||e.origin!==WIDGET.origin)return;const m=e.data||{};
    if(m.type==='ready')emit('ready');
    if(m.type==='close')setOpen(false,true);
    if(m.type==='token:expired')emit('token:expired');
    if(m.type==='state'&&m.state!==state){const was=state;state=m.state;btn.classList.toggle('live',state!=='idle');
      if(state==='incoming'){emit('incoming');setOpen(true);}  // вхідний сам розгортає панель
      if(state==='connected')emit('call:started');
      if(was==='connected')emit('call:ended');}};
  addEventListener('message',onMsg);addEventListener('keydown',onKey);
  const send=m=>frame.contentWindow?.postMessage(m,WIDGET.origin);
  return {
    on(e,f){(ls[e]??=[]).push(f);return this},
    open:()=>setOpen(true),close:()=>setOpen(false),
    setTheme:t=>send({type:'theme',theme:t}),
    setToken:t=>send({type:'token',token:t}),
    call(id){send({type:'call',id});setOpen(true)},
    unmount(){removeEventListener('message',onMsg);removeEventListener('keydown',onKey);btn.remove();panel.remove();}
  };
}};
})();
