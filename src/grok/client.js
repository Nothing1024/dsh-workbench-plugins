export function createGrokClient(require, sources) {
    const React = require('react');
    const {createPortal}=require('react-dom');
    const {SOURCE_TAB_SLOT, SourceTab} = sources;
    const h = React.createElement;
    const ID = 'grok';
    const API = '/__dsh_grok/api';
    const MAX_ATTACH = 10;
    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const ALLOWED_EXT = new Set(['png','jpg','jpeg','gif','webp','bmp','svg','heic','heif','ico','tif','tiff','pdf','txt','md','csv','tsv','json','xml','html','htm','rtf','log','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','js','ts','jsx','tsx','py','rb','go','rs','java','c','cc','cpp','h','hpp','cs','swift','kt','sh','bash','zsh','sql','yaml','yml','toml','ini','cfg','conf','zip','tar','gz','tgz','mp3','wav','m4a','ogg','mp4','webm','mov']);
    const ACCEPT_ATTR = [...ALLOWED_EXT].map(ext => '.' + ext).join(',');
    const fileExt = name => { const base = String(name || '').split(/[\\/]/).pop() || ''; const index = base.lastIndexOf('.'); return index > 0 ? base.slice(index + 1).toLowerCase() : ''; };
    const describeFileError = file => {
      if (!file || file.size <= 0) return (file && file.name ? file.name + ' ' : '') + '是空文件，不能上传';
      if (file.size > MAX_FILE_BYTES) return file.name + ' 超过 20 MB 上限';
      if (!ALLOWED_EXT.has(fileExt(file.name))) return file.name + ' 类型不受支持';
      return null;
    };
    const label = value => ({running:'运行中',waiting:'待输入',unread:'待查看',idle:'空闲中'}[value] || (value ? '未知态' : '空闲中'));
    const time = value => value ? new Date(Number(value)).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    function Glyph({name='bot',size=17}) {
      const paths = {bot:['M12 3v4','M4 7h16v13H4Z','M8 12h.01','M16 12h.01','M9 16h6'],search:['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z','m17 17 4 4'],refresh:['M20 7v5h-5','M4 17v-5h5','M6 7a7 7 0 0 1 12-2l2 2','M4 17l2 2a7 7 0 0 0 12-2'],plus:['M12 5v14','M5 12h14'],external:['M15 3h6v6','m10 14 11-11','M21 14v7H3V3h7'],chevron:['m9 5 7 7-7 7'],more:['M5 12h.01','M12 12h.01','M19 12h.01'],close:['m6 6 12 12','M18 6 6 18'],clip:['m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7'],file:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','M14 2v6h6','M16 13H8','M16 17H8','M10 9H8'],image:['M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4','m21 15-5-5L5 21','M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3'],folder:['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],sliders:['M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M1 14h6','M9 8h6','M17 16h6']};
      return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},...(paths[name]||paths.bot).map((d,i)=>h('path',{key:i,d})));
    }

    const PREFS_KEY='dsh-grok-workbench-prefs';
    const LEGACY_PREFS_KEY='dsh-grok-ui-opt-prefs';
    const defaultPrefs={showConfig:true,showSystem:true};
    function readPrefs(){
      try{return {...defaultPrefs,...JSON.parse(localStorage.getItem(PREFS_KEY)||localStorage.getItem(LEGACY_PREFS_KEY)||'{}')};}
      catch{return {...defaultPrefs};}
    }
    function usePrefs(){
      const [prefs,setPrefs]=React.useState(readPrefs);
      const save=React.useCallback(patch=>{
        setPrefs(prev=>{
          const next={...prev,...patch};
          try{localStorage.setItem(PREFS_KEY,JSON.stringify(next));}catch{}
          return next;
        });
      },[]);
      return [prefs,save];
    }
    function ConfigPane({bot,s,log,prefs,save,store,onClose,compact}){
      const closeRef=React.useRef(null);
      React.useEffect(()=>{if(!compact)return;if(!closeRef.current?.closest('.grok-config')?.contains(document.activeElement))closeRef.current?.focus();const key=event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[compact,onClose]);
      const last=[...(log?.entries||[])].reverse().find(entry=>entry.role==='user'||entry.role==='bot');
      const raw=last?String(last.text||last.summary||'').replace(/\s+/g,' ').trim():String(bot?.lastMessagePreview||'').trim();
      const preview=raw?raw.slice(0,180)+(raw.length>180?'…':''):(bot?'暂无对话记录':'选择一个机器人后，这里会显示最近一条消息。');
      const group=(s.layout?.sections||[]).find(section=>(section.bots||[]).some(item=>item.id===bot?.id));
      return h('aside',{id:'grok-details',className:'grok-config','aria-label':'机器人详情'},
        h('div',{className:'grok-config-toolbar'},h('h2',null,'详情与设置'),h('button',{ref:closeRef,type:'button',className:'grok-icon','aria-label':'关闭详情栏',title:'关闭详情栏',onClick:onClose},h(Glyph,{name:'close',size:16}))),
        h('div',{className:'grok-config-head'},h('div',null,h('strong',null,bot?bot.name:'Grok bot'),h('span',{className:'grok-status-pill','data-state':bot?.state||(s.connected?'idle':'')},bot?label(bot.state):(s.connected?'已连接':'未连接')))),
        h('section',{className:'grok-config-block'},h('h3',null,'最新对话'),h('p',{className:'grok-config-preview'},preview),last&&h('time',null,time(last.at))),
        h('section',{className:'grok-config-block'},h('h3',null,'机器人'),bot?h('dl',{className:'grok-config-dl'},h('dt',null,'名称'),h('dd',null,bot.name),bot.description?h(React.Fragment,null,h('dt',null,'简介'),h('dd',null,bot.description)):null,h('dt',null,'状态'),h('dd',null,label(bot.state)),group?h(React.Fragment,null,h('dt',null,'分组'),h('dd',null,group.name)):null,h('dt',null,'编号'),h('dd',null,bot.id)):h('p',{className:'grok-config-preview'},'从左侧选择一个机器人，这里会列出它的资料。')),
        h('section',{className:'grok-config-block'},h('h3',null,'插件配置'),
          h('label',{className:'grok-config-check'},h('input',{type:'checkbox',checked:prefs.showSystem!==false,onChange:event=>save({showSystem:event.target.checked})}),'显示系统 / 工具事件'),
          h('div',{className:'grok-config-meta'},s.loading?'正在同步…':s.connected?('已连接 · '+((s.layout&&s.layout.bots)||[]).length+' 个机器人'):(s.error||'连接不可用')),
          h('div',{className:'grok-config-actions'},h('button',{type:'button',disabled:s.loading,onClick:()=>void store.refresh()},'刷新列表'),h('button',{type:'button',onClick:()=>window.dispatchEvent(new CustomEvent('dsh-grok-open-settings'))},'账号与会话设置'),h('a',{href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer'},'在 Grok 打开'))));
    }
    async function request(path, body) {
      const response = await fetch(API + path, {method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(90000),...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
      const data = await response.json().catch(()=>({error:'服务返回了无法读取的响应'}));
      if(!response.ok) throw new Error(data.error || '请求失败（'+response.status+'）');
      return data;
    }
    const grokSettingsStyles=`
      .dsh-plugin-settings{display:flex;flex-direction:column;gap:16px;max-width:640px;font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
      .dsh-plugin-settings h2{margin:0;font:var(--dsw-font-sm-strong-14,600 14px/20px var(--dsw-font-family))}
      .dsh-plugin-settings .lead{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
      .dsh-plugin-settings fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;margin:0;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-plugin-settings legend{padding:0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .dsh-plugin-settings .hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin:0}
      .dsh-plugin-settings .row{display:flex;flex-wrap:wrap;gap:8px}
      .dsh-plugin-settings button{appearance:none;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer;font:inherit}
      .dsh-plugin-settings button[data-primary]{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent}
      .dsh-plugin-settings button:disabled{opacity:.5;cursor:default}
      .dsh-plugin-settings .status{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.45}
      .dsh-plugin-settings .dot{width:8px;height:8px;border-radius:50%;background:var(--g-faint,var(--dsw-alias-label-tertiary));flex:none;margin-top:4px}
      .dsh-plugin-settings .dot[data-ok=true]{background:var(--dsw-alias-state-success-primary,#5b9f83)}
      .dsh-plugin-settings .dot[data-ok=false]{background:var(--dsw-alias-state-error-primary,#c45c5c)}
      .dsh-plugin-settings dl{display:grid;grid-template-columns:96px 1fr;gap:6px 12px;margin:0;font-size:13px}
      .dsh-plugin-settings dt{color:var(--dsw-alias-label-tertiary)}
      .dsh-plugin-settings dd{margin:0;overflow-wrap:anywhere}
      .dsh-plugin-settings .auth-field{display:flex;flex-direction:column;gap:8px;font-size:13px}
      .dsh-plugin-settings .auth-field input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit}
      .dsh-plugin-settings-shade{position:fixed;inset:0;z-index:80;background:#0006;display:grid;place-items:center;padding:24px}
      .dsh-plugin-settings-dialog{width:min(560px,100%);max-height:min(88vh,720px);overflow:auto;border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 16px 48px #0004;padding:18px 18px 16px;position:relative}
      .dsh-plugin-settings-dialog .dsh-plugin-settings-close{position:absolute;top:12px;right:12px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
    `;
    function connectionLabel(value){
      return {idle:'未连接',connecting:'连接中',open:'已连接',closed:'已断开'}[value]||'未知态';
    }
    function GrokSettingsPanel(){
      const [auth,setAuth]=React.useState(null);
      const [manualAuth,setManualAuth]=React.useState('');
      const [conn,setConn]=React.useState(null);
      const [busy,setBusy]=React.useState('');
      const [notice,setNotice]=React.useState('打开此页时会检测 grok.com 会话，不会在界面上显示 cookie 内容。');
      const [ok,setOk]=React.useState(null);
      async function run(kind, work){
        setBusy(kind);
        try{
          const result=await work();
          if(result?.auth)setAuth(result.auth);
          if(result?.conn)setConn(result.conn);
          setOk(result?.ok!==false);
          if(result?.text)setNotice(result.text);
          return result;
        }catch(error){
          setOk(false);
          setNotice(error.message);
        }finally{setBusy('');}
      }
      React.useEffect(()=>{void run('detect',async()=>{
        const nextAuth=await request('/auth');
        let nextConn=null;
        try{nextConn=await request('/status');}catch{nextConn=null;}
        return {ok:!!nextAuth.signedIn,auth:nextAuth,conn:nextConn,text:nextAuth.message||'已完成检测。'};
      });},[]);
      return h('div',{className:'dsh-plugin-settings','data-plugin-settings':'grok-workbench'},
        h('style',null,grokSettingsStyles),
        h('header',null,h('h2',null,'Grok bot'),h('p',{className:'lead'},'手动配置 Grok bot 的 Auth，或继续使用自动会话检测。')),
        h('fieldset',null,
          h('legend',null,'手动 Auth'),
          h('label',{className:'auth-field'},'Grok bot Auth',
            h('input',{type:'password',value:manualAuth,autoComplete:'off',spellCheck:false,'aria-label':'Grok bot Auth',placeholder:auth?.manualConfigured?'已保存；填写新 Auth 可替换':'Cookie: sso=… 或单独的 SSO 值',onChange:event=>setManualAuth(event.target.value)}),
          ),
          h('p',{className:'hint'},'Auth 只保存在当前 DSH 所在机器，保存后不再显示原文。启动配置和环境变量仍优先于此处保存的内容。'),
          h('div',{className:'row'},
            h('button',{type:'button','data-primary':true,disabled:!!busy||!manualAuth.trim(),onClick:()=>void run('save',async()=>{
              const nextAuth=await request('/auth-save',{cookie:manualAuth});
              setManualAuth('');setConn({connection:'idle'});
              window.dispatchEvent(new CustomEvent('dsh-grok-auth-changed'));
              return {ok:true,auth:nextAuth,text:nextAuth.message};
            })},busy==='save'?'保存中…':'保存并应用'),
            h('button',{type:'button',disabled:!!busy||!auth?.manualConfigured,onClick:()=>void run('remove',async()=>{
              const nextAuth=await request('/auth-remove',{});
              setManualAuth('');setConn({connection:'idle'});
              window.dispatchEvent(new CustomEvent('dsh-grok-auth-changed'));
              return {ok:true,auth:nextAuth,text:nextAuth.message};
            })},busy==='remove'?'移除中…':'移除手动 Auth'),
          ),
        ),
        h('fieldset',null,
          h('legend',null,'会话状态'),
          h('dl',null,
            h('dt',null,'登录'),h('dd',null,auth? (auth.signedIn?'已检测到会话':'未检测到会话'):'检测中…'),
            h('dt',null,'来源'),h('dd',null,auth?.sourceLabel||auth?.source||'—'),
            h('dt',null,'用户'),h('dd',null,auth?.userId||'—'),
            h('dt',null,'Cookie'),h('dd',null,auth?.cookiePresent?((auth.cookieNames||[]).join(', ')||'已找到，未列出名称'):'未找到'),
            h('dt',null,'连接'),h('dd',null,conn?connectionLabel(conn.connection):'—'),
          ),
          h('p',{className:'hint'},'解析顺序：插件配置 / GROK_COOKIE → ~/.dsh/grokbot/cookie.txt → 已打开且可调试的 Chrome 系浏览器 → 12 小时本地缓存。'),
        ),
        h('div',{className:'row'},
          h('button',{type:'button',disabled:!!busy,onClick:()=>void run('detect',async()=>{
            const nextAuth=await request('/auth');
            let nextConn=null;
            try{nextConn=await request('/status');}catch{nextConn=null;}
            return {ok:!!nextAuth.signedIn,auth:nextAuth,conn:nextConn,text:nextAuth.message||'已完成检测。'};
          })},busy==='detect'?'检测中…':'检测会话'),
          h('button',{type:'button','data-primary':true,disabled:!!busy,onClick:()=>void run('load',async()=>{
            const nextAuth=await request('/auth-refresh',{});
            return {ok:!!nextAuth.signedIn,auth:nextAuth,text:nextAuth.message||'已重新加载会话。'};
          })},busy==='load'?'加载中…':'重新加载会话'),
          h('a',{href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer'},
            h('button',{type:'button'},'打开 grok.com 登录'),
          ),
          h('button',{type:'button',disabled:!!busy,onClick:()=>void run('clear',async()=>{
            const nextAuth=await request('/auth-clear',{});
            return {ok:false,auth:nextAuth,text:nextAuth.message||'已清除本地会话缓存，未删除你的 cookie 文件。'};
          })},busy==='clear'?'清除中…':'清除缓存'),
        ),
        h('div',{className:'status'},h('span',{className:'dot','data-ok':ok===null?undefined:String(ok),'aria-hidden':true}),h('span',null,notice)),
      );
    }
    function GrokSettingsOverlay({onClose}){
      React.useEffect(()=>{
        const key=event=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
        window.addEventListener('keydown',key);
        return()=>window.removeEventListener('keydown',key);
      },[onClose]);
      return h('div',{className:'dsh-plugin-settings-shade',onMouseDown:event=>{if(event.target===event.currentTarget)onClose();}},
        h('div',{className:'dsh-plugin-settings-dialog',role:'dialog','aria-modal':true,'aria-label':'Grok bot 插件设置'},
          h('button',{type:'button',className:'dsh-plugin-settings-close','aria-label':'关闭设置',onClick:onClose},'×'),
          h(GrokSettingsPanel),
        ));
    }

    function uploadRequest(id, file, onProgress) {
      return new Promise((resolve, reject) => {
        const finish = (ok, payload, status) => {
          if (ok) resolve(payload);
          else reject(new Error((payload && payload.error) || ('上传失败（' + status + '）')));
        };
        if (typeof XMLHttpRequest === 'function') {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', API + '/upload');
          xhr.withCredentials = true;
          xhr.timeout = 90000;
          xhr.responseType = 'text';
          xhr.upload.onprogress = event => {
            if (event.lengthComputable && typeof onProgress === 'function') onProgress(event.loaded / event.total);
          };
          xhr.onload = () => {
            let payload = {};
            try { payload = JSON.parse(xhr.responseText || '{}'); } catch { payload = { error: '服务返回了无法读取的响应' }; }
            finish(xhr.status >= 200 && xhr.status < 300, payload, xhr.status);
          };
          xhr.onerror = () => reject(new Error('上传失败'));
          xhr.ontimeout = () => reject(new Error('上传超时'));
          const body = new FormData();
          body.append('id', id);
          body.append('file', file, file.name);
          xhr.send(body);
          return;
        }
        const body = new FormData();
        body.append('id', id);
        body.append('file', file, file.name);
        fetch(API + '/upload', { method: 'POST', credentials: 'same-origin', cache: 'no-store', body, signal: AbortSignal.timeout(90000) }).then(async response => {
          const payload = await response.json().catch(() => ({ error: '服务返回了无法读取的响应' }));
          finish(response.ok, payload, response.status);
        }, () => reject(new Error('上传失败')));
      });
    }
    function mergeEntries(previous, incoming) {
      const key = entry => entry.version == null ? JSON.stringify([entry.at,entry.kind,entry.role,entry.text]) : 'v:'+entry.version;
      const entries = new Map(previous.map(entry=>[key(entry),entry]));
      for(const entry of incoming) entries.set(key(entry),entry);
      return [...entries.values()].sort((a,b)=>Number(a.version ?? a.at ?? 0)-Number(b.version ?? b.at ?? 0));
    }
    function createGrokStore({request:api=request,upload:uploadFile=uploadRequest,schedule=setInterval,cancel=clearInterval,nonce=()=>globalThis.crypto.randomUUID()}={}) {
      let state={layout:null,selected:null,query:'',collapsed:{},drafts:{},logs:{},pending:{},notices:{},outbox:{},attachments:{},error:null,loading:false,connected:false};
      let attachSerial=0;
      let active=false,disposed=false,epoch=0,layoutSerial=0,timer=null;
      const listeners=new Set(),reads=new Map(),draftRevisions=new Map(),sendAttempts=new Map();
      const publish=patch=>{if(disposed)return;state={...state,...patch};for(const listener of listeners)listener();};
      const updateLog=(id,patch)=>publish({logs:{...state.logs,[id]:{entries:[],cursor:'',loaded:false,older:false,scroll:null,...state.logs[id],...patch}}});
      const updateOutbox=(id,fn)=>publish({outbox:{...state.outbox,[id]:fn(state.outbox[id]||[])}});
      const updateAttachments=(id,fn)=>publish({attachments:{...state.attachments,[id]:fn(state.attachments[id]||[])}});
      // Drop local echo once the server transcript has the same user message (nonce, or text + near time). Also clear while still 'sending' so pull-after-send cannot leave a duplicate bubble.
      const sameUserText=(entry,item)=>{const a=String(entry.text||'').trim(),b=String(item.text||'').trim();return !!a&&!!b&&a===b;};
      const nearTime=(entry,item)=>{const t=Number(entry.at||0),u=Number(item.at||0);if(!t||!u)return true;return Math.abs(t-u)<=120000;};
      const entryNonce=(entry)=>{const p=entry&&entry.payload&&typeof entry.payload==='object'?entry.payload:null;const v=entry?.clientNonce||entry?.nonce||p?.clientNonce||p?.nonce;return typeof v==='string'?v.toLowerCase():'';};
      const reconcileOutbox=(id,entries)=>{const items=state.outbox[id];if(!items?.length)return;const used=new Set();const keep=items.filter(item=>{if(item.status!=='sent'&&item.status!=='sending')return true;const want=String(item.nonce||'').toLowerCase();const index=entries.findIndex((entry,i)=>{if(used.has(i)||entry.role!=='user')return false;if(want&&entryNonce(entry)===want)return true;return sameUserText(entry,item)&&nearTime(entry,item);});if(index<0)return true;used.add(index);return false;});if(keep.length!==items.length)publish({outbox:{...state.outbox,[id]:keep}});};
      const noticeTimers=new Map(),later=typeof globalThis.setTimeout==='function'?globalThis.setTimeout.bind(globalThis):null,unlater=typeof globalThis.clearTimeout==='function'?globalThis.clearTimeout.bind(globalThis):()=>{};
      const notice=(id,message,transient=false)=>{
        if(noticeTimers.has(id)){unlater(noticeTimers.get(id));noticeTimers.delete(id);}
        publish({notices:{...state.notices,[id]:message}});
        if(message&&transient&&later)noticeTimers.set(id,later(()=>{noticeTimers.delete(id);if(!disposed&&state.notices[id]===message)publish({notices:{...state.notices,[id]:null}});},3000));
      };
      async function uploadItem(botId,key){
        const item=(state.attachments[botId]||[]).find(file=>file.id===key);
        if(!item?.file)return;
        try{
          const result=await uploadFile(botId,item.file,ratio=>{if(disposed)return;updateAttachments(botId,items=>items.map(file=>file.id===key&&file.status==='uploading'?{...file,progress:ratio}:file));});
          if(disposed)return;
          const path=typeof result?.path==='string'?result.path.trim():'';
          if(!path)throw new Error('上传成功但未返回附件路径');
          updateAttachments(botId,items=>items.map(file=>file.id===key?{...file,status:'ready',progress:1,path,name:result.name||file.name,error:null}:file));
        }catch(error){
          if(disposed)return;
          const message=error.message||'上传失败';
          updateAttachments(botId,items=>items.map(file=>file.id===key?{...file,status:'error',progress:0,error:message}:file));
          notice(botId,message);
        }
      }
      async function pull(id,older=false) {
        if(!active||!id)return;
        const run=epoch,kind=id+':'+(older?'older':'tail'),cursor=older?state.logs[id]?.cursor:'';
        if(older&&!cursor)return;
        if(reads.get(kind)?.run===run)return;
        const ticket={run};reads.set(kind,ticket);
        updateLog(id,{[older?'loadingOlder':'loading']:true,error:null});
        try {
          const page=await api('/transcript?id='+encodeURIComponent(id)+'&limit=80'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
          if(!active||epoch!==run||reads.get(kind)!==ticket)return;
          const log=state.logs[id];
          updateLog(id,{entries:older?mergeEntries(page.entries||[],log.entries):mergeEntries(log.entries,page.entries||[]),loaded:true,...(older?{cursor:page.cursor||'',older:true,olderVersion:(log.olderVersion||0)+1}:log.older?{}:{cursor:page.cursor||''}),error:null});
          if(!older)reconcileOutbox(id,state.logs[id]?.entries||[]);
        } catch(error) { if(active&&epoch===run&&reads.get(kind)===ticket)updateLog(id,{error:error.message}); }
        finally { if(reads.get(kind)===ticket){reads.delete(kind);if(active&&epoch===run)updateLog(id,{[older?'loadingOlder':'loading']:false});} }
      }
      async function refresh() {
        if(!active||reads.get('layout')?.run===epoch)return;
        const run=epoch,ticket={run,serial:++layoutSerial};reads.set('layout',ticket);publish({loading:true});
        try {
          const layout=await api('/layout');
          if(!active||epoch!==run||ticket.serial!==layoutSerial)return;
          if(!Array.isArray(layout.bots)||!Array.isArray(layout.sections))throw new Error('机器人列表格式无效');
          let selected=state.selected;
          if(!layout.bots.some(bot=>bot.id===selected)) selected=layout.bots.find(bot=>!bot.hidden)?.id||null;
          publish({layout,selected,error:null,connected:true});
          if(selected)void pull(selected);
        }catch(error){if(active&&epoch===run&&ticket.serial===layoutSerial)publish({error:error.message,connected:false});}
        finally {if(reads.get('layout')===ticket){reads.delete('layout');if(active&&epoch===run)publish({loading:false});}}
      }
      async function mutate(path,body) {
        const id=body.id||'$groups',draftRevision=draftRevisions.get(id)||0;
        if(disposed||state.pending[id])return false;
        publish({pending:{...state.pending,[id]:path}});notice(id,null);
        try {
          await api(path,body);
          if(path==='/send'&&sendAttempts.get(id)?.clientNonce===body.clientNonce)sendAttempts.delete(id);
          if(path==='/send'&&(draftRevisions.get(id)||0)===draftRevision&&state.drafts[id]===body.prompt)publish({drafts:{...state.drafts,[id]:''}});
          if(path==='/delete') {
            const layout=state.layout;
            publish({...(state.selected===id?{selected:null}:{}),drafts:{...state.drafts,[id]:''},...(layout?{layout:{...layout,bots:layout.bots.filter(bot=>bot.id!==id),pinnedBots:(layout.pinnedBots||[]).filter(bot=>bot.id!==id),sections:layout.sections.map(section=>({...section,bots:section.bots.filter(bot=>bot.id!==id)})),ungrouped:(layout.ungrouped||[]).filter(bot=>bot.id!==id)}}:{})});
          }
          notice(id,path==='/send'?'消息已发送':path==='/interrupt'?'已请求中断':'操作已完成',true);
          // A successful write remains successful even if the subsequent read fails.
          if(active){layoutSerial++;reads.delete('layout');reads.delete(id+':tail');void refresh();if(path!=='/delete'&&state.selected===id)void pull(id);}
          return true;
        }catch(error){notice(id,error.message);return false;}
        finally {publish({pending:{...state.pending,[id]:null}});}
      }
      async function deliver(id,key){
        const item=(state.outbox[id]||[]).find(entry=>entry.nonce===key);if(!item)return false;
        const mark=status=>updateOutbox(id,items=>items.map(entry=>entry.nonce===key?{...entry,status}:entry));
        mark('sending');
        const payload={id,prompt:item.text,clientNonce:key};if(item.attachments?.length){payload.attachmentPaths=item.attachments.map(file=>file.path);payload.attachmentNames=item.attachments.map(file=>file.name);}const ok=await mutate('/send',payload);
        if((state.outbox[id]||[]).some(entry=>entry.nonce===key))mark(ok?'sent':'failed');
        if(ok)reconcileOutbox(id,state.logs[id]?.entries||[]);
        return ok;
      }
      return {
        getSnapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
        refresh,loadOlder:()=>pull(state.selected,true),mutate,
        select(id){if(state.selected===id)return;publish({selected:id});void pull(id);},
        setDraft(id,text){draftRevisions.set(id,(draftRevisions.get(id)||0)+1);publish({drafts:{...state.drafts,[id]:text}});},
        setQuery(query){publish({query});},
        toggleGroup(id,initial){publish({collapsed:{...state.collapsed,[id]:!(state.collapsed[id]??initial)}});},
        setScroll(id,scroll){if(!disposed)state={...state,logs:{...state.logs,[id]:{...state.logs[id],scroll}}};},
        send(){const id=state.selected,prompt=state.drafts[id]||'',files=(state.attachments[id]||[]).filter(file=>file.status==='ready'&&file.path),blocked=state.pending[id]||(state.attachments[id]||[]).some(file=>file.status==='uploading');if(!id||blocked||(!prompt.trim()&&!files.length))return Promise.resolve(false);const text=prompt.trim()||files.map(file=>file.name).join(', ');const item={nonce:nonce(),text,at:Date.now(),status:'sending',attachments:files.map(file=>({path:file.path,name:file.name,mime:file.mime,size:file.size}))};draftRevisions.set(id,(draftRevisions.get(id)||0)+1);publish({drafts:{...state.drafts,[id]:''},attachments:{...state.attachments,[id]:(state.attachments[id]||[]).filter(file=>file.status==='error')}});updateOutbox(id,items=>[...items,item]);return deliver(id,item.nonce);},
        sendText(text){const id=state.selected,prompt=String(text||'');if(!id||!prompt.trim()||state.pending[id])return Promise.resolve(false);const item={nonce:nonce(),text:prompt,at:Date.now(),status:'sending'};updateOutbox(id,items=>[...items,item]);return deliver(id,item.nonce);},
        retry(id,key){const item=(state.outbox[id]||[]).find(entry=>entry.nonce===key);if(!item||item.status!=='failed'||state.pending[id])return Promise.resolve(false);return deliver(id,key);},
        discard(id,key){const item=(state.outbox[id]||[]).find(entry=>entry.nonce===key);updateOutbox(id,items=>items.filter(entry=>entry.nonce!==key));const restore=!!item&&!(state.drafts[id]||'').trim();const patch={};if(restore){draftRevisions.set(id,(draftRevisions.get(id)||0)+1);patch.drafts={...state.drafts,[id]:item.text};}const existing=state.attachments[id]||[];if(item?.attachments?.length&&!existing.some(file=>file.status==='ready'||file.status==='uploading')){patch.attachments={...state.attachments,[id]:[...existing,...item.attachments.map((file,index)=>({id:'restored-'+key+'-'+index,name:file.name,size:file.size||0,mime:file.mime||'',status:'ready',progress:1,path:file.path,error:null,file:null}))]};}if(Object.keys(patch).length)publish(patch);notice(id,null);return restore;},
        addFiles(list){const id=state.selected;if(!id||state.pending[id])return;const incoming=[...list||[]].filter(Boolean);if(!incoming.length)return;const current=state.attachments[id]||[];const active=current.filter(file=>file.status!=='error');const accepted=[];const errors=[];for(const file of incoming){const reason=describeFileError(file);if(reason){errors.push(reason);continue;}if(active.length+accepted.length>=MAX_ATTACH){errors.push('最多附加 '+MAX_ATTACH+' 个文件');break;}accepted.push(file);}if(errors.length)notice(id,errors[0]);if(!accepted.length)return;const added=accepted.map(file=>({id:'a'+(++attachSerial)+'-'+Date.now().toString(36),name:file.name,size:file.size,mime:file.type||'',status:'uploading',progress:0,path:'',error:null,file,preview:file.type&&file.type.startsWith('image/')&&typeof URL!=='undefined'&&URL.createObjectURL?URL.createObjectURL(file):''}));updateAttachments(id,items=>[...items,...added]);for(const item of added)void uploadItem(id,item.id);},
        removeAttachment(id,key){const item=(state.attachments[id]||[]).find(file=>file.id===key);if(item?.preview)try{URL.revokeObjectURL(item.preview);}catch{}updateAttachments(id,items=>items.filter(file=>file.id!==key));},
        retryAttachment(id,key){const item=(state.attachments[id]||[]).find(file=>file.id===key);if(!item||item.status!=='error'||!item.file)return;updateAttachments(id,items=>items.map(file=>file.id===key?{...file,status:'uploading',progress:0,error:null}:file));void uploadItem(id,key);},
        start(){if(active||disposed)return;active=true;epoch++;void refresh();if(state.selected)void pull(state.selected);timer=schedule(()=>{void refresh();if(state.selected)void pull(state.selected);},8000);},
        stop(){active=false;epoch++;if(timer!==null)cancel(timer);timer=null;reads.clear();const logs=Object.fromEntries(Object.entries(state.logs).map(([id,log])=>[id,{...log,loading:false,loadingOlder:false}]));publish({loading:false,logs});},
        dispose(){this.stop();disposed=true;listeners.clear();},
      };
    }
    // Safe Markdown → React elements (no innerHTML). Covers fenced code, headings, lists, quotes, tables, hr and inline marks.
    const SAFE_URL=/^(https?:|mailto:)/i;
    const SAFE_IMG=/^https?:\/\//i;
    const IMAGE_EXT=/\.(png|jpe?g|gif|webp|bmp|svg)$/i;
    function inline(text,keyBase='i'){
      const out=[];let rest=String(text),n=0;
      const re=/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(^|[^\w])_([^_\s][^_]*?)_(?!\w)|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()（）]+[^\s<>()（）.,;:!?。，；：！？'"])/;
      while(rest){
        const m=re.exec(rest);
        if(!m){out.push(rest);break;}
        let start=m.index;
        if(m[7]!==undefined){start+=m[7].length;}
        if(start>0)out.push(rest.slice(0,start));
        const k=keyBase+'-'+(n++);
        if(m[1])out.push(h('code',{key:k,className:'grok-md-code'},m[2].trim()===''?m[2]:m[2].replace(/^ (.*) $/,'$1')));
        else if(m[3]!==undefined||m[4]!==undefined)out.push(h('strong',{key:k},inline(m[3]??m[4],k)));
        else if(m[5]!==undefined)out.push(h('del',{key:k},inline(m[5],k)));
        else if(m[6]!==undefined)out.push(h('em',{key:k},inline(m[6],k)));
        else if(m[8]!==undefined)out.push(h('em',{key:k},inline(m[8],k)));
        else if(m[9]!==undefined)out.push(SAFE_IMG.test(m[10])?h('img',{key:k,className:'grok-md-img',src:m[10],alt:m[9],loading:'lazy',referrerPolicy:'no-referrer'}):m[0]);
        else if(m[11]!==undefined)out.push(SAFE_URL.test(m[12])?h('a',{key:k,href:m[12],target:'_blank',rel:'noopener noreferrer'},inline(m[11],k)):m[0]);
        else if(m[13])out.push(h('a',{key:k,href:m[13],target:'_blank',rel:'noopener noreferrer'},m[13]));
        rest=rest.slice(m.index+m[0].length);
      }
      return out;
    }
    function CodeBlock({lang,code}){
      const [copied,setCopied]=React.useState(false);
      const copy=()=>{const done=()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);};try{const p=navigator.clipboard?.writeText(code);if(p&&p.then)p.then(done,()=>{});}catch{}};
      return h('div',{className:'grok-md-pre'},h('div',{className:'grok-md-pre-head'},h('span',null,lang||'text'),h('button',{type:'button',onClick:copy,'aria-label':'复制代码'},copied?'已复制':'复制')),h('pre',{tabIndex:0,'aria-label':(lang||'文本')+' 代码，可横向滚动'},h('code',null,code)));
    }
    const LIST_RE=/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
    const TABLE_SEP=/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    const cells=line=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
    function Markdown({text}){
      const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n'),blocks=[];let i=0,k=0;
      while(i<lines.length){
        const line=lines[i];
        const fence=/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
        if(fence){const close=fence[1];const body=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(close)){body.push(lines[i]);i++;}i++;const fenced=body.join('\n');const fenceChart=(/^(chart|graph|plot|json)$/i.test(fence[2]||'')&&parseChart(parseJson(fenced)));if(fenceChart){blocks.push(h(ChartCard,{key:k++,spec:fenceChart}));continue;}blocks.push(h(CodeBlock,{key:k++,lang:fence[2],code:fenced}));continue;}
        if(!line.trim()){i++;continue;}
        const head=/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        if(head){blocks.push(h('h'+Math.min(6,head[1].length+2),{key:k++,className:'grok-md-h','data-level':head[1].length},inline(head[2],'h'+k)));i++;continue;}
        if(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)){blocks.push(h('hr',{key:k++}));i++;continue;}
        if(/^\s*>/.test(line)){const body=[];while(i<lines.length&&/^\s*>/.test(lines[i])){body.push(lines[i].replace(/^\s*>\s?/,''));i++;}blocks.push(h('blockquote',{key:k++},h(Markdown,{text:body.join('\n')})));continue;}
        if(line.includes('|')&&i+1<lines.length&&TABLE_SEP.test(lines[i+1])&&lines[i+1].includes('-')){
          const header=cells(line);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){rows.push(cells(lines[i]));i++;}
          const fromTable=tableToChart(header,rows);if(fromTable)blocks.push(h(ChartCard,{key:k++,spec:fromTable}));
          blocks.push(h('div',{key:k++,className:'grok-md-table',tabIndex:0,role:'region','aria-label':'表格，可横向滚动'},h('table',null,h('thead',null,h('tr',null,header.map((c,j)=>h('th',{key:j,scope:'col'},inline(c,'th'+j))))),h('tbody',null,rows.map((r,ri)=>h('tr',{key:ri},header.map((_,j)=>h('td',{key:j},inline(r[j]??'','td'+ri+'-'+j)))))))));continue;
        }
        const li=LIST_RE.exec(line);
        if(li){
          const ordered=/\d/.test(li[2]),items=[];
          while(i<lines.length){
            const m=LIST_RE.exec(lines[i]);
            if(m){if(items.length&&!m[1]&&/\d/.test(m[2])!==ordered)break;items.push({depth:Math.min(3,Math.floor(m[1].replace(/\t/g,'  ').length/2)),text:m[3]});i++;continue;}
            if(lines[i].trim()&&/^\s{2,}/.test(lines[i])&&items.length){items[items.length-1].text+='\n'+lines[i].trim();i++;continue;}
            break;
          }
          blocks.push(h(ordered?'ol':'ul',{key:k++,className:'grok-md-list',start:ordered?(parseInt(li[2],10)||1):undefined},items.map((item,j)=>{const task=/^\[([ xX])\]\s+(.*)$/s.exec(item.text);return h('li',{key:j,'data-depth':item.depth||undefined,'data-task':task?(task[1]===' '?'open':'done'):undefined},task&&h('span',{className:'grok-md-check','aria-hidden':true},task[1]===' '?'☐':'☑'),inline(task?task[2]:item.text,'li'+j));})));
          continue;
        }
        const para=[];
        while(i<lines.length&&lines[i].trim()&&!/^\s*(`{3,}|~{3,})/.test(lines[i])&&!/^\s{0,3}#{1,6}\s/.test(lines[i])&&!/^\s*>/.test(lines[i])&&!LIST_RE.test(lines[i])&&!(lines[i].includes('|')&&i+1<lines.length&&TABLE_SEP.test(lines[i+1]))){para.push(lines[i]);i++;}
        if(!para.length){para.push(lines[i]);i++;}
        const lone=para.length===1?para[0].trim():'';
        if(lone&&SAFE_IMG.test(lone)&&IMAGE_EXT.test(lone.split('?')[0])){blocks.push(h('figure',{key:k++,className:'grok-md-img-wrap'},h('img',{className:'grok-md-img',src:lone,alt:'',loading:'lazy',referrerPolicy:'no-referrer'})));continue;}
        blocks.push(h('p',{key:k++},para.flatMap((p,j)=>j?[h('br',{key:'br'+j}),...inline(p,'p'+k+'-'+j)]:inline(p,'p'+k+'-'+j))));
      }
      return h('div',{className:'grok-md'},blocks);
    }
    function SystemEntry({entry}){
      const m=/^\[([^\]]+)\]\s*([\s\S]*)$/.exec(entry.text||'');
      return h('details',{className:'grok-sys'},h('summary',null,h('span',{className:'grok-sys-kind'},m?m[1]:entry.kind||'system'),h('span',{className:'grok-sys-hint'},'系统事件 · 点击展开')),h('pre',null,m?m[2]:entry.text));
    }
    function parseJson(text){try{const value=JSON.parse(text);return value&&typeof value==='object'?value:null;}catch{return null;}}
    function parseTagged(text){const m=/^\[([^\]]+)\]\s*([\s\S]*)$/.exec(String(text||'').trim());return m?{tag:m[1],data:parseJson(m[2]),raw:m[2]}:null;}
    function asRecord(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
    function pickStr(obj,keys){if(!obj)return '';for(const key of keys){const value=obj[key];if(typeof value==='string'&&value.trim())return value.trim();}return '';}
    function firstSafeUrl(...values){for(const value of values){if(typeof value==='string'&&SAFE_IMG.test(value.trim()))return value.trim();if(typeof value==='string'&&value.startsWith('/__dsh_grok/'))return value;}return '';}
    function pickUrl(obj){const rec=asRecord(obj);if(!rec)return '';return firstSafeUrl(rec.url,rec.src,rec.href,rec.imageUrl,rec.previewUrl,rec.thumbnailUrl,rec.uri,asRecord(rec.image)&&asRecord(rec.image).url);}
    function pickName(obj){return pickStr(obj,['name','fileName','filename','title','label'])||pickStr(obj,['path','filePath','uri']).split(/[\\/]/).pop()||'';}
    function pickPath(obj){return pickStr(obj,['path','filePath','fileUrl','uri']);}
    function pickMime(obj){return pickStr(obj,['mimeType','mime','contentType','mediaType']);}
    function pickSize(obj){const value=obj&&(obj.size??obj.bytes??obj.byteSize??obj.fileSize);const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
    function isImageName(name,mime,url){if(mime&&/^image\//i.test(mime))return true;const src=(name||url||'').split('?')[0];return IMAGE_EXT.test(src);}
    function formatSize(n){if(n==null)return '';if(n<1024)return n+' B';if(n<1024*1024)return (n/1024).toFixed(n<10*1024?1:0)+' KB';return (n/(1024*1024)).toFixed(n<10*1024*1024?1:0)+' MB';}
    function normalizeWidgetOption(opt){
      const item=asRecord(opt)||{label:opt,value:opt};
      const label=String(item.label??item.value??item.text??'').trim();
      const value=String(item.value??item.label??item.text??'').trim();
      return {item,label,value};
    }
    function widgetFingerprint(widget){
      const prompt=String(widget.prompt||widget.title||'').trim();
      const options=Array.isArray(widget.options)?widget.options:[];
      const keys=options.map(opt=>{const {label,value}=normalizeWidgetOption(opt);return value||label;}).filter(Boolean);
      return prompt+'\0'+keys.join('\0');
    }
    function matchWidgetPick(userText,widget){
      const text=String(userText||'').trim();
      if(!text||!widget)return '';
      const options=Array.isArray(widget.options)?widget.options:[];
      for(const opt of options){
        const {label,value}=normalizeWidgetOption(opt);
        if((value&&value===text)||(label&&label===text))return label||value;
      }
      return '';
    }
    function extractWidget(entry){
      if(!entry)return null;
      const payload=asRecord(entry.payload);
      const tagged=parseTagged(entry.text);
      const data=payload||(tagged&&tagged.data)||null;
      const nested=data&&(asRecord(data.widget)||asRecord(data.message)||asRecord(data.attachment)||asRecord(data.image)||asRecord(data.file));
      const type=String((data&&data.type)||(nested&&nested.type)||(tagged&&tagged.tag)||entry.kind||'').toLowerCase();
      if(type!=='widget')return null;
      const widget=asRecord(data&&data.widget)||(data&&Array.isArray(data.options)?data:null)||asRecord(nested&&nested.widget)||(nested&&Array.isArray(nested.options)?nested:null);
      if(widget&&(widget.prompt||widget.title||(Array.isArray(widget.options)&&widget.options.length)))return widget;
      return null;
    }
    function WidgetCard({widget,onPick,busy,answered,pickedValue}){
      const prompt=typeof widget.prompt==='string'?widget.prompt:(typeof widget.title==='string'?widget.title:'');
      const options=Array.isArray(widget.options)?widget.options.slice(0,24):[];
      if(answered){
        return h('div',{className:'grok-widget','data-answered':'true'},
          prompt&&h('p',{className:'grok-widget-prompt'},prompt),
          pickedValue?h('p',{className:'grok-widget-picked'},'已选 · '+pickedValue):h('p',{className:'grok-widget-picked'},'已回答'));
      }
      return h('div',{className:'grok-widget'},prompt&&h('p',{className:'grok-widget-prompt'},prompt),h('div',{className:'grok-widget-options'},options.map((opt,i)=>{
        const {item,label,value}=normalizeWidgetOption(opt);
        if(!label&&!value)return null;
        return h('button',{key:i,type:'button','data-primary':item.style==='primary'||undefined,disabled:!!busy||!onPick||!value,onClick:()=>onPick(value)},label||value);
      })));
    }
    function MediaCard({data,kind}){
      const rec=asRecord(data)||{};
      const inner=asRecord(rec.file)||asRecord(rec.attachment)||asRecord(rec.image)||rec;
      const name=pickName(inner)||pickName(rec)||'未命名';
      const url=pickUrl(inner)||pickUrl(rec);
      const path=pickPath(inner)||pickPath(rec);
      const mime=pickMime(inner)||pickMime(rec);
      const size=pickSize(inner)??pickSize(rec);
      const image=kind==='image'||isImageName(name,mime,url||path);
      const preview=image&&url;
      const meta=[mime,formatSize(size)].filter(Boolean).join(' · ');
      return h('figure',{className:preview?'grok-media grok-media-image':'grok-media grok-media-file'},
        preview?h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},h('img',{src:url,alt:name,loading:'lazy',referrerPolicy:'no-referrer'})):h('span',{className:'grok-media-icon','aria-hidden':true},h(Glyph,{name:image?'image':'file',size:18})),
        h('figcaption',null,h('strong',null,name),meta&&h('span',{className:'grok-media-meta'},meta),url&&h('a',{href:url,target:'_blank',rel:'noopener noreferrer'},'打开'),!url&&path&&h('span',{className:'grok-media-path'},path)));
    }
    function GenericCard({tag,data}){
      const rec=asRecord(data);
      const title=pickStr(rec,['prompt','title','text','message','label']);
      return h('details',{className:'grok-card'},h('summary',null,h('span',{className:'grok-card-kind'},tag||'card'),title&&title!==tag&&h('span',{className:'grok-card-title'},title)),h('pre',null,JSON.stringify(data,null,2)));
    }
    function toNumber(value){
      if(typeof value==='number')return Number.isFinite(value)?value:NaN;
      if(typeof value!=='string')return NaN;
      let s=value.trim().replace(/[,，\s$¥€£]/g,'');
      let mul=1;
      if(/万$/.test(s)){mul=1e4;s=s.slice(0,-1);}
      else if(/亿$/.test(s)){mul=1e8;s=s.slice(0,-1);}
      if(s.endsWith('%'))s=s.slice(0,-1);
      const n=Number(s);
      return Number.isFinite(n)?n*mul:NaN;
    }
    function numericList(value){
      if(!Array.isArray(value)||value.length<2||value.length>24)return null;
      const nums=value.map(item=>{
        if(item&&typeof item==='object')return toNumber(item.value??item.y??item.count??item.v);
        return toNumber(item);
      });
      return nums.every(Number.isFinite)?nums:null;
    }
    function labelList(value,fallback){
      if(Array.isArray(value)&&value.length)return value.map((item,i)=>String((item&&typeof item==='object')?(item.label??item.name??item.x??fallback[i]??(i+1)):item??fallback[i]??(i+1)));
      return fallback;
    }
    function chartKind(name,labels,series){
      const key=String(name||'').toLowerCase();
      if(/pie|donut|doughnut|环图|饼图|占比|比例/.test(key))return 'pie';
      if(/area|面积/.test(key))return 'area';
      if(/line|trend|折线|趋势/.test(key))return 'line';
      if(/horiz|barh|横条|条形/.test(key))return 'barh';
      if(/bar|column|柱|棒/.test(key))return 'bar';
      if(series.length===1&&labels.some(label=>[...String(label)].length>=6))return 'barh';
      const sequential=/^(\d{4}|\d{1,2}月|\d{1,2}日|q[1-4]|第[一二三四]季)/i;
      if(labels.length>=6&&labels.filter(label=>sequential.test(String(label).trim())).length>=Math.ceil(labels.length*0.6))return 'line';
      return 'bar';
    }
    function finishChart(title,kindHint,labels,series){
      if(!labels||!series||!series.length)return null;
      const width=labels.length;
      if(width<2||width>24)return null;
      const cleaned=series.slice(0,6).map((item,index)=>{
        const data=(item.data||[]).slice(0,width);
        while(data.length<width)data.push(0);
        return {name:item.name||('系列'+(index+1)),data:data.slice(0,width)};
      }).filter(item=>item.data.some(n=>n!==0)||series.length===1);
      if(!cleaned.length||cleaned.some(item=>item.data.length!==width))return null;
      if(cleaned.every(item=>item.data.every(n=>n===0)))return null;
      return {title:title||'',kind:chartKind(kindHint,labels,cleaned),labels,series:cleaned};
    }
    function parseChart(raw){
      if(Array.isArray(raw)&&raw.length>=2)return parseChart({data:raw});
      const rec=asRecord(raw);
      if(!rec)return null;
      const type=String(rec.type||rec.chartType||rec.kind||'').toLowerCase();
      if(/^(image|photo|picture|attachment|file|document|video|audio)$/.test(type))return null;
      if((type==='widget'||Array.isArray(rec.options))&&!rec.series&&!rec.labels&&!rec.chart)return null;
      const nested=asRecord(rec.chart)||asRecord(rec.graph)||asRecord(rec.plot)||asRecord(rec.widget);
      const src=nested&&(nested.series||nested.labels||nested.data||nested.values||nested.datasets||nested.x||nested.y)?nested:rec;
      const title=pickStr(src,['title','name','prompt','label'])||pickStr(rec,['title','name','prompt','label']);
      const kindHint=String(src.chartType||src.kind||src.type||type||title||'');
      let labels=null,series=null;
      const datasets=src.datasets||src.series;
      if(Array.isArray(datasets)&&datasets.length&&asRecord(datasets[0])){
        const first=numericList(datasets[0].data||datasets[0].values||datasets[0].y);
        if(first){
          labels=labelList(src.labels||src.x||src.categories,first.map((_,i)=>String(i+1)));
          series=datasets.map((item,i)=>({name:String(item.name??item.label??item.title??('系列'+(i+1))),data:numericList(item.data||item.values||item.y)||first.map(()=>0)}));
        }else{
          const points=datasets.map(item=>({label:String(item.label??item.name??item.x??''),value:toNumber(item.value??item.y??item.count??item.v)}));
          if(points.length>=2&&points.every(item=>item.label&&Number.isFinite(item.value))){
            labels=points.map(item=>item.label);
            series=[{name:title||'数值',data:points.map(item=>item.value)}];
          }
        }
      }
      if(!series){
        const values=numericList(src.values||src.y||(Array.isArray(src.data)&&src.data.every(value=>typeof value==='number'||typeof value==='string')?src.data:null));
        if(values){
          labels=labelList(src.labels||src.x||src.categories,values.map((_,i)=>String(i+1)));
          series=[{name:title||pickStr(src,['yLabel','metric'])||'数值',data:values}];
        }
      }
      if(!series&&Array.isArray(src.data)&&src.data.length>=2&&src.data.every(asRecord)){
        const points=src.data.map(item=>({label:String(item.label??item.name??item.x??''),value:toNumber(item.value??item.y??item.count??item.v)}));
        if(points.every(item=>item.label&&Number.isFinite(item.value))){
          labels=points.map(item=>item.label);
          series=[{name:title||'数值',data:points.map(item=>item.value)}];
        }
      }
      const chart=finishChart(title,kindHint,labels,series);
      if(chart)return chart;
      if(nested&&nested!==rec&&nested!==src)return parseChart(nested);
      return null;
    }
    function tableToChart(header,rows){
      if(!header||header.length<2||rows.length<2||rows.length>16)return null;
      const cols=[];
      for(let j=1;j<header.length;j++){
        if(rows.every(row=>Number.isFinite(toNumber(row[j]??''))))cols.push(j);
      }
      if(!cols.length)return null;
      const labels=rows.map(row=>String(row[0]??'').trim());
      if(labels.some(label=>!label)||new Set(labels).size<2)return null;
      const series=cols.map(j=>({name:String(header[j]||('系列'+j)),data:rows.map(row=>toNumber(row[j]??''))}));
      return finishChart('','',labels,series);
    }
    function formatTick(n){
      const a=Math.abs(n),sign=n<0?'-':'';
      if(a>=1e8)return sign+(a/1e8).toFixed(a>=1e9?0:1).replace(/\.0$/,'')+'亿';
      if(a>=1e4)return sign+(a/1e4).toFixed(a>=1e5?0:1).replace(/\.0$/,'')+'万';
      if(Math.abs(n-Math.round(n))<1e-6)return String(Math.round(n));
      return String(Math.round(n*100)/100);
    }
    function ChartCard({spec}){
      const {title,kind,labels,series}=spec;
      const palette=['var(--g-accent)','#5b8def','#5b9f83','#bc9455','#c1739a','#7a6fd1'];
      const all=series.flatMap(item=>item.data);
      const max=Math.max(0,...all),min=Math.min(0,...all),span=(max-min)||1;
      const W=400,H=200,pl=28,pr=12,pt=14,pb=32,iw=W-pl-pr,ih=H-pt-pb;
      const summary=(title?title+'：':'')+series.map(item=>item.name+' '+item.data.map((n,i)=>labels[i]+' '+formatTick(n)).join('，')).join('；');
      const kindLabel={bar:'柱状图',barh:'条形图',line:'折线图',area:'面积图',pie:'饼图'}[kind]||'图表';
      let plot=null;
      if(kind==='pie'){
        const values=series[0].data.map(n=>Math.max(0,n));
        const total=values.reduce((a,b)=>a+b,0)||1;
        const cx=W/2,cy=H/2,r=74,inner=36;
        let acc=0;
        plot=h('svg',{viewBox:'0 0 '+W+' '+H,className:'grok-chart-svg','aria-hidden':true},values.map((n,i)=>{
          const start=acc/total,end=(acc+n)/total;acc+=n;
          const a0=start*2*Math.PI-Math.PI/2,a1=end*2*Math.PI-Math.PI/2,large=end-start>0.5?1:0;
          const p0=[cx+r*Math.cos(a0),cy+r*Math.sin(a0)],p1=[cx+r*Math.cos(a1),cy+r*Math.sin(a1)];
          const q0=[cx+inner*Math.cos(a0),cy+inner*Math.sin(a0)],q1=[cx+inner*Math.cos(a1),cy+inner*Math.sin(a1)];
          const d='M '+p0[0]+' '+p0[1]+' A '+r+' '+r+' 0 '+large+' 1 '+p1[0]+' '+p1[1]+' L '+q1[0]+' '+q1[1]+' A '+inner+' '+inner+' 0 '+large+' 0 '+q0[0]+' '+q0[1]+' Z';
          return h('path',{key:i,className:'grok-chart-slice',d,fill:palette[i%palette.length],style:{animationDelay:(i*70)+'ms'}});
        }));
      }else if(kind==='barh'){
        const peak=Math.max(...series[0].data.map(Math.abs),1);
        plot=h('div',{className:'grok-chart-bars'},labels.map((label,i)=>{
          const n=series[0].data[i],pct=Math.max(2,Math.abs(n)/peak*100);
          return h('div',{key:i,className:'grok-chart-row'},h('span',{className:'grok-chart-row-label',title:label},label),h('span',{className:'grok-chart-row-track'},h('span',{className:'grok-chart-row-fill',style:{width:pct+'%',animationDelay:(i*60)+'ms'}})),h('span',{className:'grok-chart-row-val'},formatTick(n)));
        }));
      }else if(kind==='line'||kind==='area'){
        const coords=series.map(item=>item.data.map((n,i)=>[pl+iw*(labels.length===1?0.5:i/(labels.length-1)),pt+ih*((max-n)/span)]));
        const zero=pt+ih*(max/span);
        plot=h('svg',{viewBox:'0 0 '+W+' '+H,className:'grok-chart-svg','aria-hidden':true},
          h('line',{x1:pl,x2:pl+iw,y1:zero,y2:zero,className:'grok-chart-axis'}),
          ...coords.map((pts,si)=>{
            const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
            const area=d+' L '+pts[pts.length-1][0].toFixed(1)+' '+(pt+ih)+' L '+pts[0][0].toFixed(1)+' '+(pt+ih)+' Z';
            return h('g',{key:si},kind==='area'&&h('path',{className:'grok-chart-fill',d:area,fill:palette[si%palette.length]}),h('path',{className:'grok-chart-line',d,fill:'none',stroke:palette[si%palette.length],strokeWidth:2,style:{animationDelay:(si*80)+'ms'}}),...pts.map((p,i)=>h('circle',{key:i,className:'grok-chart-dot',cx:p[0],cy:p[1],r:3.2,fill:palette[si%palette.length],style:{animationDelay:(i*50+si*80)+'ms'}})));
          }),
          ...labels.map((label,i)=>h('text',{key:i,className:'grok-chart-tick',x:pl+iw*(labels.length===1?0.5:i/(labels.length-1)),y:H-10,textAnchor:'middle'},label))
        );
      }else{
        const groupW=iw/labels.length,barW=Math.min(28,groupW*0.72/series.length),gap=barW*0.16,total=barW*series.length+gap*(series.length-1);
        const zero=pt+ih*(max/span);
        plot=h('svg',{viewBox:'0 0 '+W+' '+H,className:'grok-chart-svg','aria-hidden':true},
          h('line',{x1:pl,x2:pl+iw,y1:zero,y2:zero,className:'grok-chart-axis'}),
          ...labels.flatMap((label,i)=>series.map((item,si)=>{
            const n=item.data[i],bh=Math.abs(n)/span*ih,x=pl+groupW*i+(groupW-total)/2+si*(barW+gap),y=n>=0?zero-bh:zero;
            return h('rect',{key:i+'-'+si,className:'grok-chart-bar',x,y,width:barW,height:Math.max(bh,1.5),rx:3,fill:palette[si%palette.length],style:{animationDelay:(i*45+si*30)+'ms'}});
          })),
          ...labels.map((label,i)=>h('text',{key:'t'+i,className:'grok-chart-tick',x:pl+groupW*i+groupW/2,y:H-10,textAnchor:'middle'},label))
        );
      }
      const legend=kind==='pie'?labels.map((label,i)=>({name:label,color:palette[i%palette.length],value:series[0].data[i]})):series.length>1?series.map((item,i)=>({name:item.name,color:palette[i%palette.length]})):[];
      return h('figure',{className:'grok-chart','data-kind':kind,role:'img','aria-label':summary||kindLabel},
        h('figcaption',{className:'grok-chart-head'},title?h('strong',null,title):h('strong',null,kindLabel),title&&h('span',null,kindLabel)),
        plot,
        legend.length?h('ul',{className:'grok-chart-legend'},legend.map((item,i)=>h('li',{key:i},h('i',{style:{background:item.color},'aria-hidden':true}),item.name,item.value!=null&&h('span',null,formatTick(item.value))))):null);
    }
    function collectMedia(data,type){
      const rec=asRecord(data);
      if(!rec)return null;
      const list=Array.isArray(rec.attachments)?rec.attachments:Array.isArray(rec.files)?rec.files:Array.isArray(rec.images)?rec.images:null;
      if(list&&list.length)return list.slice(0,12).map((item,i)=>h(MediaCard,{key:i,data:item,kind:type==='image'||type==='images'?'image':'file'}));
      return null;
    }
    function mediaKindOf(tag){
      const t=String(tag||'').toLowerCase();
      if(/image|photo|picture/.test(t))return 'image';
      if(/video/.test(t))return 'video';
      if(/audio/.test(t))return 'audio';
      if(/attachment|file|document|upload/.test(t))return 'attachment';
      return '';
    }
    function hasMediaFields(data){
      const rec=asRecord(data);if(!rec)return false;
      const inner=asRecord(rec.file)||asRecord(rec.attachment)||asRecord(rec.image)||rec;
      return !!(pickName(inner)||pickName(rec)||pickUrl(inner)||pickUrl(rec)||pickPath(inner)||pickPath(rec));
    }
    // Pure skip check — h(EntryBody) is never null, so the list must decide before createElement.
    function isQuietEntry(entry){
      const tagged=parseTagged(entry.text);
      const payload=asRecord(entry.payload);
      const data=payload||(tagged&&tagged.data)||null;
      const nested=data&&(asRecord(data.widget)||asRecord(data.message)||asRecord(data.attachment)||asRecord(data.image)||asRecord(data.file));
      const type=String((data&&data.type)||(nested&&nested.type)||(tagged&&tagged.tag)||entry.kind||'').toLowerCase();
      const mediaKind=mediaKindOf(type)||mediaKindOf(entry.kind)||mediaKindOf(tagged&&tagged.tag);
      if(mediaKind&&!hasMediaFields(nested||data||payload))return true;
      if(entry.role==='system'&&(mediaKindOf(entry.kind)||(tagged&&mediaKindOf(tagged.tag)))&&!hasMediaFields(nested||data||payload))return true;
      return false;
    }
    function EntryBody({entry,onPick,busy,answered,pickedValue}){
      const payload=asRecord(entry.payload);
      const tagged=parseTagged(entry.text);
      const data=payload||(tagged&&tagged.data)||null;
      const nested=data&&(asRecord(data.widget)||asRecord(data.message)||asRecord(data.attachment)||asRecord(data.image)||asRecord(data.file));
      const type=String((data&&data.type)||(nested&&nested.type)||(tagged&&tagged.tag)||entry.kind||'').toLowerCase();
      const mediaKind=mediaKindOf(type)||mediaKindOf(entry.kind)||mediaKindOf(tagged&&tagged.tag);
      const widget=type==='widget'?(asRecord(data&&data.widget)||(data&&Array.isArray(data.options)?data:null)||asRecord(nested&&nested.widget)||(nested&&Array.isArray(nested.options)?nested:null)):null;
      if(widget&&(widget.prompt||widget.title||(Array.isArray(widget.options)&&widget.options.length)))return h(WidgetCard,{widget,onPick,busy,answered:!!answered,pickedValue:pickedValue||''});
      const chart=parseChart(data)||parseChart(nested);
      if(chart)return h(ChartCard,{spec:chart});
      const gallery=collectMedia(data,type)||collectMedia(nested,type);
      if(gallery)return h('div',{className:'grok-media-list'},gallery);
      if(mediaKind){
        const cardData=nested||data||payload;
        if(!hasMediaFields(cardData))return null; // skip empty attachment stubs / raw labels
        return h(MediaCard,{data:cardData,kind:mediaKind});
      }
      if(data&&tagged&&entry.role!=='user'&&!mediaKindOf(tagged.tag))return h(GenericCard,{tag:tagged.tag||type||entry.kind||'card',data});
      if(entry.role==='bot')return h(Markdown,{text:entry.text});
      if(entry.role==='system'){
        // Never surface raw kind labels like "user-attachment" as the only visible text.
        if(mediaKindOf(entry.kind)||(tagged&&mediaKindOf(tagged.tag)))return null;
        return h(SystemEntry,{entry});
      }
      return entry.text;
    }
    const css = "\n.grok-sidebar,.grok-panel,.grok-shade{--g-ink:var(--dsw-alias-label-primary);--g-muted:var(--dsw-alias-label-secondary);--g-faint:var(--dsw-alias-label-tertiary);--g-line:var(--dsw-alias-border-l1);--g-accent:var(--dsw-alias-state-business-primary);--g-hover:var(--dsw-alias-interactive-bg-hover);--g-danger:var(--dsw-alias-state-error-primary);font-family:var(--dsw-font-family);font-size:13px;color:var(--g-ink);box-sizing:border-box}\n.grok-sidebar *,.grok-panel *,.grok-shade *{box-sizing:border-box}.grok-sidebar button,.grok-panel button,.grok-shade button{appearance:none;cursor:pointer;font:inherit;color:inherit;background:transparent;border:0;border-radius:7px}.grok-sidebar button:disabled,.grok-panel button:disabled,.grok-shade button:disabled{cursor:default;opacity:.45}.grok-sidebar button:focus-visible,.grok-sidebar a:focus-visible,.grok-panel button:focus-visible,.grok-shade button:focus-visible{outline:2px solid var(--g-accent);outline-offset:1px}\n.grok-sidebar{height:100%;min-height:0;display:flex;flex-direction:column;padding-right:var(--dsh-sidebar-inline-padding,12px);overflow:hidden;font-size:14px}.grok-sidebar-heading{display:flex;align-items:center;gap:4px;padding:0 0 0 4px;height:36px;min-height:36px;margin-bottom:4px;overflow:hidden}.grok-sidebar-heading strong{flex:0 0 auto;min-width:0;max-width:45%;font:var(--dsw-font-xs-strong-13);color:var(--g-faint);line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;transition:max-width .18s,opacity .12s,margin-right .18s,visibility 0s linear}.grok-sidebar-heading strong.grok-section-label-hidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;pointer-events:none}.grok-search-slot{box-sizing:border-box;min-width:0;max-width:28px;flex:1 1 0%;align-items:center;margin-left:auto;display:flex;transition:max-width .18s}.grok-search-slot-expanded{max-width:100%}.grok-header-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;max-width:160px;overflow:hidden;transition:max-width .18s,opacity .12s,visibility 0s linear}.grok-header-actions-hidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0}.grok-icon{display:grid;place-items:center;width:28px;height:28px;flex:none;color:var(--g-muted)!important;text-decoration:none;border-radius:var(--dsw-radius-sm,8px)}.grok-icon:hover{color:var(--g-ink)!important;background:var(--g-hover)}.grok-connection{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 4px 8px;min-height:18px;font-size:11px;line-height:16px;color:var(--g-faint);font-variant-numeric:tabular-nums;letter-spacing:.01em}.grok-connection-source{display:inline-flex;align-items:center;gap:5px;min-width:0;color:var(--g-muted)}.grok-connection-counts{display:inline-flex;align-items:center;gap:0;flex:none;white-space:nowrap;color:var(--g-faint)}.grok-connection-count{font-variant-numeric:tabular-nums}.grok-connection-sep{margin:0 5px;opacity:.55;font-weight:400}.grok-state-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--g-faint);flex:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--g-faint) 18%,transparent)}.grok-state-dot[data-state=running]{background:var(--dsw-alias-state-success-primary,#5b9f83);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary,#5b9f83) 20%,transparent)}.grok-state-dot[data-state=unread]{background:var(--g-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--g-accent) 20%,transparent)}.grok-state-dot[data-state=waiting]{background:var(--dsw-alias-state-warning-primary,#bc9455);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warning-primary,#bc9455) 20%,transparent)}.grok-state-dot[data-state=idle]{background:var(--g-faint)}\n.grok-search{box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);cursor:text;width:100%;height:28px;color:var(--g-muted);background:transparent;border:0;display:flex;align-items:center;gap:0;margin:0;padding:0;overflow:hidden;transition:width .18s,padding .18s,border-color .18s}.grok-search-expanded{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);width:calc(100% + 4px);height:30px;color:var(--g-faint);margin-inline:-2px;padding:0 4px 0 0}.grok-search-btn{border-radius:var(--dsw-radius-sm,8px);cursor:pointer;width:28px;height:28px;color:inherit;background:transparent;border:0;flex:none;display:inline-flex;justify-content:center;align-items:center;padding:0}.grok-search-expanded .grok-search-btn{width:28px;height:30px}.grok-search-btn:hover{background:var(--g-hover)}.grok-search-expanded .grok-search-btn:hover{background:transparent}.grok-search-input{opacity:0;pointer-events:none;width:0;min-width:0;flex:1 1 0%;color:var(--g-ink);background:transparent;border:0;outline:none;font:inherit;font-size:13px;line-height:18px;padding:0;transition:opacity .12s}.grok-search-expanded .grok-search-input{opacity:1;pointer-events:auto;margin-left:-2px}.grok-search-input::placeholder{color:var(--g-faint)}.grok-bot-list{overflow:auto;min-height:0;flex:1;padding:0 0 16px;scrollbar-width:thin}.grok-group{margin:0}.grok-group-heading{display:flex;align-items:center;min-height:34px;height:34px;color:var(--g-ink);padding:0;border-radius:var(--dsw-radius-md)}.grok-group-toggle{display:flex;align-items:center;gap:6px;min-width:0;flex:1;padding:0 8px;padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));height:34px;text-align:left;color:var(--g-ink)}.grok-chevron{display:inline-flex}.grok-chevron[data-collapsed=false]{transform:rotate(90deg)}.grok-group-heading>.grok-icon{width:22px;height:24px;opacity:0}.grok-group-heading:hover>.grok-icon,.grok-group-heading:focus-within>.grok-icon{opacity:1}\n.grok-bot{display:flex;align-items:center;gap:0;width:100%;height:32px;min-height:32px;padding:0 8px;padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));text-align:left;margin:0;position:relative;border-radius:var(--dsw-radius-md);color:var(--g-ink)}.grok-bot:hover{background:var(--g-hover)}.grok-bot[aria-current=true]{background:var(--g-hover)}.grok-group .grok-bot+.grok-bot,.grok-bot-list>.grok-bot+.grok-bot{margin-top:2px}.grok-bot-copy{display:flex;flex-direction:column;min-width:0;flex:1;gap:0}.grok-bot-name{font-size:14px;font-weight:400;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 6px 0 4px}.grok-preview{display:none;font-size:12px;line-height:15px;color:var(--g-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.grok-bot-list[data-searching=true] .grok-preview{display:block}.grok-bot-list[data-searching=true] .grok-bot{height:auto;min-height:48px;padding-top:4px;padding-bottom:4px}\n.grok-panel{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}.grok-chat-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 26px 14px;border-bottom:1px solid var(--g-line);flex-wrap:wrap;flex:none}.grok-chat-title{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0;flex:1}.grok-chat-title h1{font-size:16px;line-height:24px;font-weight:600;margin:0;overflow-wrap:anywhere}.grok-chat-title>span{font-size:11px;color:var(--g-faint)}.grok-chat-title p{flex:0 0 100%;font-size:12px;color:var(--g-faint);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.grok-chat-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.grok-chat-actions button{font-size:11px;padding:5px 8px;color:var(--g-faint)}.grok-chat-actions button:hover:not(:disabled){background:var(--g-hover);color:var(--g-ink)}.grok-panel [data-danger=true],.grok-dialog [data-danger=true]{color:var(--g-danger)}\n.grok-log{flex:1;min-height:0;overflow:auto;padding:24px max(26px,calc((100% - 850px)/2));scrollbar-width:thin;overflow-anchor:none}.grok-entry{margin:0 0 24px}.grok-entry-meta{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:500;color:var(--g-muted);margin-bottom:7px}.grok-entry-meta time{font-size:10px;font-weight:400;color:var(--g-faint)}.grok-entry-body{font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.grok-entry[data-role=user] .grok-entry-body{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--g-line);padding:10px 14px;border-radius:10px}.grok-entry[data-role=system] .grok-entry-body{font-size:11px;font-family:ui-monospace,monospace;color:var(--g-faint)}.grok-entry[data-role=notice] .grok-entry-body{color:var(--dsw-alias-state-warning-primary)}.grok-older{display:block;margin:0 auto 24px;padding:6px 14px;border:1px solid var(--g-line)!important;font-size:11px!important;color:var(--g-faint)!important}.grok-empty{padding:28px 10px;color:var(--g-faint);font-size:12px;text-align:center}.grok-welcome{margin:auto;text-align:center;color:var(--g-faint);padding:32px}.grok-welcome h2{font-size:18px;color:var(--g-muted)}.grok-welcome p{font-size:12px}\n.grok-composer{flex:none;padding:12px 16px 14px;margin:0 auto;width:100%;max-width:900px}.grok-composer textarea{display:block;width:100%;min-height:84px;max-height:200px;resize:vertical;appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;background:var(--dsw-specific-input-major);color:var(--g-ink);font:inherit;line-height:1.6;outline:none}.grok-composer textarea:focus{border-color:var(--g-accent)}.grok-composer-bottom{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:8px;min-height:30px}.grok-composer-bottom>span{font-size:11px;color:var(--g-faint);overflow-wrap:anywhere}.grok-composer-bottom button{padding:6px 18px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:12px}.grok-error{padding:8px 10px;margin:0 0 10px;border-radius:7px;background:color-mix(in srgb,var(--g-danger) 7%,transparent);color:var(--g-danger);font-size:11px;line-height:18px;overflow-wrap:anywhere}.grok-error button{margin-left:8px;text-decoration:underline}.grok-search-clear{border-radius:var(--dsw-radius-sm,8px);cursor:pointer;width:24px;height:24px;color:var(--g-muted);background:transparent;border:0;flex:none;display:inline-flex;justify-content:center;align-items:center;padding:0}.grok-search-clear:hover{background:var(--g-hover);color:var(--g-ink)}.grok-status-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;font-size:11px;line-height:18px;color:var(--g-muted);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--g-line)}.grok-status-pill[data-state=running]{color:var(--dsw-alias-state-success-primary,#5b9f83);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#5b9f83) 35%,transparent)}.grok-status-pill[data-state=waiting]{color:var(--dsw-alias-state-warning-primary,#bc9455)}.grok-status-pill[data-state=unread]{color:var(--g-accent)}.grok-chat-actions button[data-interrupt=true]{color:#fff;background:var(--dsw-alias-state-warning-primary,#bc9455);border-radius:8px;padding:6px 12px;font-weight:600}.grok-chat-actions button[data-interrupt=true]:hover:not(:disabled){filter:brightness(1.05);color:#fff;background:var(--dsw-alias-state-warning-primary,#bc9455)}.grok-chat-actions button[data-interrupt=true]:disabled{opacity:.45}.grok-menu-wrap{position:relative}.grok-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:148px;padding:5px;border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.18));border:1px solid var(--g-line)}.grok-menu button{display:flex;width:100%;align-items:center;gap:8px;text-align:left;padding:8px 9px;border:0;background:transparent;color:var(--g-muted);border-radius:7px;font:inherit;font-size:12px;cursor:pointer}.grok-menu button:hover:not(:disabled){background:var(--g-hover);color:var(--g-ink)}.grok-menu button[data-danger=true]{color:var(--g-danger)}.grok-empty-actions{display:flex;justify-content:center;gap:8px;margin-top:12px;flex-wrap:wrap}.grok-empty-actions button,.grok-welcome button{appearance:none;border:1px solid var(--g-line);background:var(--dsw-alias-bg-layer-1);color:var(--g-ink);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}.grok-empty-actions button[data-primary=true],.grok-welcome button[data-primary=true]{background:var(--g-accent);border-color:transparent;color:#fff}.grok-welcome .grok-empty-actions{margin-top:16px}.grok-dialog select{width:100%;height:34px;margin-top:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:inherit;font:inherit;padding:0 10px}\n.grok-local-state{font-size:10px;font-weight:400;color:var(--g-faint)}.grok-local-state[data-failed=true]{color:var(--g-danger)}.grok-local-action{font-size:10px!important;padding:1px 6px!important;color:var(--g-muted)!important;text-decoration:underline}.grok-local-action:hover:not(:disabled){color:var(--g-ink)!important;background:var(--g-hover)!important}.grok-entry[data-local=sending] .grok-entry-body{opacity:.65}.grok-entry[data-local=failed] .grok-entry-body{border-color:color-mix(in srgb,var(--g-danger) 45%,transparent)!important}.grok-composer-bottom>span[data-failed=true]{color:var(--g-danger)}.grok-shade{position:fixed;inset:0;z-index:10040;display:grid;place-items:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:blur(3px)}.grok-dialog{width:min(400px,calc(100vw - 40px));padding:24px;border:1px solid var(--g-line);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent)}.grok-dialog h2{margin:0 0 20px;font-size:15px;font-weight:600}.grok-dialog p{font-size:12px;line-height:1.8;color:var(--g-muted)}.grok-dialog label{font-size:12px;font-weight:500}.grok-dialog input{display:block;width:100%;height:36px;padding:0 11px;margin:6px 0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;background:var(--dsw-specific-input-major);color:var(--g-ink);outline:none}.grok-dialog input:focus{border-color:var(--g-accent)}.grok-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:24px;flex-wrap:wrap}.grok-dialog-actions button{padding:7px 14px;font-size:12px;border:1px solid var(--g-line)}.grok-dialog-actions [data-primary=true]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.grok-dialog-actions [data-danger=true]{background:color-mix(in srgb,var(--g-danger) 8%,transparent);color:var(--g-danger)}\n@media(max-width:720px){.grok-chat-heading{padding:14px 16px}.grok-log{padding:18px 16px}.grok-chat-actions{gap:0}.grok-composer{padding:10px 12px}.grok-chat-actions button{padding:5px 6px}}@media(hover:none){.grok-group-heading>.grok-icon{opacity:1}}\n.grok-log{padding:28px max(26px,calc((100% - 820px)/2)) 20px}.grok-entry{margin:0 0 22px;display:flex;flex-direction:column;align-items:flex-start}.grok-entry-meta{gap:8px;margin-bottom:6px}.grok-entry[data-role=bot] .grok-entry-body{white-space:normal;width:100%;min-width:0;max-width:100%;font-size:13.5px;line-height:1.75}.grok-entry[data-role=user]{align-items:flex-end}.grok-entry[data-role=user] .grok-entry-meta{flex-direction:row-reverse}.grok-entry[data-role=user] .grok-entry-body{max-width:min(78%,640px);background:color-mix(in srgb,var(--g-accent) 9%,var(--dsw-alias-bg-layer-1));border:1px solid color-mix(in srgb,var(--g-accent) 18%,var(--g-line));padding:9px 14px;border-radius:14px 14px 4px 14px;line-height:1.7}.grok-entry[data-role=notice]{align-items:center}.grok-entry[data-role=notice] .grok-entry-meta{display:none}.grok-entry[data-role=notice] .grok-entry-body{font-size:11.5px;padding:4px 12px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#bc9455) 10%,transparent)}.grok-entry[data-role=system]{margin-bottom:10px}.grok-entry[data-kind*=attachment]{margin-bottom:12px}.grok-entry[data-local]{margin-bottom:14px}.grok-entry[data-role=system] .grok-entry-meta{display:none}.grok-entry[data-role=system] .grok-entry-body{width:100%;white-space:normal}\n.grok-sys{font-size:11px;color:var(--g-faint);border-left:2px solid var(--g-line);padding:2px 0 2px 10px}.grok-sys summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center}.grok-sys summary::-webkit-details-marker{display:none}.grok-sys summary:before{content:'▸';font-size:9px}.grok-sys[open] summary:before{content:'▾'}.grok-sys-kind{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--g-muted)}.grok-sys-hint{opacity:.7}.grok-sys pre{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:240px;overflow:auto}\n.grok-md{min-width:0;overflow-wrap:anywhere}.grok-md>*:first-child{margin-top:0}.grok-md>*:last-child{margin-bottom:0}.grok-md p{margin:0 0 10px}.grok-md-h{margin:18px 0 8px;font-weight:600;line-height:1.4;color:var(--g-ink)}.grok-md-h[data-level='1']{font-size:17px}.grok-md-h[data-level='2']{font-size:15.5px;padding-bottom:4px;border-bottom:1px solid var(--g-line)}.grok-md-h[data-level='3']{font-size:14px}.grok-md-h[data-level='4'],.grok-md-h[data-level='5'],.grok-md-h[data-level='6']{font-size:13px;color:var(--g-muted)}.grok-md strong{font-weight:600;color:var(--g-ink)}.grok-md a{color:var(--g-accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--g-accent) 35%,transparent)}.grok-md a:hover{border-bottom-color:var(--g-accent)}.grok-md hr{border:0;border-top:1px solid var(--g-line);margin:16px 0}.grok-md blockquote{margin:0 0 10px;padding:4px 0 4px 12px;border-left:3px solid color-mix(in srgb,var(--g-accent) 40%,var(--g-line));color:var(--g-muted)}.grok-md-list{margin:0 0 10px;padding-left:22px}.grok-md-list li{margin:3px 0;padding-left:2px}.grok-md-list li::marker{color:var(--g-faint)}.grok-md-list li[data-depth='1']{margin-left:18px}.grok-md-list li[data-depth='2']{margin-left:36px}.grok-md-list li[data-depth='3']{margin-left:54px}.grok-md-list li[data-task]{list-style:none;margin-left:-18px}.grok-md-list li[data-task=done]{color:var(--g-faint)}.grok-md-check{margin-right:6px}\n.grok-md-code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--g-ink) 7%,transparent);color:var(--g-ink)}.grok-md-pre{margin:4px 0 12px;border:1px solid var(--g-line);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.grok-md-pre-head{display:flex;align-items:center;justify-content:space-between;padding:4px 6px 4px 12px;font-size:10.5px;color:var(--g-faint);border-bottom:1px solid var(--g-line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.grok-md-pre-head button{font-size:10.5px!important;padding:2px 8px!important;color:var(--g-faint)!important}.grok-md-pre-head button:hover{background:var(--g-hover)!important;color:var(--g-ink)!important}.grok-md-pre pre{margin:0;padding:10px 12px;overflow:auto;max-height:420px;white-space:pre;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;scrollbar-width:thin}.grok-md-table{overflow:auto;margin:4px 0 12px;border:1px solid var(--g-line);border-radius:8px}.grok-md-table table{border-collapse:collapse;width:100%;font-size:12.5px}.grok-md-table th,.grok-md-table td{padding:6px 10px;border-bottom:1px solid var(--g-line);text-align:left;vertical-align:top}.grok-md-table th{font-weight:600;background:var(--dsw-alias-bg-layer-1)}.grok-md-table tr:last-child td{border-bottom:0}\n.grok-composer-box{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-specific-input-major);transition:border-color .15s,box-shadow .15s}.grok-composer-box:focus-within{border-color:var(--g-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--g-accent) 12%,transparent)}.grok-composer .grok-composer-box textarea{border:0;background:transparent;min-height:52px;max-height:240px;resize:none;padding:12px 14px 4px;border-radius:14px}.grok-composer-tools{display:flex;align-items:center;gap:4px;padding:2px 8px 8px}.grok-composer-tools .grok-icon{width:28px;height:28px}.grok-composer-tools .grok-attach[aria-disabled=true]{opacity:.45;cursor:not-allowed}.grok-composer-tools .grok-spacer{flex:1}.grok-composer-tools button[type=submit]{padding:6px 16px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-size:12px;border-radius:9px}.grok-composer-bottom{margin-top:6px;min-height:18px}\n.grok-widget{margin:2px 0 4px;max-width:min(100%,520px);padding:12px 14px;border:1px solid var(--g-line);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}\n.grok-widget-prompt{margin:0 0 10px;font-size:13.5px;font-weight:600;line-height:1.5;color:var(--g-ink)}\n.grok-widget-options{display:flex;flex-wrap:wrap;gap:8px}\n.grok-widget-options button{padding:6px 12px;border:1px solid var(--g-line)!important;border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--g-ink);font-size:12.5px;line-height:1.4}\n.grok-widget-options button:hover:not(:disabled){background:var(--g-hover);border-color:color-mix(in srgb,var(--g-accent) 35%,var(--g-line))!important}\n.grok-widget-options button[data-primary=true]{background:var(--g-accent);border-color:transparent!important;color:#fff}\n.grok-widget-options button[data-primary=true]:hover:not(:disabled){filter:brightness(1.05);color:#fff;background:var(--g-accent)}\n.grok-widget[data-answered=true]{opacity:.92;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);border-style:dashed}\n.grok-widget-picked{margin:0;font-size:12px;line-height:1.5;color:var(--g-faint)}\n.grok-media-list{display:flex;flex-direction:column;gap:8px}\n.grok-media{display:flex;gap:10px;align-items:flex-start;margin:2px 0 4px;max-width:min(100%,520px);padding:10px 12px;border:1px solid var(--g-line);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}\n.grok-media-image{flex-direction:column;padding:0;overflow:hidden}\n.grok-media-image>a{display:block;width:100%}\n.grok-media-image img{display:block;width:100%;max-height:420px;object-fit:contain;background:color-mix(in srgb,var(--g-ink) 4%,transparent)}\n.grok-media-image figcaption{padding:8px 12px 10px}\n.grok-media-icon{display:grid;place-items:center;width:36px;height:36px;flex:none;border-radius:9px;background:color-mix(in srgb,var(--g-accent) 12%,transparent);color:var(--g-accent)}\n.grok-media figcaption{display:flex;flex-direction:column;gap:2px;min-width:0}\n.grok-media strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}\n.grok-media-meta,.grok-media-path{font-size:11px;color:var(--g-faint);overflow-wrap:anywhere}\n.grok-media a{color:var(--g-accent);font-size:12px;text-decoration:none}\n.grok-card{margin:2px 0;padding:2px 0 2px 10px;border-left:2px solid var(--g-line);font-size:12px}\n.grok-card summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.grok-card summary::-webkit-details-marker{display:none}\n.grok-card-kind{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--g-muted)}\n.grok-card-title{color:var(--g-ink);overflow-wrap:anywhere}\n.grok-card pre{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:240px;overflow:auto}\n.grok-md-img-wrap{margin:8px 0 12px;max-width:min(100%,520px)}\n.grok-md img.grok-md-img,.grok-md-img-wrap .grok-md-img{display:block;margin:8px 0;max-width:min(100%,520px);max-height:420px;height:auto;object-fit:contain;border:1px solid var(--g-line);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}\n\n\n.grok-chart{margin:4px 0 10px;max-width:min(100%,560px);padding:12px 14px 10px;border:1px solid var(--g-line);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}\n.grok-chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 10px}\n.grok-chart-head strong{font-size:13.5px;font-weight:600;color:var(--g-ink)}\n.grok-chart-head span{font-size:11px;color:var(--g-faint)}\n.grok-chart-svg{display:block;width:100%;height:auto}\n.grok-chart-tick{fill:var(--g-faint);font-size:10px}\n.grok-chart-axis{stroke:var(--g-line);stroke-width:1}\n.grok-chart-bar{transform-box:fill-box;transform-origin:center bottom;animation:grok-chart-grow .72s cubic-bezier(.22,.61,.36,1) both}\n.grok-chart-line{stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:920;stroke-dashoffset:920;animation:grok-chart-draw 1s ease forwards}\n.grok-chart-fill{opacity:0;animation:grok-chart-fade .7s ease .15s forwards}\n.grok-chart-dot{opacity:0;animation:grok-chart-dot .35s ease forwards}\n.grok-chart-slice{transform-box:fill-box;transform-origin:center;animation:grok-chart-pop .55s cubic-bezier(.22,.61,.36,1) both}\n.grok-chart-bars{display:flex;flex-direction:column;gap:8px}\n.grok-chart-row{display:grid;grid-template-columns:minmax(56px,22%) 1fr auto;align-items:center;gap:8px}\n.grok-chart-row-label{font-size:12px;color:var(--g-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.grok-chart-row-track{height:10px;border-radius:999px;background:color-mix(in srgb,var(--g-ink) 7%,transparent);overflow:hidden}\n.grok-chart-row-fill{display:block;height:100%;border-radius:999px;background:var(--g-accent);transform-origin:left center;animation:grok-chart-growx .7s cubic-bezier(.22,.61,.36,1) both}\n.grok-chart-row-val{font-size:12px;font-variant-numeric:tabular-nums;color:var(--g-ink);min-width:2.6em;text-align:right}\n.grok-chart-legend{display:flex;flex-wrap:wrap;gap:8px 14px;list-style:none;margin:10px 0 0;padding:0;font-size:11.5px;color:var(--g-muted)}\n.grok-chart-legend li{display:inline-flex;align-items:center;gap:6px}\n.grok-chart-legend i{width:8px;height:8px;border-radius:50%;flex:none}\n.grok-chart-legend span{color:var(--g-ink);font-variant-numeric:tabular-nums}\n@keyframes grok-chart-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}\n@keyframes grok-chart-growx{from{transform:scaleX(0)}to{transform:scaleX(1)}}\n@keyframes grok-chart-draw{to{stroke-dashoffset:0}}\n@keyframes grok-chart-fade{to{opacity:.28}}\n@keyframes grok-chart-dot{to{opacity:1}}\n@keyframes grok-chart-pop{from{opacity:0;transform:scale(.62)}to{opacity:1;transform:scale(1)}}\n@media(prefers-reduced-motion:reduce){.grok-chart-bar,.grok-chart-line,.grok-chart-fill,.grok-chart-dot,.grok-chart-slice,.grok-chart-row-fill{animation:none!important;opacity:1;stroke-dashoffset:0;transform:none}}\n.grok-composer-box[data-drop=true]{border-color:var(--g-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--g-accent) 16%,transparent)}\n.grok-chips{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px 0}\n.grok-chip{position:relative;display:flex;align-items:center;gap:8px;max-width:100%;padding:6px 8px 8px;border:1px solid var(--g-line);border-radius:10px;background:var(--dsw-alias-bg-base);overflow:hidden}\n.grok-chip[data-status=error]{border-color:color-mix(in srgb,var(--g-danger) 45%,var(--g-line))}\n.grok-chip-thumb{width:32px;height:32px;object-fit:cover;border-radius:7px;background:var(--dsw-alias-bg-layer-1);flex:none}\n.grok-chip-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:7px;background:color-mix(in srgb,var(--g-accent) 12%,transparent);color:var(--g-accent);flex:none}\n.grok-chip-copy{display:flex;flex-direction:column;min-width:0;flex:1}\n.grok-chip-copy strong{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.grok-chip-copy small{font-size:10.5px;color:var(--g-faint);overflow-wrap:anywhere}\n.grok-chip button{font-size:11px;padding:2px 6px;color:var(--g-faint)}\n.grok-chip button:hover:not(:disabled){background:var(--g-hover);color:var(--g-ink)}\n.grok-chip-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:color-mix(in srgb,var(--g-ink) 8%,transparent)}\n.grok-chip-bar i{display:block;height:100%;background:var(--g-accent)}\n.grok-slot{width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--g-faint)}\n.grok-folder,.grok-chevron{display:inline-flex;align-items:center;justify-content:center}\n.grok-group-heading .grok-chevron{display:none}\n.grok-group-heading:hover .grok-folder,.grok-group-heading:focus-within .grok-folder{display:none}\n.grok-group-heading:hover .grok-chevron,.grok-group-heading:focus-within .grok-chevron{display:inline-flex}\n.grok-group-heading:hover,.grok-group-heading:focus-within{background:var(--g-hover);border-radius:var(--dsw-radius-md)}\n.grok-group-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:400;color:var(--g-ink)}\n.grok-bot-status{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;margin-left:6px}\n.grok-shell{flex:1;min-height:0;min-width:0;display:flex}\n.grok-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}\n.grok-config{flex:0 0 300px;width:300px;max-width:42%;border-left:1px solid var(--g-line);overflow:auto;padding:18px 18px 28px;background:var(--dsw-alias-bg-base);scrollbar-width:thin}\n.grok-config-head{display:flex;align-items:center;gap:12px;margin:0 0 18px}\n.grok-config-head strong{display:block;font-size:15px;line-height:22px;margin-bottom:4px}\n.grok-config-block{margin:0 0 20px}\n.grok-config-block h3{margin:0 0 8px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--g-faint);font-weight:600}\n.grok-config-preview{margin:0;font-size:13px;line-height:1.65;color:var(--g-ink);overflow-wrap:anywhere}\n.grok-config-block time{display:block;margin-top:6px;font-size:11px;color:var(--g-faint)}\n.grok-config-dl{display:grid;grid-template-columns:52px 1fr;gap:6px 10px;margin:0;font-size:12.5px}\n.grok-config-dl dt{color:var(--g-faint)}\n.grok-config-dl dd{margin:0;overflow-wrap:anywhere}\n.grok-config-check{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:13px;color:var(--g-ink)}\n.grok-config-check input{margin:0}\n.grok-config-meta{font-size:12px;color:var(--g-faint);margin:10px 0 0}\n.grok-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}\n.grok-config-actions button,.grok-config-actions a{appearance:none;border:1px solid var(--g-line);background:var(--dsw-alias-bg-layer-1);color:var(--g-ink);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;text-decoration:none;cursor:pointer}\n.grok-chat-heading-copy{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 10px;min-width:0;flex:1}\n.grok-chat-heading-copy h1{font-size:16px;line-height:24px;font-weight:600;margin:0;overflow-wrap:anywhere}\n.grok-chat-heading-copy>span{font-size:11px}\n.grok-chat-heading-copy p{flex:0 0 100%;font-size:12px;color:var(--g-faint);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.grok-chat-title{align-items:center}\n@media(max-width:880px){.grok-panel[data-split=true] .grok-shell{flex-direction:column}.grok-config{flex:0 0 auto;width:100%;max-width:none;border-left:0;border-top:1px solid var(--g-line);max-height:38%}}\n";
    // Content scrolling and responsive sidebars share the panel's actual available width.
    const layoutStyles = `
.grok-panel{position:relative;container:grok-panel / inline-size;width:100%;max-width:100%;overflow:hidden}
.grok-shell{position:relative;width:100%;max-width:100%;overflow:hidden;flex-direction:row}
.grok-chat-heading{position:relative;z-index:40}
.grok-main{flex:1 1 0%;max-width:100%}
.grok-log{min-width:0;overflow-y:auto;overflow-x:hidden;padding:24px max(20px,calc((100% - 820px)/2)) 20px;overscroll-behavior:contain;scrollbar-gutter:stable}
.grok-entry{width:100%;min-width:0;max-width:100%}
.grok-entry-body{min-width:0;max-width:100%;word-break:normal;overflow-wrap:anywhere}
.grok-entry[data-role=bot] .grok-entry-body,.grok-entry[data-role=system] .grok-entry-body{width:100%;padding-left:0;white-space:normal}
.grok-entry-meta{min-width:0;max-width:100%;flex-wrap:wrap;overflow-wrap:anywhere}
.grok-entry-meta time{flex-shrink:0}
.grok-md,.grok-md-pre,.grok-md-table,.grok-card,.grok-sys,.grok-media,.grok-media-list,.grok-chart,.grok-widget{min-width:0;max-width:100%}
.grok-md-pre,.grok-md-table{width:100%}
.grok-md-pre pre{width:100%;max-width:100%;overflow:auto;white-space:pre;overflow-wrap:normal;word-break:normal;overscroll-behavior-x:contain}
.grok-md-pre pre code{white-space:inherit;overflow-wrap:normal;word-break:normal}
.grok-md-pre-head{gap:12px;min-width:0}
.grok-md-pre-head>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grok-md-pre-head button{flex-shrink:0}
.grok-md-table{overflow-x:auto;overscroll-behavior-x:contain}
.grok-md-table th,.grok-md-table td{min-width:7rem;white-space:normal;overflow-wrap:anywhere}
.grok-card pre,.grok-sys pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}
.grok-card summary{min-width:0;max-width:100%;overflow-wrap:anywhere}
.grok-card-title{min-width:0;overflow:hidden;text-overflow:ellipsis}
.grok-widget-options button{min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left}
.grok-composer,.grok-composer-box,.grok-composer-bottom{min-width:0;max-width:100%}
.grok-composer{padding:12px 20px 16px;max-width:860px}
.grok-chip button,.grok-chip-icon,.grok-chip-thumb{flex-shrink:0}
.grok-panel a:focus-visible,.grok-panel summary:focus-visible{outline:2px solid var(--g-accent);outline-offset:2px;border-radius:4px}
.grok-md-pre pre:focus-visible,.grok-md-table:focus-visible{outline:2px solid var(--g-accent);outline-offset:-2px}
.grok-log,.grok-bot-list,.grok-config,.grok-md-pre pre,.grok-md-table,.grok-card pre{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--g-muted) 24%,transparent) transparent}
.grok-log:hover,.grok-bot-list:hover,.grok-config:hover,.grok-md-pre pre:hover,.grok-md-table:hover{scrollbar-color:color-mix(in srgb,var(--g-muted) 40%,transparent) transparent}
.grok-log::-webkit-scrollbar,.grok-bot-list::-webkit-scrollbar,.grok-config::-webkit-scrollbar,.grok-md-pre pre::-webkit-scrollbar,.grok-md-table::-webkit-scrollbar{width:6px;height:6px}
.grok-log::-webkit-scrollbar-thumb,.grok-bot-list::-webkit-scrollbar-thumb,.grok-config::-webkit-scrollbar-thumb,.grok-md-pre pre::-webkit-scrollbar-thumb,.grok-md-table::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--g-muted) 28%,transparent);border-radius:8px;border:1px solid transparent;background-clip:padding-box}
.grok-config{display:block;flex:0 0 clamp(250px,25%,292px);width:clamp(250px,25%,292px);min-width:0;min-height:0;max-width:100%;overflow-y:auto;overflow-x:hidden;padding:0 0 12px;background:var(--dsw-alias-bg-layer-1);scrollbar-gutter:stable}
.grok-config-toolbar{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;padding:10px 12px 10px 16px;border-bottom:1px solid var(--g-line);background:var(--dsw-alias-bg-layer-1)}
.grok-config-toolbar h2{min-width:0;margin:0;font-size:12px;line-height:20px;font-weight:600;color:var(--g-muted)}
.grok-config-head{margin:18px 16px 16px}
.grok-config-head>div{min-width:0;max-width:100%}
.grok-config-head strong{font-size:14px;line-height:22px;overflow-wrap:anywhere;margin-bottom:8px}
.grok-config-block{margin:0 16px;padding:16px 0;border-top:1px solid var(--g-line)}
.grok-config-block h3{font-size:11px;line-height:18px;font-weight:600;letter-spacing:.03em;margin-bottom:10px}
.grok-config-preview{font-size:12px;line-height:1.8;color:var(--g-muted)}
.grok-config-dl{grid-template-columns:42px minmax(0,1fr);gap:10px 12px;font-size:12px;line-height:1.7}
.grok-config-dl dd,.grok-config-meta{min-width:0;overflow-wrap:anywhere}
.grok-config-dl dd{color:var(--g-muted)}
.grok-config-check{align-items:flex-start;line-height:20px;padding:4px 0;margin:0}
.grok-config-check input{flex-shrink:0;margin-top:3px;accent-color:var(--g-accent)}
.grok-config-meta{font-size:11px;line-height:18px;margin-top:12px}
.grok-config-actions{gap:6px;margin-top:12px}
.grok-config-actions button,.grok-config-actions a{min-width:0;padding:6px 9px;font-size:11px;line-height:18px;background:var(--dsw-alias-bg-base);white-space:normal;text-align:center}
.grok-panel[data-config-mode=drawer] .grok-config{position:absolute;inset:12px 12px 12px auto;z-index:30;width:min(292px,calc(100% - 24px));max-width:calc(100% - 24px);max-height:none;border:1px solid var(--g-line);border-radius:12px;box-shadow:0 12px 36px color-mix(in srgb,var(--g-ink) 16%,transparent)}
.grok-sidebar,.grok-bot-list,.grok-group,.grok-group-heading,.grok-bot{min-width:0;max-width:100%}
.grok-sidebar-heading,.grok-header-actions{overflow:visible}
.grok-header-actions-hidden{overflow:hidden}
.grok-bot-list{overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;padding-bottom:20px}
.grok-group+.grok-group{margin-top:6px}
.grok-group-name{min-width:0;flex:1 1 0%}
.grok-group-toggle{gap:6px}
.grok-group-heading>.grok-icon{flex-shrink:0;margin-right:4px}
.grok-bot[aria-current=true]{background:color-mix(in srgb,var(--g-accent) 8%,var(--g-hover));color:var(--g-ink)}
.grok-bot[aria-current=true]:before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--g-accent)}

.grok-bot-status{display:inline-flex;align-items:center;justify-content:flex-end;flex:0 0 auto;min-width:0;width:auto;margin-left:8px}
.grok-status-badge,.grok-status-pill{--g-status-color:var(--g-muted);display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:3em;max-width:100%;gap:0;border-radius:4px;padding:1px 6px;font-size:11px;line-height:18px;font-weight:500;white-space:nowrap;box-shadow:none}
.grok-status-badge[data-state=running],.grok-status-pill[data-state=running]{--g-status-color:color-mix(in srgb,#3b82f6 80%,var(--g-ink))}
.grok-status-badge[data-state=waiting],.grok-status-pill[data-state=waiting]{--g-status-color:color-mix(in srgb,#d97706 80%,var(--g-ink))}
.grok-status-badge[data-state=unread],.grok-status-pill[data-state=unread]{--g-status-color:color-mix(in srgb,#8b5cf6 80%,var(--g-ink))}
.grok-status-badge[data-state=idle],.grok-status-pill[data-state=idle]{--g-status-color:color-mix(in srgb,#64748b 80%,var(--g-ink))}
.grok-status-badge[data-state],.grok-status-pill[data-state]{color:var(--g-status-color);border:1px solid color-mix(in srgb,var(--g-status-color) 34%,transparent);background:color-mix(in srgb,var(--g-status-color) 8%,transparent)}
@container grok-panel (max-width:640px){.grok-log{padding:18px 16px}.grok-composer{padding:10px 16px 12px}.grok-entry[data-role=user] .grok-entry-body{max-width:92%}.grok-chat-heading{padding:12px 16px}.grok-chat-title{flex-basis:0;min-width:0}.grok-chat-heading-copy{min-width:0}.grok-chat-actions{flex-shrink:0}.grok-chat-title h1{font-size:14px}}
`;

    function apply(ctx) {
      const store=createGrokStore();
      const useStore=()=>React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
      let disposeSidebar=null,sidebarAvailable=false;
      let activeMenu=null;
      // Shared by sidebar and chat-header menus: one open at a time, Esc/outside-click close, focus returns to trigger.
      function useMenu(){
        const [open,setOpen]=React.useState(false),trigger=React.useRef(null),menu=React.useRef(null),self=React.useRef(null);
        if(!self.current)self.current={close:restore=>{setOpen(false);if(activeMenu===self.current)activeMenu=null;if(restore&&trigger.current?.isConnected)trigger.current.focus();}};
        const toggle=event=>{event?.stopPropagation();if(open){self.current.close(false);return;}if(activeMenu&&activeMenu!==self.current)activeMenu.close(false);activeMenu=self.current;setOpen(true);};
        React.useEffect(()=>{
          if(!open)return;
          menu.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus();
          const down=event=>{if(menu.current?.contains(event.target)||trigger.current?.contains(event.target))return;self.current.close(false);};
          const key=event=>{
            if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();self.current.close(true);return;}
            if((event.key==='ArrowDown'||event.key==='ArrowUp')&&menu.current){const items=[...menu.current.querySelectorAll('[role=menuitem]:not(:disabled)')];if(!items.length)return;event.preventDefault();const i=items.indexOf(document.activeElement);items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}
          };
          const blur=()=>self.current.close(false);
          document.addEventListener('mousedown',down,true);document.addEventListener('keydown',key,true);window.addEventListener('blur',blur);
          return()=>{document.removeEventListener('mousedown',down,true);document.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);};
        },[open]);
        React.useEffect(()=>()=>{if(activeMenu===self.current)activeMenu=null;},[]);
        return {open,toggle,close:self.current.close,trigger,menu};
      }
      function Sidebar({wide=true}={}) {
        const s=useStore(),[dialog,setDialog]=React.useState(null),[searchOpen,setSearchOpen]=React.useState(false),[settingsOpen,setSettingsOpen]=React.useState(false),searchRef=React.useRef(null),sideMenu=useMenu();
        const openGrokSettings=()=>{if(!sources.openSettings?.(ctx))setSettingsOpen(true);};
        React.useEffect(()=>{const onOpen=()=>openGrokSettings();window.addEventListener('dsh-grok-open-settings',onOpen);return()=>window.removeEventListener('dsh-grok-open-settings',onOpen);},[]);
        React.useEffect(()=>{if(searchOpen){const id=requestAnimationFrame(()=>searchRef.current&&searchRef.current.focus());return()=>cancelAnimationFrame(id);}},[searchOpen]);
        React.useEffect(()=>{if(!searchOpen&&!s.query)return;const onKey=event=>{if(event.key==='Escape'){store.setQuery('');setSearchOpen(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[searchOpen,s.query]);
        if(!wide)return null;
        const layout=s.layout,query=s.query.trim().toLowerCase();
        const visible=bots=>(bots||[]).filter(bot=>(!bot.hidden||bot.id===s.selected)&&(!query||[bot.name,bot.id,bot.description,bot.lastMessagePreview].join(' ').toLowerCase().includes(query)));
        function group(id,name,bots,initial=false,editable=false) {
          const items=visible(bots).filter(bot=>id==='$pinned'||!(layout.pinned||[]).includes(bot.id)),collapsed=!query&&(s.collapsed[id]??initial);
          if(!items.length&&(query||!editable))return null;
          return h('section',{key:id,className:'grok-group','data-grok-group':id},
            h('div',{className:'grok-group-heading'},h('button',{type:'button',className:'grok-group-toggle','aria-expanded':!collapsed,onClick:()=>store.toggleGroup(id,initial)},h('span',{className:'grok-slot','aria-hidden':true},h('span',{className:'grok-folder'},h(Glyph,{name:'folder',size:16})),h('span',{'data-collapsed':collapsed,className:'grok-chevron'},h(Glyph,{name:'chevron',size:12}))),h('span',{className:'grok-group-name'},name)),editable&&h('button',{type:'button',className:'grok-icon','aria-label':'管理分组 '+name,onClick:()=>setDialog({kind:'group',id,name})},h(Glyph,{name:'more',size:15}))),
            !collapsed&&items.map(bot=>h('button',{key:bot.id,type:'button',className:'grok-bot','data-grok-bot':bot.id,'aria-current':bot.id===s.selected?'true':undefined,title:bot.lastMessagePreview||bot.description||label(bot.state),onClick:()=>store.select(bot.id)},h('span',{className:'grok-slot','aria-hidden':true}),h('span',{className:'grok-bot-copy'},h('span',{className:'grok-bot-name'},bot.name),h('span',{className:'grok-preview'},bot.lastMessagePreview||bot.description||label(bot.state))),h('span',{className:'grok-bot-status'},h('span',{className:'grok-status-badge','data-state':bot.state},label(bot.state))))));
        }
        const emptyNode=layout
          ? (!visible(layout.bots).length&&h('div',{className:'grok-empty'},h('div',null,query?'没有匹配的机器人':'暂无机器人'),!query&&h('div',{className:'grok-empty-actions'},h('a',{href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer'},h('button',{type:'button','data-primary':true},'新建机器人')),h('button',{type:'button',disabled:s.loading,onClick:()=>void store.refresh()},'刷新'))))
          : (!s.loading&&h('div',{className:'grok-empty'},h('div',null,'登录 Grok 后点击刷新'),h('div',{className:'grok-empty-actions'},h('a',{href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer'},h('button',{type:'button','data-primary':true},'打开 Grok')),h('button',{type:'button',onClick:()=>void store.refresh()},'刷新'))));
        const botCount=layout?((layout.bots)||[]).length:0;
        const groupCount=layout?((layout.sections)||[]).filter(section=>section.id!=='__agents__').length:0;
        return h('section',{className:'grok-sidebar','data-grok-sidebar':true,'aria-label':'Grok 机器人'},h('style',null,css+layoutStyles),
          h('div',{className:'grok-sidebar-heading','data-search-open':searchOpen||undefined},h('strong',{className:searchOpen?'grok-section-label-hidden':undefined},'机器人'),h('div',{className:'grok-search-slot'+(searchOpen?' grok-search-slot-expanded':'')},h('div',{className:'grok-search'+(searchOpen?' grok-search-expanded':''),onClick:()=>{if(!searchOpen)setSearchOpen(true);}},h('button',{type:'button',className:'grok-search-btn','aria-label':'搜索机器人','aria-expanded':!!searchOpen,title:'搜索',onClick:event=>{event.stopPropagation();setSearchOpen(true);}},h(Glyph,{name:'search',size:14})),h('input',{ref:searchRef,className:'grok-search-input','aria-label':'搜索机器人',placeholder:'搜索机器人名称',value:s.query,tabIndex:searchOpen?0:-1,onChange:event=>store.setQuery(event.target.value),onFocus:()=>setSearchOpen(true),onBlur:()=>{if(!s.query.trim())setSearchOpen(false);},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();store.setQuery('');setSearchOpen(false);event.currentTarget.blur();}}}),(searchOpen&&s.query)&&h('button',{type:'button',className:'grok-search-clear','aria-label':'清除搜索',onMouseDown:event=>event.preventDefault(),onClick:()=>{store.setQuery('');searchRef.current&&searchRef.current.focus();}},h(Glyph,{name:'close',size:12})))), h('div',{className:'grok-header-actions'+(searchOpen?' grok-header-actions-hidden':'')},h('a',{className:'grok-icon',href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer','aria-label':'在新窗口打开 Grok',title:'新窗口'},h(Glyph,{name:'external',size:15})),h('button',{type:'button',className:'grok-icon',title:'刷新机器人','aria-label':'刷新 Grok 机器人',disabled:s.loading,onClick:()=>void store.refresh()},h(Glyph,{name:'refresh',size:15})),h('div',{className:'grok-menu-wrap'},h('button',{type:'button',className:'grok-icon',title:'更多','aria-label':'更多操作','aria-haspopup':'menu','aria-expanded':sideMenu.open,ref:sideMenu.trigger,onClick:sideMenu.toggle},h(Glyph,{name:'more',size:15})),sideMenu.open&&h('div',{ref:sideMenu.menu,className:'grok-menu',role:'menu',onClick:event=>event.stopPropagation()},h('button',{type:'button',role:'menuitem',onClick:()=>{sideMenu.close(true);openGrokSettings();}},'插件设置'),h('button',{type:'button',role:'menuitem',onClick:()=>{sideMenu.close(true);setDialog({kind:'new-group'});}},'新建分组'))),h('a',{className:'grok-icon',href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer','aria-label':'新建 Grok 机器人',title:'新建机器人','data-primary':true},h(Glyph,{name:'plus',size:16})))), 
          h('div',{className:'grok-connection',role:'status'},h('span',{className:'grok-connection-source'},h('span',{className:'grok-state-dot','data-state':s.loading&&!layout?'waiting':(s.connected?'running':'idle'),'aria-hidden':true}),s.loading&&!layout?'连接中':s.connected?'已连接':'不可用'),(!s.loading||layout)?h('span',{className:'grok-connection-counts','aria-label':s.connected?(botCount+' 个机器人，'+groupCount+' 个分组'):(s.error||'连接不可用')},s.connected?h(React.Fragment,null,h('span',{className:'grok-connection-count'},botCount+' 机器人'),h('span',{className:'grok-connection-sep','aria-hidden':true},'·'),h('span',{className:'grok-connection-count'},groupCount+' 分组')):h('span',{className:'grok-connection-count'},s.error||'连接不可用')):null),
          s.error&&h('div',{className:'grok-error',role:'alert'},s.error,h('button',{type:'button',onClick:()=>void store.refresh()},'重试')),
          h('div',{className:'grok-bot-list','data-searching':query?'true':undefined},layout?h(React.Fragment,null,layout.pinnedBots?.length?group('$pinned','置顶',layout.pinnedBots):null,...layout.sections.filter(section=>section.id!=='__agents__').map(section=>group(section.id,section.name,section.bots,section.collapsed,true)),group('__agents__','未分组',layout.ungrouped),emptyNode):emptyNode),
          dialog&&h(Dialog,{key:dialog.kind+dialog.id,value:dialog,onClose:()=>setDialog(null)}),settingsOpen&&createPortal(h(GrokSettingsOverlay,{onClose:()=>setSettingsOpen(false)}),document.body));
      }
      function Dialog({value,onClose}) {
        const s=useStore();
        const groups=(s.layout?.sections||[]).filter(section=>section.id!=='__agents__');
        const [name,setName]=React.useState(value.kind==='move'?(groups[0]?.name||''):(value.name||'')),[newGroup,setNewGroup]=React.useState(''),[error,setError]=React.useState(null),[busy,setBusy]=React.useState(false);
        const box=React.useRef(null),previous=React.useRef(document.activeElement);
        React.useEffect(()=>{box.current?.querySelector('input,button,select')?.focus();return()=>{if(previous.current?.isConnected)previous.current.focus();};},[]);
        const kind=value.kind;
        const moveName=name==='__new__'?newGroup.trim():name.trim();
        const canSave=kind==='delete'||(kind==='move'?!!moveName:!!name.trim());
        const submit=async(event,path)=>{
          event?.preventDefault();if(busy)return;setBusy(true);setError(null);
          const route=path||({rename:'/rename',delete:'/delete',group:'/group-rename','new-group':'/group',move:'/group'}[kind]);
          const body=route==='/group-delete'?{id:value.id}:kind==='new-group'?{name:name.trim(),ids:[]}:kind==='move'?{name:moveName,ids:[value.id]}:kind==='rename'?{id:value.id,name:name.trim()}:kind==='group'?{id:value.id,name:name.trim()}:{id:value.id};
          const ok=await store.mutate(route,body);
          setBusy(false);if(ok)onClose();else setError(store.getSnapshot().notices[body.id||'$groups']);
        };
        const title={rename:'重命名机器人',delete:'删除机器人',group:'管理分组','new-group':'新建分组',move:'移入分组'}[kind];
        return h('div',{className:'grok-shade',onMouseDown:event=>{if(event.target===event.currentTarget&&!busy)onClose();}},h('form',{ref:box,className:'grok-dialog',role:'dialog','aria-modal':true,'aria-label':title,onSubmit:submit,onKeyDown:event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();}if(event.key==='Tab'){const nodes=[...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}},
          h('h2',null,title),kind==='delete'?h('p',null,'确认删除「'+value.name+'」？删除后无法恢复。运行中的机器人请先中断。'):kind==='move'?h(React.Fragment,null,h('label',null,'选择分组',h('select',{required:true,value:name,disabled:busy,onChange:event=>setName(event.target.value)},h('option',{value:''},groups.length?'选择已有分组':'暂无分组'),...groups.map(section=>h('option',{key:section.id,value:section.name},section.name)),h('option',{value:'__new__'},'＋ 新建分组…'))),name==='__new__'&&h('label',null,'新分组名称',h('input',{required:true,maxLength:160,autoComplete:'off',value:newGroup,disabled:busy,onChange:event=>setNewGroup(event.target.value)}))):h('label',null,'名称',h('input',{required:true,maxLength:160,autoComplete:'off',value:name,disabled:busy,onChange:event=>setName(event.target.value)})),
          kind==='move'&&h('p',null,'优先选择已有分组；没有合适的再新建。'),kind==='group'&&h('p',null,'删除分组会将其中的机器人移到未分组。'),error&&h('div',{className:'grok-error',role:'alert'},error),
          h('div',{className:'grok-dialog-actions'},kind==='group'&&h('button',{type:'button','data-danger':true,disabled:busy,onClick:event=>void submit(event,'/group-delete')},'删除分组'),h('button',{type:'button',disabled:busy,onClick:onClose},'取消'),h('button',{type:'submit','data-primary':true,'data-danger':kind==='delete',disabled:busy||!canSave},busy?'处理中…':kind==='delete'?'删除':'保存'))));
      }
      function Panel() {
        React.useLayoutEffect(()=>{syncLayout();return()=>{store.stop();disposeSidebar?.();disposeSidebar=null;};},[]);
        const s=useStore(),bot=s.layout?.bots.find(bot=>bot.id===s.selected),id=bot?.id;
        const [dialog,setDialog]=React.useState(null),headMenu=useMenu(),logRef=React.useRef(null),scrollAnchor=React.useRef(null),inputRef=React.useRef(null),fileRef=React.useRef(null),[dropping,setDropping]=React.useState(false),[prefs,savePrefs]=usePrefs();
        const panelRef=React.useRef(null),configButtonRef=React.useRef(null),[compactDetails,setCompactDetails]=React.useState(false),[drawerOpen,setDrawerOpen]=React.useState(false);
        React.useLayoutEffect(()=>{const element=panelRef.current;if(!element)return;let lastCompact=null;const measure=()=>{const compact=element.getBoundingClientRect().width<880;if(lastCompact===compact)return;lastCompact=compact;const hadConfigFocus=element.querySelector('.grok-config')?.contains(document.activeElement);setCompactDetails(compact);if(hadConfigFocus)requestAnimationFrame(()=>{if(element.isConnected&&!element.querySelector('.grok-config'))configButtonRef.current?.focus();});};measure();if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();}window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);},[]);
        const showDetails=compactDetails?drawerOpen:prefs.showConfig!==false;
        const closeDetails=React.useCallback(()=>{if(compactDetails)setDrawerOpen(false);else savePrefs({showConfig:false});configButtonRef.current?.focus();},[compactDetails,savePrefs]);
        const log=s.logs[id]||{entries:[]},draft=s.drafts[id]||'',pending=s.pending[id];
        const outbox=[...(s.outbox[id]||[])].sort((a,b)=>a.at-b.at),hasFailed=outbox.some(item=>item.status==='failed');
        const pendingFiles=s.attachments[id]||[],uploading=pendingFiles.some(file=>file.status==='uploading'),readyFiles=pendingFiles.filter(file=>file.status==='ready'),canSend=!pending&&!uploading&&(!!draft.trim()||readyFiles.length>0);
        const visibleEntries=prefs.showSystem===false?log.entries.filter(entry=>entry.role!=='system'):log.entries;
        const dropFiles=event=>{event.preventDefault();setDropping(false);store.addFiles(event.dataTransfer?.files||[]);};
        const markDrop=event=>{const types=event.dataTransfer&&event.dataTransfer.types?[...event.dataTransfer.types]:[];if(types.includes('Files')){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';setDropping(true);}};
        React.useLayoutEffect(()=>{const el=inputRef.current;if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,240)+'px';},[draft,id]);
        React.useLayoutEffect(()=>{scrollAnchor.current=null;const element=logRef.current;if(element)element.scrollTop=log.scroll?.bottom?element.scrollHeight:log.scroll?.top??element.scrollHeight;},[id]);
        React.useLayoutEffect(()=>{const element=logRef.current;if(!element)return;const anchor=scrollAnchor.current;if(anchor?.id===id){if((log.olderVersion||0)>anchor.version){element.scrollTop=anchor.top+element.scrollHeight-anchor.height;scrollAnchor.current=null;}else if(!log.loadingOlder)scrollAnchor.current=null;}else if(!log.scroll||log.scroll.bottom)element.scrollTop=element.scrollHeight;},[log.entries,log.loadingOlder,outbox.length]);
        return h('section',{ref:panelRef,className:'grok-panel','data-grok-panel':true,'data-config-mode':compactDetails?'drawer':'side','data-split':showDetails?'true':undefined,'aria-label':'Grok bot 对话'},h('style',null,css+layoutStyles),
          h('header',{className:'grok-chat-heading'},h('div',{className:'grok-chat-title'},bot?h('div',{className:'grok-chat-heading-copy'},h('h1',null,bot.name),h('span',{className:'grok-status-pill','data-state':bot.state},label(bot.state)),bot.description&&h('p',null,bot.description)):h('h1',null,'Grok bot')),h('div',{className:'grok-chat-actions'},bot&&bot.isRunning&&h('button',{type:'button','data-interrupt':true,disabled:!!pending,onClick:()=>void store.mutate('/interrupt',{id})},pending==='/interrupt'?'中断中…':'中断'),h('button',{type:'button',ref:configButtonRef,className:'grok-icon','aria-controls':'grok-details','aria-expanded':showDetails,'aria-pressed':showDetails,title:showDetails?'隐藏配置栏':'显示配置栏','aria-label':showDetails?'隐藏配置栏':'显示配置栏',onClick:()=>{if(compactDetails)setDrawerOpen(!drawerOpen);else savePrefs({showConfig:!showDetails});}},h(Glyph,{name:'sliders',size:15})),bot&&h(React.Fragment,null,h('div',{className:'grok-menu-wrap'},h('button',{type:'button',className:'grok-icon',title:'更多','aria-label':'更多操作','aria-haspopup':'menu','aria-expanded':headMenu.open,ref:headMenu.trigger,disabled:!!pending,onClick:headMenu.toggle},h(Glyph,{name:'more',size:16})),headMenu.open&&h('div',{ref:headMenu.menu,className:'grok-menu',role:'menu',onClick:event=>event.stopPropagation()},h('button',{type:'button',role:'menuitem','aria-pressed':(s.layout.pinned||[]).includes(id),onClick:()=>{headMenu.close(true);void store.mutate('/pin',{id,pinned:!(s.layout.pinned||[]).includes(id)});}},(s.layout.pinned||[]).includes(id)?'取消置顶':'置顶'),h('button',{type:'button',role:'menuitem',onClick:()=>{headMenu.close(true);setDialog({kind:'rename',id,name:bot.name});}},'重命名'),h('button',{type:'button',role:'menuitem',onClick:()=>{headMenu.close(true);setDialog({kind:'move',id});}},'移入分组'),h('button',{type:'button',role:'menuitem','data-danger':true,disabled:bot.isRunning,onClick:()=>{headMenu.close(true);setDialog({kind:'delete',id,name:bot.name});}},'删除')))))),
          h('div',{className:'grok-shell'},h('div',{className:'grok-main'},!bot?h('div',{className:'grok-welcome'},h('h2',null,'Grok bot'),h('p',null,s.error||s.loading?'正在读取机器人列表，可在左侧刷新重试。':'从左侧选择一个机器人开始对话。'),h('div',{className:'grok-empty-actions'},h('button',{type:'button',disabled:s.loading,onClick:()=>void store.refresh()},s.loading?'刷新中…':'刷新列表'),h('a',{href:'https://grok.com/',target:'_blank',rel:'noopener noreferrer'},h('button',{type:'button','data-primary':true},'打开 Grok')))):h(React.Fragment,null,
            h('div',{ref:logRef,className:'grok-log','data-grok-log':true,role:'log','aria-label':bot.name+' 的对话记录',onScroll:event=>{const element=event.currentTarget;store.setScroll(id,{top:element.scrollTop,bottom:element.scrollHeight-element.scrollTop-element.clientHeight<48});}},
              log.cursor&&h('button',{type:'button',className:'grok-older',disabled:log.loadingOlder,onClick:()=>{const element=logRef.current;scrollAnchor.current={id,top:element.scrollTop,height:element.scrollHeight,version:log.olderVersion||0};void store.loadOlder();}},log.loadingOlder?'读取中…':'加载更早记录'),
              log.error&&h('div',{className:'grok-error',role:'alert'},log.error),
              !visibleEntries.length&&!outbox.length&&h('div',{className:'grok-empty'},log.loading?'正在读取对话…':'暂无对话记录'),
              (()=>{const answeredFps=new Set();const widgetMeta=visibleEntries.map((entry,index)=>{const widget=extractWidget(entry);if(!widget)return null;const fp=widgetFingerprint(widget);const later=[];for(let j=index+1;j<visibleEntries.length;j++){if(visibleEntries[j].role==='user')later.push(visibleEntries[j].text||'');}for(const item of outbox)later.push(item.text||'');const answered=later.length>0;let pickedValue='';if(answered){for(const text of later){const hit=matchWidgetPick(text,widget);if(hit){pickedValue=hit;break;}}}const suppress=answeredFps.has(fp);if(answered)answeredFps.add(fp);return{fp,answered,pickedValue,suppress};});let latestInteractive=-1;for(let i=0;i<widgetMeta.length;i++){const meta=widgetMeta[i];if(meta&&!meta.answered&&!meta.suppress)latestInteractive=i;}return visibleEntries.flatMap((entry,index)=>{if(isQuietEntry(entry))return[];const meta=widgetMeta[index];if(meta&&meta.suppress)return[];const tagged=parseTagged(entry.text);const attachLike=mediaKindOf(entry.kind)||mediaKindOf(tagged&&tagged.tag);const role=entry.role==='system'&&attachLike?'user':entry.role;const who=role==='user'?'你':role==='bot'?bot.name:(attachLike?'附件':entry.kind);const interactive=!!(meta&&!meta.answered&&!meta.suppress&&index===latestInteractive);return[h('article',{key:entry.version??index,className:'grok-entry','data-role':role,'data-kind':entry.kind||undefined},h('div',{className:'grok-entry-meta'},who,h('time',null,time(entry.at))),h('div',{className:'grok-entry-body'},h(EntryBody,{entry,onPick:interactive?(value=>void store.sendText(value)):undefined,busy:!!pending,answered:!!(meta&&meta.answered),pickedValue:meta?meta.pickedValue:''})))];});})(),
              outbox.map(item=>h('article',{key:'local:'+item.nonce,className:'grok-entry','data-role':'user','data-local':item.status},h('div',{className:'grok-entry-meta'},'你',h('time',null,time(item.at)),item.status==='sending'&&h('span',{className:'grok-local-state'},'发送中…'),item.status==='failed'&&h('span',{className:'grok-local-state','data-failed':true,role:'alert'},'发送失败'),item.status==='failed'&&h('button',{type:'button',className:'grok-local-action',disabled:!!pending,onClick:()=>void store.retry(id,item.nonce)},'重试'),item.status==='failed'&&h('button',{type:'button',className:'grok-local-action',title:'删除这条消息；输入框为空时把内容放回输入框',onClick:event=>{const input=event.currentTarget.closest('.grok-panel')?.querySelector('.grok-composer textarea');store.discard(id,item.nonce);requestAnimationFrame(()=>{if(input?.isConnected){input.focus();const end=input.value.length;input.setSelectionRange(end,end);}});}},'删除')),h('div',{className:'grok-entry-body'},item.text,item.attachments?.length?h('div',{className:'grok-media-list'},item.attachments.map((file,index)=>h(MediaCard,{key:index,data:file,kind:isImageName(file.name,file.mime)?'image':'attachment'}))):null)))),
            h('form',{className:'grok-composer',onSubmit:event=>{event.preventDefault();void store.send();}},h('div',{className:'grok-composer-box','data-drop':dropping||undefined,onDragEnter:markDrop,onDragOver:markDrop,onDragLeave:event=>{if(!event.currentTarget.contains(event.relatedTarget))setDropping(false);},onDrop:dropFiles},pendingFiles.length?h('div',{className:'grok-chips',role:'list'},pendingFiles.map(file=>h('div',{key:file.id,className:'grok-chip',role:'listitem','data-status':file.status},file.preview?h('img',{src:file.preview,alt:'',className:'grok-chip-thumb'}):h('span',{className:'grok-chip-icon','aria-hidden':true},h(Glyph,{name:isImageName(file.name,file.mime)?'image':'file',size:14})),h('span',{className:'grok-chip-copy'},h('strong',null,file.name),h('small',null,file.status==='uploading'?'上传中 '+Math.round((file.progress||0)*100)+'%':file.status==='error'?(file.error||'上传失败'):formatSize(file.size))),file.status==='error'&&file.file&&h('button',{type:'button',onClick:()=>store.retryAttachment(id,file.id)},'重试'),h('button',{type:'button','aria-label':'移除 '+file.name,disabled:file.status==='uploading',onClick:()=>store.removeAttachment(id,file.id)},h(Glyph,{name:'close',size:12})),file.status==='uploading'&&h('span',{className:'grok-chip-bar','aria-hidden':true},h('i',{style:{width:Math.round((file.progress||0)*100)+'%'}}))))):null,h('textarea',{ref:inputRef,rows:2,'aria-label':'给 Grok 机器人的消息',placeholder:'发送消息给 '+bot.name+'…',value:draft,onChange:event=>store.setDraft(id,event.target.value),onPaste:event=>{const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();store.addFiles(files);}},onKeyDown:event=>{if(event.key!=='Enter'||event.nativeEvent.isComposing)return;if(event.metaKey||event.ctrlKey){event.preventDefault();const start=event.target.selectionStart??draft.length,end=event.target.selectionEnd??start;store.setDraft(id,draft.slice(0,start)+'\n'+draft.slice(end));requestAnimationFrame(()=>{const input=inputRef.current;if(input){const pos=start+1;input.focus();input.setSelectionRange(pos,pos);}});}else if(!event.shiftKey){event.preventDefault();void store.send();}}}),h('div',{className:'grok-composer-tools'},h('input',{ref:fileRef,type:'file',multiple:true,hidden:true,accept:ACCEPT_ATTR,onChange:event=>{store.addFiles(event.target.files||[]);event.target.value='';}}),h('button',{type:'button',className:'grok-icon grok-attach',disabled:!!pending,'aria-label':'添加附件',title:'添加附件，可拖拽或粘贴',onClick:()=>fileRef.current?.click()},h(Glyph,{name:'clip',size:16})),h('span',{className:'grok-spacer'}),h('button',{type:'submit','data-primary':true,disabled:!canSend},pending==='/send'?'发送中…':uploading?'上传中…':'发送'))),h('div',{className:'grok-composer-bottom'},h('span',{role:'status','data-failed':hasFailed&&!pending&&!!s.notices[id]},pending==='/send'?'发送中…':s.notices[id]||'Enter 发送 · Ctrl / ⌘ + Enter 换行 · 可拖拽或粘贴附件'))))),showDetails&&h(ConfigPane,{bot,s,log:bot?log:null,prefs,save:savePrefs,store,onClose:closeDetails,compact:compactDetails})),
          dialog&&h(Dialog,{key:dialog.kind+dialog.id,value:dialog,onClose:()=>setDialog(null)}));
      }
      function syncLayout() {
        if(ctx.layout.panelInfo.getSnapshot().activePanelId===ID){
          if(sidebarAvailable&&!disposeSidebar)disposeSidebar=ctx.slots.register({name:'sidebar.workspaces',priority:-1010},Sidebar);
          store.start();
        }else{store.stop();disposeSidebar?.();disposeSidebar=null;}
      }
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:ID},Panel));
      ctx.slots.inject(SOURCE_TAB_SLOT,()=>ctx.slots.register({name:SOURCE_TAB_SLOT,id:ID,label:'Grok bot',order:20},props=>h(SourceTab,{...props,sourceId:ID,panelId:ID,label:'Grok bot',icon:({size=15})=>h(Glyph,{name:'bot',size})})));
      ctx.slots.inject('sidebar.workspaces',()=>{sidebarAvailable=true;syncLayout();return()=>{sidebarAvailable=false;disposeSidebar?.();disposeSidebar=null;};});
      ctx.effect(()=>{const off=ctx.layout.panelInfo.subscribe(syncLayout);syncLayout();return()=>{off();store.stop();disposeSidebar?.();disposeSidebar=null;};});
      ctx.effect(()=>{const refreshAuth=()=>{store.stop();syncLayout();};window.addEventListener('dsh-grok-auth-changed',refreshAuth);return()=>window.removeEventListener('dsh-grok-auth-changed',refreshAuth);});
      ctx.effect(()=>()=>{store.dispose();disposeSidebar?.();});
    }
    return {inject:['slots','layout'],apply,createGrokStore,mergeEntries,SettingsPanel:GrokSettingsPanel};
}
