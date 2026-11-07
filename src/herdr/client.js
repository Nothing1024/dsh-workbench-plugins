export function createHerdrClient(require, sources) {
    const React=require('react');
    const {createPortal}=require('react-dom');
    const {SOURCE_TAB_SLOT, SourceTab} = sources;
    const h=React.createElement;
    let onSettingsApplied=()=>{};
    const ID='herdr';
    const DEFAULT_FRAME_ORIGIN='http://127.0.0.1:50760';
    const HERDR_PREFS_KEY='dsh-herdr-live-prefs';
    const defaultHerdrPrefs={frameOrigin:DEFAULT_FRAME_ORIGIN,upstreamOrigin:'http://127.0.0.1:7317',parentOrigin:'http://127.0.0.1:50759',proxyPort:50760};
    function readHerdrPrefs(){
      try{return {...defaultHerdrPrefs,...JSON.parse(localStorage.getItem(HERDR_PREFS_KEY)||'{}')};}
      catch{return {...defaultHerdrPrefs};}
    }
    function writeHerdrPrefs(patch){
      const next={...readHerdrPrefs(),...patch};
      const port=Number(next.proxyPort);
      next.proxyPort=Number.isInteger(port)&&port>0&&port<=65535?port:defaultHerdrPrefs.proxyPort;
      if(!next.frameOrigin)next.frameOrigin=`http://127.0.0.1:${next.proxyPort}`;
      try{localStorage.setItem(HERDR_PREFS_KEY,JSON.stringify(next));}catch{}
      window.dispatchEvent(new CustomEvent('dsh-herdr-live-prefs',{detail:next}));
      return next;
    }
    function getFrameOrigin(){return readHerdrPrefs().frameOrigin||DEFAULT_FRAME_ORIGIN;}
    function getBaseFrameUrl(){return getFrameOrigin()+'/?view=terminal&sidebar=hidden';}
    function getApi(){return getFrameOrigin()+'/__dsh_herdr';}
    function isLoopbackOrigin(value){
      try{
        const url=new URL(value);
        return url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;
      }catch{return false;}
    }
    const settingsStyles=`
      .dsh-plugin-settings{display:flex;flex-direction:column;gap:16px;max-width:640px;font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
      .dsh-plugin-settings h2{margin:0;font:var(--dsw-font-sm-strong-14,600 14px/20px var(--dsw-font-family))}
      .dsh-plugin-settings .lead{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}
      .dsh-plugin-settings fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;margin:0;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1)}
      .dsh-plugin-settings legend{padding:0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .dsh-plugin-settings label.field{display:flex;flex-direction:column;gap:6px;font-size:13px}
      .dsh-plugin-settings label.field input[type=text],.dsh-plugin-settings label.field input[type=number]{height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;padding:0 10px;font:inherit}
      .dsh-plugin-settings .hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin:0}
      .dsh-plugin-settings .row{display:flex;flex-wrap:wrap;gap:8px}
      .dsh-plugin-settings button{appearance:none;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer;font:inherit}
      .dsh-plugin-settings button[data-primary]{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent}
      .dsh-plugin-settings button:disabled{opacity:.5;cursor:default}
      .dsh-plugin-settings .status{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.45}
      .dsh-plugin-settings .dot{width:8px;height:8px;border-radius:50%;background:var(--h-faint,var(--dsw-alias-label-tertiary));flex:none;margin-top:4px}
      .dsh-plugin-settings .dot[data-ok=true]{background:var(--dsw-alias-state-success-primary,#5b9f83)}
      .dsh-plugin-settings .dot[data-ok=false]{background:var(--dsw-alias-state-error-primary,#c45c5c)}
      .dsh-plugin-settings-shade{position:fixed;inset:0;z-index:80;background:#0006;display:grid;place-items:center;padding:24px}
      .dsh-plugin-settings-dialog{width:min(560px,100%);max-height:min(88vh,720px);overflow:auto;border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 16px 48px #0004;padding:18px 18px 16px;position:relative}
      .dsh-plugin-settings-dialog .dsh-plugin-settings-close{position:absolute;top:12px;right:12px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
    `;
    async function herdrConfigRequest(path, options={}){
      const origin=getFrameOrigin();
      const response=await fetch(origin+'/__dsh_herdr/'+path,{
        method:options.method||'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000),
        ...(options.body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(options.body)}),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error?.message||data?.error||('请求失败（'+response.status+'）'));
      return data;
    }
    function HerdrSettingsPanel({onApplied}={}){
      const stored=readHerdrPrefs();
      const pageOrigin=(typeof location!=='undefined'&&isLoopbackOrigin(location.origin))?location.origin:stored.parentOrigin;
      const [form,setForm]=React.useState({
        upstreamOrigin:stored.upstreamOrigin,
        parentOrigin:stored.parentOrigin||pageOrigin,
        proxyPort:stored.proxyPort,
      });
      const [busy,setBusy]=React.useState('');
      const [status,setStatus]=React.useState({ok:null,text:'尚未检测连接。'});
      const update=patch=>setForm(prev=>({...prev,...patch}));
      const derivedFrame=`http://127.0.0.1:${Number(form.proxyPort)||50760}`;
      async function run(kind, work){
        setBusy(kind);
        try{
          const result=await work();
          setStatus({ok:result.ok!==false,text:result.text||result.message||'完成'});
          return result;
        }catch(error){
          setStatus({ok:false,text:error.message});
        }finally{setBusy('');}
      }
      return h('div',{className:'dsh-plugin-settings','data-plugin-settings':'herdr-live'},
        h('style',null,settingsStyles),
        h('header',null,h('h2',null,'Herdr'),h('p',{className:'lead'},'配置本机 Ovis / Herdr 的接入地址。修改接入 URL 通常立即生效；更改代理端口需要重启 DSH。')),
        h('fieldset',null,
          h('legend',null,'接入'),
          h('label',{className:'field'},'Ovis / Herdr 地址',
            h('input',{type:'text',value:form.upstreamOrigin,placeholder:'http://127.0.0.1:7317',onChange:event=>update({upstreamOrigin:event.target.value.trim()})}),
          ),
          h('label',{className:'field'},'本地代理端口',
            h('input',{type:'number',value:form.proxyPort,min:1,max:65535,onChange:event=>update({proxyPort:event.target.value})}),
          ),
          h('label',{className:'field'},'DSH 父页面来源',
            h('input',{type:'text',value:form.parentOrigin,placeholder:pageOrigin,onChange:event=>update({parentOrigin:event.target.value.trim()})}),
          ),
          h('p',{className:'hint'},'父页面一般应与当前 DSH 窗口同源（现在是 '+pageOrigin+'）。代理地址将是 '+derivedFrame+'。只接受本机 HTTP 回环地址。'),
        ),
        h('div',{className:'row'},
          h('button',{type:'button',disabled:!!busy,onClick:()=>void run('test',async()=>{
            const health=await herdrConfigRequest('health');
            const ok=!!health.ok;
            return {ok,text:ok?('已连通 Ovis（HTTP '+(health.upstream?.status??'')+'）'):(health.upstream?.error||'无法连接 Ovis / Herdr')};
          })},busy==='test'?'检测中…':'测试连接'),
          h('button',{type:'button','data-primary':true,disabled:!!busy,onClick:()=>void run('apply',async()=>{
            if(!isLoopbackOrigin(form.upstreamOrigin))throw new Error('Ovis / Herdr 地址必须是本机 HTTP 回环，例如 http://127.0.0.1:7317');
            if(!isLoopbackOrigin(form.parentOrigin))throw new Error('DSH 父页面来源必须是本机 HTTP 回环');
            const proxyPort=Number(form.proxyPort);
            if(!Number.isInteger(proxyPort)||proxyPort<=0||proxyPort>65535)throw new Error('代理端口无效');
            const frameOrigin=`http://127.0.0.1:${proxyPort}`;
            const saved=writeHerdrPrefs({upstreamOrigin:form.upstreamOrigin,parentOrigin:form.parentOrigin,proxyPort,frameOrigin});
            let remote={};
            try{remote=await herdrConfigRequest('config',{method:'POST',body:saved});}
            catch(error){remote={ok:false,message:'已保存在本机，但当前代理未响应：'+error.message,restartRequired:true};}
            onApplied?.(saved);
            return {ok:remote.ok!==false,text:remote.message||(remote.restartRequired?'已保存。代理端口变更需重启 DSH 后生效。':'已应用接入地址。')};
          })},busy==='apply'?'应用中…':'保存并应用'),
          h('button',{type:'button',disabled:!!busy,onClick:()=>void run('reload',async()=>{
            onApplied?.(readHerdrPrefs());
            return {ok:true,text:'已请求重新连接。'};
          })},'重新连接'),
        ),
        h('div',{className:'status'},h('span',{className:'dot','data-ok':status.ok===null?undefined:String(status.ok),'aria-hidden':true}),h('span',null,status.text)),
      );
    }
    function HerdrSettingsOverlay({onClose,onApplied}){
      React.useEffect(()=>{
        const key=event=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
        window.addEventListener('keydown',key);
        return()=>window.removeEventListener('keydown',key);
      },[onClose]);
      return createPortal(h('div',{className:'dsh-plugin-settings-shade',onMouseDown:event=>{if(event.target===event.currentTarget)onClose();}},
        h('div',{className:'dsh-plugin-settings-dialog',role:'dialog','aria-modal':true,'aria-label':'Herdr 插件设置'},
          h('button',{type:'button',className:'dsh-plugin-settings-close','aria-label':'关闭设置',onClick:onClose},'×'),
          h(HerdrSettingsPanel,{onApplied}),
        )),document.body);
    }

    const styles=`
      .herdr-native,.herdr-native-menu,.herdr-native-dialog,.herdr-live-panel{
        --h-ink:var(--dsw-alias-label-primary);--h-muted:var(--dsw-alias-label-secondary);--h-faint:var(--dsw-alias-label-tertiary);
        --h-line:var(--dsw-alias-border-l1);--h-field-line:var(--dsw-alias-border-l2);--h-hover:var(--dsw-alias-interactive-bg-hover);
        --h-active:var(--dsw-specific-sidebar-nav-item-active-accent);--h-accent:var(--dsw-alias-state-business-primary);--h-danger:var(--dsw-alias-state-error-primary);
        font-family:var(--dsw-font-family);color:var(--h-ink);box-sizing:border-box;
      }
      .workbench-sidebar-seat{flex:0 0 auto;min-width:0;box-sizing:border-box;margin:0 2px 8px;pointer-events:auto}.workbench-sidebar-seat[data-compact=true]{margin:8px 0 4px}
      .workbench-source-bar{display:flex;align-items:center;min-height:36px;min-width:0;width:100%;font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);-webkit-app-region:no-drag}
      .workbench-source-tabs{display:flex;align-items:center;gap:3px;width:100%;max-width:100%;box-sizing:border-box;overflow:auto;scrollbar-width:none;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
      .workbench-source-tab{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;min-width:0;padding:0 6px;flex:1 1 0;font-size:12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}.workbench-source-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .workbench-source-bar[data-compact=true]{width:36px}.workbench-source-bar[data-compact=true] .workbench-source-tabs{flex-direction:column;gap:4px;background:transparent;box-shadow:none;overflow:visible}.workbench-source-bar[data-compact=true] .workbench-source-tab{flex:none;width:30px;min-height:32px;padding:0}.workbench-source-bar[data-compact=true] .workbench-source-label{display:none}
      .workbench-source-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.workbench-source-tab[aria-selected=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px #00000012,inset 0 0 0 1px var(--dsw-alias-border-l1);font-weight:500}
      .workbench-source-tab[aria-selected=true] svg{color:var(--dsw-alias-state-business-primary)}.workbench-source-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
      .herdr-live-panel{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
      .herdr-live-frame{display:block;flex:1 1 0;min-width:0;min-height:0;width:100%;border:0;background:var(--dsw-alias-bg-base)}
      .herdr-native{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding-right:var(--dsh-sidebar-inline-padding,12px);font:var(--dsw-font-xs-13);font-size:14px}
      .herdr-native button,.herdr-native input{font:inherit;color:inherit}.herdr-native button{appearance:none;cursor:pointer;border:0;background:transparent}
      .herdr-native button:disabled,.herdr-native-dialog button:disabled{opacity:.45;cursor:default}
      .herdr-native-head{display:flex;align-items:center;gap:4px;padding:0 0 0 4px;height:36px;min-height:36px;margin-bottom:4px;flex:none;overflow:hidden}.herdr-native-head strong{font:var(--dsw-font-xs-strong-13);flex:0 0 auto;min-width:0;max-width:45%;color:var(--h-faint);line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;transition:max-width .18s,opacity .12s,margin-right .18s,visibility 0s linear}.herdr-native-head strong.herdr-native-label-hidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;pointer-events:none}.herdr-native-search-slot{box-sizing:border-box;min-width:0;max-width:28px;flex:1 1 0%;align-items:center;margin-left:auto;display:flex;transition:max-width .18s}.herdr-native-search-slot-expanded{max-width:100%}.herdr-native-header-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;max-width:156px;overflow:hidden;transition:max-width .18s,opacity .12s,visibility 0s linear}.herdr-native-header-actions-hidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0}
      .herdr-native-icon{text-decoration:none;box-sizing:border-box;width:28px;height:28px;padding:0;display:grid;place-items:center;border-radius:var(--dsw-radius-sm,8px);color:var(--h-muted)!important;flex:none;transition:background .12s,color .12s}
      .herdr-native-icon:hover:not(:disabled){background:var(--h-hover);color:var(--h-ink)!important}
      .herdr-native-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 4px 8px;min-height:18px;font:var(--dsw-font-xxs-12);font-size:11px;line-height:16px;color:var(--h-faint);font-variant-numeric:tabular-nums;letter-spacing:.01em}
      .herdr-native-source{display:inline-flex;align-items:center;gap:5px;min-width:0;color:var(--h-muted)}.herdr-native-source-dot{width:6px;height:6px;border-radius:50%;background:var(--h-faint);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-faint) 18%,transparent);flex:none}.herdr-native-source[data-state=connected]{color:var(--h-muted)}.herdr-native-source[data-state=connected] .herdr-native-source-dot{background:var(--dsw-alias-state-success-primary,#5b9f83);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary,#5b9f83) 20%,transparent)}.herdr-native-source[data-state=loading] .herdr-native-source-dot{background:var(--dsw-alias-state-warning-primary,#bc9455);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warning-primary,#bc9455) 20%,transparent)}.herdr-native-source[data-state=offline] .herdr-native-source-dot,.herdr-native-source[data-state=error] .herdr-native-source-dot{background:var(--h-danger);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-danger) 18%,transparent)}.herdr-native-counts{display:inline-flex;align-items:center;gap:0;flex:none;white-space:nowrap;color:var(--h-faint)}.herdr-native-count{font-variant-numeric:tabular-nums}.herdr-native-sep{margin:0 5px;opacity:.55;font-weight:400}
      .herdr-native-search{box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);cursor:text;width:100%;height:28px;color:var(--h-muted);background:transparent;border:0;display:flex;align-items:center;gap:0;margin:0;padding:0;overflow:hidden;transition:width .18s,padding .18s,border-color .18s}.herdr-native-search-expanded{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);width:calc(100% + 4px);height:30px;color:var(--h-faint);margin-inline:-2px;padding:0 4px 0 0}.herdr-native-search-btn{border-radius:var(--dsw-radius-sm,8px);cursor:pointer;width:28px;height:28px;color:inherit;background:transparent;border:0;flex:none;display:inline-flex;justify-content:center;align-items:center;padding:0}.herdr-native-search-expanded .herdr-native-search-btn{width:28px;height:30px}.herdr-native-search-btn:hover{background:var(--h-hover)}.herdr-native-search-expanded .herdr-native-search-btn:hover{background:transparent}.herdr-native-search-input{opacity:0;pointer-events:none;width:0;min-width:0;flex:1 1 0%;color:var(--h-ink);background:transparent;border:0;outline:none!important;font:inherit;font-size:13px;line-height:18px;padding:0;transition:opacity .12s}.herdr-native-search-expanded .herdr-native-search-input{opacity:1;pointer-events:auto;margin-left:-2px}.herdr-native-search-input::placeholder,.herdr-native-dialog input::placeholder{color:var(--h-faint);opacity:.8}.herdr-native-search-clear{border-radius:var(--dsw-radius-sm,8px);cursor:pointer;width:24px;height:24px;color:var(--h-muted);background:transparent;border:0;flex:none;display:inline-flex;justify-content:center;align-items:center;padding:0}.herdr-native-search-clear:hover{background:var(--h-hover);color:var(--h-ink)}.herdr-native-dialog input:focus{border-color:var(--h-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-accent) 16%,transparent)}
      .herdr-native-error{margin:0 0 10px;padding:9px 10px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#bc9455) 9%,transparent);color:var(--dsw-alias-state-warning-primary,#bc9455);font-size:11px;line-height:17px;overflow-wrap:anywhere;display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.herdr-native-error button{flex:none;appearance:none;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:11px;padding:0}
      .herdr-native-tree{overflow:auto;min-height:0;flex:1;padding:0 0 16px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
      .herdr-native-project{margin:0}.herdr-native-project-head{position:relative;display:flex;align-items:center;gap:0;min-height:34px;height:34px;border-radius:var(--dsw-radius-md)}
      .herdr-native-project-head:hover{background:var(--h-hover)}.herdr-native-project-label{display:flex;align-items:center;gap:6px;flex:1;min-width:0;padding:0 8px;padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));height:100%;text-align:left;border-radius:var(--dsw-radius-md)}
      .herdr-native-slot{width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--h-faint);position:relative}
      .herdr-native-folder,.herdr-native-chevron{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px}
      .herdr-native-project-head .herdr-native-chevron{display:none}.herdr-native-project-head:hover .herdr-native-folder{display:none}.herdr-native-project-head:hover .herdr-native-chevron{display:inline-flex}
      .herdr-native-project[data-active=true] .herdr-native-slot{color:var(--h-accent)}
      .herdr-native-project-copy{display:flex;flex-direction:column;gap:0;flex:1;min-width:0}.herdr-native-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}.herdr-native-project-copy>.herdr-native-name{font-size:14px;font-weight:400;line-height:20px}
      .herdr-native-sessions{display:block;margin:0;padding:0}.herdr-native-session{appearance:none;display:flex;align-items:center;gap:0;width:100%;height:32px;min-height:32px;margin:0;padding:0 8px;padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--h-ink);text-align:left;cursor:pointer}
      .herdr-native-session:hover,.herdr-native-session[aria-current=true]{background:var(--h-hover)}
      .herdr-native-session+.herdr-native-session{margin-top:2px}
      .herdr-native-session[data-pending=true]{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--h-accent) 40%,transparent)}
      .herdr-native-session-title{flex:1;min-width:0;margin:0 6px 0 4px;font-size:14px;font-weight:400;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .herdr-native-path{display:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--h-faint);font-size:12px;line-height:17px;opacity:.85}.herdr-native-project[data-searching=true] .herdr-native-path{display:block}.herdr-native-project[data-searching=true] .herdr-native-project-head,.herdr-native-project[data-searching=true] .herdr-native-project-label{height:auto;min-height:48px}.herdr-native-project[data-searching=true] .herdr-native-project-label{padding-top:4px;padding-bottom:4px}
      .herdr-native-count{flex:none;min-width:16px;padding:0 4px;box-sizing:border-box;border-radius:4px;color:var(--h-faint);background:var(--dsw-alias-bg-layer-1);font-size:10px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
      .herdr-native-project-tools{display:flex;opacity:0;transition:opacity .12s}.herdr-native-project-head:hover .herdr-native-project-tools,.herdr-native-project-head:focus-within .herdr-native-project-tools{opacity:1}
      .herdr-native-project-tools .herdr-native-icon{width:24px;height:26px}
      .herdr-native-project[data-active=true] .herdr-native-project-head{background:transparent}
      .herdr-native-project-head:hover,.herdr-native-project-head:focus-within{background:var(--h-hover)}
      
      .herdr-native-project[data-pending=true] .herdr-native-project-head{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--h-accent) 40%,transparent)}
      .herdr-native-project-tools{padding-right:4px}.herdr-native-empty{padding:28px 10px;text-align:center;color:var(--h-faint);font-size:12px}.herdr-native-empty-actions{display:flex;justify-content:center;gap:8px;margin-top:12px;flex-wrap:wrap}.herdr-native-empty-actions button{appearance:none;border:1px solid var(--h-line);background:var(--dsw-alias-bg-layer-1);color:var(--h-ink);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}.herdr-native-empty-actions button[data-primary=true]{background:var(--h-accent);border-color:transparent;color:#fff}.herdr-native-status-dot{flex:none;width:7px;height:7px;margin-right:2px;border-radius:50%;background:var(--h-faint);box-shadow:0 0 0 2px color-mix(in srgb,var(--h-faint) 18%,transparent)}.herdr-native-status-dot[data-status=working]{background:var(--dsw-alias-state-success-primary,#5b9f83);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary,#5b9f83) 22%,transparent)}.herdr-native-status-dot[data-status=waiting]{background:var(--dsw-alias-state-warning-primary,#bc9455)}.herdr-native-status-dot[data-status=blocked],.herdr-native-status-dot[data-status=error]{background:var(--h-danger)}.herdr-native-status-dot[data-status=done]{background:var(--h-accent)}.herdr-native-status-dot[data-status=idle],.herdr-native-status-dot[data-status=none],.herdr-native-status-dot[data-status=unknown]{display:none}.herdr-live-panel{position:relative;display:flex;flex-direction:column;min-height:0;height:100%}.herdr-live-overlay{position:absolute;inset:0;z-index:2;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 78%,transparent);backdrop-filter:blur(1.5px);text-align:center;color:var(--h-muted)}.herdr-live-overlay strong{display:block;font-size:14px;color:var(--h-ink);margin-bottom:6px}.herdr-live-overlay p{margin:0 0 14px;font-size:12px;max-width:280px}.herdr-live-overlay button{appearance:none;border:1px solid var(--h-line);background:var(--dsw-alias-bg-layer-1);color:var(--h-ink);border-radius:8px;padding:7px 14px;font:inherit;font-size:12px;cursor:pointer}.herdr-live-overlay button[data-primary=true]{background:var(--h-accent);border-color:transparent;color:#fff}
      .herdr-native-menu{position:fixed;z-index:10020;min-width:170px;padding:5px;border:0;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);font:var(--dsw-font-xs-13)}
      .herdr-native-menu button{appearance:none;font:inherit;color:var(--h-muted);cursor:pointer;border:0;background:transparent;display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:8px 9px;border-radius:7px}.herdr-native-menu button:hover{background:var(--h-hover);color:var(--h-ink)}.herdr-native-menu button svg{opacity:.8}.herdr-native-menu button[data-danger=true]{color:var(--h-danger)}.herdr-native-menu button[data-danger=true]:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
      .herdr-native-shade{position:fixed;inset:0;z-index:10030;background:var(--dsw-alias-bg-mask-1);backdrop-filter:blur(3px);display:grid;place-items:center}
      .herdr-native-dialog{width:min(400px,calc(100vw - 40px));padding:24px;box-sizing:border-box;border:1px solid var(--h-line);border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent);font:var(--dsw-font-xs-13)}
      .herdr-native-dialog-heading{display:flex;align-items:flex-start;gap:11px;margin-bottom:20px}.herdr-native-dialog-symbol{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:10px;color:var(--h-accent);background:color-mix(in srgb,var(--h-accent) 10%,transparent)}.herdr-native-dialog-symbol[data-danger=true]{color:var(--h-danger);background:color-mix(in srgb,var(--h-danger) 10%,transparent)}
      .herdr-native-dialog-copy{flex:1;min-width:0}.herdr-native-dialog h2{font-family:var(--dsw-font-family);font-size:15px;line-height:22px;font-weight:600;margin:0}.herdr-native-dialog .herdr-native-dialog-description{font-size:11px;line-height:17px;color:var(--h-faint);margin:3px 0 0}.herdr-native-dialog .herdr-native-dialog-close{appearance:none;width:24px;height:24px;display:grid;place-items:center;padding:0;flex:none;border:0;border-radius:6px;background:transparent;cursor:pointer;color:var(--h-faint)}.herdr-native-dialog-close:hover{background:var(--h-hover)}
      .herdr-native-dialog label{display:block;margin:14px 0 0;font-size:12px;font-weight:500;line-height:18px}.herdr-native-dialog input{appearance:none;font:var(--dsw-font-xs-13);font-weight:400;color:var(--h-ink);display:block;box-sizing:border-box;width:100%;height:36px;padding:0 11px;margin-top:6px;border:1px solid var(--h-field-line);border-radius:8px;background:var(--dsw-specific-input-major);outline:none!important;transition:border-color .12s,box-shadow .12s}
      .herdr-native-dialog p{font-size:12px;line-height:20px;color:var(--h-muted);margin:0}.herdr-native-dialog .herdr-native-error{margin:12px 0 0}
      .herdr-native-dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:24px}.herdr-native-dialog-actions button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;font:var(--dsw-font-xxs-12);font-weight:500;cursor:pointer;border:1px solid var(--h-field-line);border-radius:8px;padding:0 14px;background:transparent;color:var(--h-muted)}.herdr-native-dialog-actions button:hover:not(:disabled){background:var(--h-hover)}
      .herdr-native-dialog-actions button[data-primary=true]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.herdr-native-dialog-actions button[data-primary=true]:hover:not(:disabled){opacity:.86}.herdr-native-dialog-actions button[data-danger=true]{color:var(--h-danger);background:color-mix(in srgb,var(--h-danger) 10%,transparent);border-color:color-mix(in srgb,var(--h-danger) 20%,transparent)}
      .herdr-native button:focus-visible,.herdr-native a:focus-visible,.herdr-native-menu button:focus-visible,.herdr-native-dialog button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--h-accent));outline-offset:2px}
      @media(hover:none){.herdr-native-project-tools{opacity:1}}
      @media(prefers-reduced-motion:reduce){.herdr-native *,.workbench-source-tab{transition:none!important}}
    `;
    function Icon({size=18}) {
      return h('svg',{width:size,height:size,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,'data-herdr-icon':true},h('rect',{x:2.5,y:4,width:15,height:12,rx:2.5}),h('path',{d:'M2.5 7.5h15M6 10l2 2-2 2m4 0h3'}));
    }
    function Glyph({name,size=16,className=''}) {
      const paths={
        terminal:['m5 7 5 5-5 5','M13 17h6'],
        folder:['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
        plus:['M12 5v14','M5 12h14'],
        more:['M5 12h.01','M12 12h.01','M19 12h.01'],
        search:['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z','m17 17 4 4'],
        refresh:['M20 7v5h-5','M4 17v-5h5','M6.1 7a7 7 0 0 1 11.5-2.6L20 7','M4 17l2.4 2.6A7 7 0 0 0 17.9 17'],
        external:['M15 3h6v6','m10 14 11-11','M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
        back:['m12 5-7 7 7 7','M5 12h14'],
        edit:['m16 3 5 5','M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16Z'],
        trash:['M3 6h18','M8 6V4h8v2','M5 6l1 14h12l1-14','M10 10v6','M14 10v6'],
        close:['m6 6 12 12','M6 18 18 6'],
        sliders:['M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M1 14h6','M9 8h6','M17 16h6'],
        computer:['M4 4h16v12H4Z','M8 20h8','M12 16v4'],
        chat:['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z'],
        chevron:['m9 5 7 7-7 7'],
      };
      return h('svg',{className,width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:name==='more'?2.5:1.65,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},...(paths[name]||paths.terminal).map((d,index)=>h('path',{key:index,d})));
    }
    const statusLabel=s=>({working:'运行中',waiting:'等待输入',blocked:'待确认',done:'已完成',idle:'空闲',none:'',unknown:'',error:'异常'}[s]??s??'');
    const paneTitle=(pane,index)=>pane?.label||pane?.title||pane?.name||(String(pane?.cwd||'').split('/').filter(Boolean).pop())||('终端 '+(index+1));
    const liveStatus=s=>{const value=s||'none';return ['idle','none','unknown',''].includes(value)?'':statusLabel(value);};
    function apply(ctx) {
      let state={snapshot:{workspaces:[],tabs:[],panes:[]},connection:'loading',error:null,selection:null,pending:null};
      const listeners=new Set();
      const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
      const getSnapshot=()=>state;
      const publish=patch=>{state={...state,...patch};for(const listener of listeners)listener();};
      const useStore=()=>React.useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
      let frame=null,frameLoads=0,frameReady=false,mounted=0,source=null,disposeSidebar=null,sidebarAvailable=false,active=false,disposed=false,sequence=0;
      let lastLifetime=null,pendingTimer=null,lastSentRequestId=null,dataEpoch=0,loadSequence=0,streamRevision=0,pendingCreatedPane=null;
      const readControllers=new Set();
      const lastViewedWorkspace=new Map();
      const parseSelection=selection=>{
        if(!selection||selection.machine&&selection.machine!=='local')return null;
        const pane=state.snapshot.panes.find(p=>p.pane_id===selection.pane&&p.workspace_id===selection.workspace);
        return pane?{machine:'local',workspace:pane.workspace_id,pane:pane.pane_id,view:selection.view==='chat'?'chat':'terminal'}:null;
      };
      const sendHello=()=>frame?.contentWindow?.postMessage({type:'dsh-herdr/hello',version:1},getFrameOrigin());
      const sendPending=()=>{
        if(!frameReady||!frame?.contentWindow||!state.pending||lastSentRequestId===state.pending.requestId)return;
        lastSentRequestId=state.pending.requestId;
        frame.contentWindow.postMessage({type:'dsh-herdr/select',version:1,requestId:state.pending.requestId,selection:state.pending.selection},getFrameOrigin());
      };
      const choosePane=(id,view='terminal')=>{
        pendingCreatedPane=null;
        const pane=state.snapshot.panes.find(p=>p.pane_id===id);
        if(!pane)return;
        const requestId='dsh-'+(++sequence);
        clearTimeout(pendingTimer);
        publish({pending:{requestId,selection:{machine:'local',workspace:pane.workspace_id,pane:pane.pane_id,tab:pane.tab_id,view:view==='chat'?'chat':'terminal'}},error:null});
        pendingTimer=setTimeout(()=>{if(state.pending?.requestId===requestId)publish({pending:null,error:'终端尚未完成切换，请重试。'});},12000);
        if(ctx.layout.panelInfo.getSnapshot().activePanelId!==ID)ctx.layout.selectPanel(ID);
        sendPending();
      };
      function chooseWorkspace(workspaceId) {
        const workspace=state.snapshot.workspaces.find(w=>w.workspace_id===workspaceId);
        if(!workspace)return;
        const panes=state.snapshot.panes.filter(p=>p.workspace_id===workspaceId);
        const remembered=state.selection?.workspace===workspaceId?state.selection:lastViewedWorkspace.get(workspaceId);
        const layoutFocus=Array.isArray(state.snapshot.layouts)?state.snapshot.layouts.find(layout=>layout.tab_id===workspace.active_tab_id)?.focused_pane_id:undefined;
        const pane=panes.find(p=>p.pane_id===remembered?.pane)||panes.find(p=>p.pane_id===layoutFocus)||panes.find(p=>p.tab_id===workspace.active_tab_id&&p.focused)||panes.find(p=>p.tab_id===workspace.active_tab_id)||panes[0];
        if(pane)choosePane(pane.pane_id,pane.pane_id===remembered?.pane?remembered.view:'terminal');
      }
      function followCreatedPane(paneId,epoch,intent) {
        if(!active||disposed||epoch!==dataEpoch||intent!==sequence)return;
        if(state.snapshot.panes.some(p=>p.pane_id===paneId)){choosePane(paneId);return;}
        pendingCreatedPane={paneId,epoch,intent,deadline:Date.now()+12000};
      }
      function reconcileCreatedPane() {
        const pending=pendingCreatedPane;
        if(!pending)return;
        if(!active||disposed||pending.epoch!==dataEpoch||pending.intent!==sequence||Date.now()>pending.deadline){pendingCreatedPane=null;return;}
        if(state.snapshot.panes.some(p=>p.pane_id===pending.paneId))choosePane(pending.paneId);
      }
      function acceptSnapshot(snapshot) {
        if(!snapshot||!Array.isArray(snapshot.workspaces)||!Array.isArray(snapshot.tabs)||!Array.isArray(snapshot.panes))return;
        const changedLifetime=Boolean(lastLifetime&&snapshot.herdr_lifetime&&lastLifetime!==snapshot.herdr_lifetime);
        lastLifetime=snapshot.herdr_lifetime??lastLifetime;
        if(changedLifetime){lastViewedWorkspace.clear();pendingCreatedPane=null;}
        for(const [workspace,remembered] of lastViewedWorkspace){if(!snapshot.panes.some(p=>p.workspace_id===workspace&&p.pane_id===remembered.pane))lastViewedWorkspace.delete(workspace);}
        const oldSelection=changedLifetime?null:state.selection;
        const oldPending=changedLifetime?null:state.pending;
        const selection=oldSelection&&snapshot.panes.some(p=>p.pane_id===oldSelection.pane&&p.workspace_id===oldSelection.workspace)?oldSelection:null;
        const pending=oldPending&&snapshot.panes.some(p=>p.pane_id===oldPending.selection.pane&&p.workspace_id===oldPending.selection.workspace)?oldPending:null;
        publish({snapshot,selection,pending,connection:'connected',error:null});
        if(frameReady)sendHello();
        reconcileCreatedPane();
      }
      async function load() {
        const epoch=dataEpoch,sequence=++loadSequence,streamAtStart=streamRevision;
        const controller=new AbortController();readControllers.add(controller);
        try{
          const response=await fetch(getApi()+'/session',{credentials:'omit',signal:controller.signal});
          const data=await response.json();
          if(epoch!==dataEpoch||disposed||!active)return null;
          if(!response.ok)throw new Error(data.message||data.error?.message||(typeof data.error==='string'?data.error:'无法读取终端列表'));
          if(sequence===loadSequence&&streamAtStart===streamRevision)acceptSnapshot(data.snapshot);
          return data.snapshot;
        }catch(error){if(epoch!==dataEpoch||controller.signal.aborted||sequence!==loadSequence||streamAtStart!==streamRevision)return null;throw error;}
        finally{readControllers.delete(controller);}
      }
      function startData() {
        if(source)return;
        const epoch=++dataEpoch;
        publish({connection:'loading',error:null});
        load().catch(error=>{if(active&&!disposed&&epoch===dataEpoch)publish({connection:'offline',error:error.message});});
        source=new EventSource(getApi()+'/events');
        const receive=event=>{if(!active||disposed||epoch!==dataEpoch)return;try{const data=JSON.parse(event.data);if(data.snapshot){streamRevision++;acceptSnapshot(data.snapshot);}}catch{}};
        source.onmessage=receive;
        source.addEventListener('snapshot',receive);
        source.addEventListener('connection',event=>{if(!active||disposed||epoch!==dataEpoch)return;try{const data=JSON.parse(event.data);if(data.state==='disconnected')publish({connection:'offline'});else if(data.state==='connecting')publish({connection:'loading'});}catch{}});
        source.onerror=()=>{if(active&&!disposed&&epoch===dataEpoch)publish({connection:'offline'});};
      }
      function stopData(){dataEpoch++;pendingCreatedPane=null;source?.close();source=null;for(const controller of readControllers)controller.abort();readControllers.clear();}
      async function action(body) {
        if(state.connection!=='connected')throw new Error('等待终端列表重新连接后再操作');
        const epoch=dataEpoch;
        const response=await fetch(getApi()+'/action',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json();
        if(!response.ok)throw new Error(data.message||data.error?.message||(typeof data.error==='string'?data.error:'操作未完成'));
        if(active&&!disposed&&epoch===dataEpoch){
          try{await load();}catch{if(active&&!disposed&&epoch===dataEpoch)publish({error:'操作已完成，列表刷新失败，可点击刷新列表重试。'});}
        }
        return data;
      }
      function message(event) {
        if(event.origin!==getFrameOrigin()||event.source!==frame?.contentWindow||!event.data||event.data.version!==1)return;
        const data=event.data;
        if(data.type==='dsh-herdr/ready'){frameReady=true;sendPending();return;}
        if(data.type==='dsh-herdr/cancelled'){if(state.pending?.requestId===data.requestId){clearTimeout(pendingTimer);lastSentRequestId=null;publish({pending:null});}return;}
        if(data.type==='dsh-herdr/selection'&&data.confirmed===true){
          if(data.selection?.machine&&data.selection.machine!=='local'){clearTimeout(pendingTimer);publish({selection:null,pending:null});return;}
          const selection=parseSelection(data.selection);
          if(!selection)return;
          // An older acknowledgement must not clear a newer click waiting to be applied.
          if(state.pending&&data.requestId&&data.requestId!==state.pending.requestId)return;
          const reached=!state.pending||(selection.pane===state.pending.selection.pane&&selection.workspace===state.pending.selection.workspace&&selection.view===state.pending.selection.view);
          if(reached)clearTimeout(pendingTimer);
          if(pendingCreatedPane&&state.selection&&selection.pane!==state.selection.pane&&selection.pane!==pendingCreatedPane.paneId)pendingCreatedPane=null;
          lastViewedWorkspace.set(selection.workspace,selection);
          publish({selection,pending:reached?null:state.pending});
        }
      }
      function Sidebar({wide}) {
        const current=useStore();
        const [query,setQuery]=React.useState('');
        const [searchOpen,setSearchOpen]=React.useState(false);
        const searchRef=React.useRef(null);
        const [menu,setMenu]=React.useState(null);
        const [form,setForm]=React.useState(null);
        const [settingsOpen,setSettingsOpen]=React.useState(false);
        const [busy,setBusy]=React.useState(false);
        const openHerdrSettings=()=>{if(!sources.openSettings?.(ctx))setSettingsOpen(true);};
        const [formError,setFormError]=React.useState('');
        const menuRef=React.useRef(null),formRef=React.useRef(null),formReturn=React.useRef(null);
        React.useEffect(()=>{if(searchOpen){const id=requestAnimationFrame(()=>searchRef.current&&searchRef.current.focus());return()=>cancelAnimationFrame(id);}},[searchOpen]);
        React.useEffect(()=>{if(!searchOpen&&!query)return;const onKey=event=>{if(event.key==='Escape'){setQuery('');setSearchOpen(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[searchOpen,query]);
        const closeMenu=restore=>{const trigger=menu?.trigger;setMenu(null);if(restore&&trigger?.isConnected)trigger.focus();};
        // Menu: focus first item, Esc/Tab close + return focus, outside mousedown closes, arrows move.
        React.useEffect(()=>{
          if(!menu)return;
          menuRef.current?.querySelector('[role=menuitem]')?.focus();
          const down=event=>{if(menuRef.current?.contains(event.target)||menu.trigger?.contains(event.target))return;setMenu(null);};
          const key=event=>{
            if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();setMenu(null);if(menu.trigger?.isConnected)menu.trigger.focus();return;}
            if(event.key==='ArrowDown'||event.key==='ArrowUp'){const items=[...(menuRef.current?.querySelectorAll('[role=menuitem]')||[])];if(!items.length)return;event.preventDefault();const i=items.indexOf(document.activeElement);items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}
          };
          const blur=()=>setMenu(null);// clicks inside the Ovis iframe never reach this document; window blur covers them
          document.addEventListener('mousedown',down,true);document.addEventListener('keydown',key,true);window.addEventListener('blur',blur);
          return()=>{document.removeEventListener('mousedown',down,true);document.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);};
        },[menu]);
        // Dialog: confirm dialogs focus 取消; on close focus returns to the element that opened it.
        React.useEffect(()=>{
          if(!form){const target=formReturn.current;formReturn.current=null;if(target?.isConnected)target.focus();return;}
          if(form.kind==='workspace-close')formRef.current?.querySelector('[data-herdr-cancel]')?.focus();
        },[!!form,form?.kind]);
        const dialogKeys=event=>{
          if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();setForm(null);return;}
          if(event.key==='Tab'&&formRef.current){const nodes=[...formRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
        };
        if(!wide)return null;
        const showForm=value=>{formReturn.current=menu?.trigger||document.activeElement;setMenu(null);setFormError('');setForm(value);};
        const defaultCwd=workspace=>current.snapshot.workspaces.find(w=>w.workspace_id===workspace)?.worktree?.checkout_path||current.snapshot.panes.find(p=>p.workspace_id===workspace)?.cwd||'';
        async function submit(event) {
          event.preventDefault();if(!form||busy)return;
          const epoch=dataEpoch,intent=sequence,isCurrent=()=>active&&!disposed&&epoch===dataEpoch;
          setBusy(true);setFormError('');
          try{
            let body;
            if(form.kind==='workspace-create')body={action:form.kind,label:form.value||undefined,cwd:form.cwd||undefined};
            else if(form.kind==='workspace-rename')body={action:form.kind,workspace_id:form.id,label:form.value};
            else body={action:'workspace-close',workspace_id:form.id};
            const result=await action(body);
            if(!isCurrent())return;
            setForm(null);
            if(result.pane_id)followCreatedPane(result.pane_id,epoch,intent);
            else if(!state.selection&&!state.pending&&state.snapshot.workspaces[0])chooseWorkspace(state.snapshot.workspaces[0].workspace_id);
          }catch(error){if(isCurrent())setFormError(error.message);}finally{if(isCurrent())setBusy(false);}
        }
        const needle=query.trim().toLocaleLowerCase();
        const projects=current.snapshot.workspaces.map(workspace=>{
          const cwd=defaultCwd(workspace.workspace_id);
          const panes=current.snapshot.panes.filter(p=>p.workspace_id===workspace.workspace_id);
          if(needle&&![workspace.label,cwd,workspace.worktree?.repo_name,...panes.flatMap(pane=>[pane.label,pane.title,pane.name,pane.cwd])].filter(Boolean).some(value=>String(value).toLocaleLowerCase().includes(needle)))return null;
          const selected=current.selection?.workspace===workspace.workspace_id;
          const pending=current.pending?.selection.workspace===workspace.workspace_id;
          const status=liveStatus(workspace.agent_status);
          const visiblePanes=needle?panes.filter(pane=>[pane.label,pane.title,pane.name,pane.cwd].filter(Boolean).some(value=>String(value).toLocaleLowerCase().includes(needle))):panes;
          return h('section',{key:workspace.workspace_id,className:'herdr-native-project',role:'listitem','data-herdr-native-workspace':workspace.workspace_id,'data-active':selected,'data-pending':pending,'data-searching':needle?'true':undefined},
            h('div',{className:'herdr-native-project-head','data-herdr-project-row':workspace.workspace_id},
              h('button',{className:'herdr-native-project-label','data-herdr-select-workspace':workspace.workspace_id,'aria-pressed':selected,title:[workspace.label,cwd,status].filter(Boolean).join('\n'),onClick:()=>chooseWorkspace(workspace.workspace_id)},
                h('span',{className:'herdr-native-slot','aria-hidden':true},h('span',{className:'herdr-native-folder'},h(Glyph,{name:'folder',size:16})),h('span',{className:'herdr-native-chevron'},h(Glyph,{name:'chevron',size:12}))),
                h('span',{className:'herdr-native-project-copy'},h('span',{className:'herdr-native-name'},workspace.label),cwd&&h('span',{className:'herdr-native-path'},cwd.split('/').filter(Boolean).slice(-2).join('/'))),
                status&&h('span',{className:'herdr-native-status-dot','data-status':workspace.agent_status,title:status,'aria-label':status})),
              h('span',{className:'herdr-native-project-tools'},h('button',{className:'herdr-native-icon','aria-label':workspace.label+' 的操作','aria-haspopup':'menu','data-herdr-workspace-menu':workspace.workspace_id,'aria-expanded':menu?.target.id===workspace.workspace_id,onClick:event=>{event.stopPropagation();if(menu?.target.id===workspace.workspace_id){closeMenu(false);return;}const trigger=event.currentTarget,rect=trigger.getBoundingClientRect();setMenu({target:{id:workspace.workspace_id,label:workspace.label},x:rect.left,y:rect.bottom+3,trigger});}},h(Glyph,{name:'more',size:15})))),
            h('div',{className:'herdr-native-sessions'},visiblePanes.map((pane,index)=>{const paneSelected=current.selection?.pane===pane.pane_id;const panePending=current.pending?.selection.pane===pane.pane_id;return h('button',{key:pane.pane_id,type:'button',className:'herdr-native-session','data-herdr-select-pane':pane.pane_id,'aria-current':paneSelected?'true':undefined,'data-pending':panePending||undefined,title:pane.cwd||paneTitle(pane,index),onClick:()=>choosePane(pane.pane_id)},h('span',{className:'herdr-native-slot','aria-hidden':true}),h('span',{className:'herdr-native-session-title'},paneTitle(pane,index)));})));
        });
        const closing=form?.kind==='workspace-close';
        const formTitle=closing?'关闭项目':form?.kind==='workspace-create'?'新建项目':'重命名项目';
        return h('div',{className:'herdr-native','data-herdr-native-sidebar':true},
          h('div',{className:'herdr-native-head','data-search-open':searchOpen||undefined},h('strong',{className:searchOpen?'herdr-native-label-hidden':undefined},'项目'),h('div',{className:'herdr-native-search-slot'+(searchOpen?' herdr-native-search-slot-expanded':'')},h('div',{className:'herdr-native-search'+(searchOpen?' herdr-native-search-expanded':''),onClick:()=>{if(!searchOpen)setSearchOpen(true);}},h('button',{type:'button',className:'herdr-native-search-btn','aria-label':'搜索项目','aria-expanded':!!searchOpen,title:'搜索',onClick:event=>{event.stopPropagation();setSearchOpen(true);}},h(Glyph,{name:'search',size:14})),h('input',{ref:searchRef,className:'herdr-native-search-input','aria-label':'搜索项目',placeholder:'搜索项目名称',value:query,tabIndex:searchOpen?0:-1,onChange:event=>setQuery(event.target.value),onFocus:()=>setSearchOpen(true),onBlur:()=>{if(!query.trim())setSearchOpen(false);},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();setQuery('');setSearchOpen(false);event.currentTarget.blur();}}}),(searchOpen&&query)&&h('button',{type:'button',className:'herdr-native-search-clear','aria-label':'清除搜索',onMouseDown:event=>event.preventDefault(),onClick:()=>{setQuery('');searchRef.current&&searchRef.current.focus();}},h(Glyph,{name:'close',size:12})))), h('div',{className:'herdr-native-header-actions'+(searchOpen?' herdr-native-header-actions-hidden':'')},h('button',{type:'button',className:'herdr-native-icon','aria-label':'Herdr 插件设置',title:'插件设置',onClick:()=>openHerdrSettings()},h(Glyph,{name:'sliders',size:14})),h('a',{className:'herdr-native-icon',href:getBaseFrameUrl(),target:'_blank',rel:'noopener noreferrer','aria-label':'在新窗口打开 Herdr',title:'新窗口','data-herdr-open':true},h(Glyph,{name:'external',size:14})),h('button',{type:'button',className:'herdr-native-icon','aria-label':'刷新项目列表',title:'刷新列表',onClick:()=>load().catch(error=>publish({error:error.message}))},h(Glyph,{name:'refresh',size:14})),h('button',{type:'button',className:'herdr-native-icon','aria-label':'新建 Herdr 项目',title:'新建项目','data-primary':true,'data-herdr-new-project':true,onClick:()=>showForm({kind:'workspace-create',value:'',cwd:''})},h(Glyph,{name:'plus',size:16})))), 
          h('div',{className:'herdr-native-meta',role:'status'},h('span',{className:'herdr-native-source','data-state':current.connection,title:current.connection==='connected'?'数据已同步':current.connection==='loading'?'正在读取项目':'连接已断开，显示最后列表'},h('span',{className:'herdr-native-source-dot','aria-hidden':true}),current.connection==='connected'?'本机':current.connection==='loading'?'连接中':'已断开'),h('span',{className:'herdr-native-counts','aria-label':`${current.snapshot.workspaces.length} 个项目，${current.snapshot.panes.length} 个终端`},h('span',{className:'herdr-native-count'},`${current.snapshot.workspaces.length} 项目`),h('span',{className:'herdr-native-sep','aria-hidden':true},'·'),h('span',{className:'herdr-native-count'},`${current.snapshot.panes.length} 终端`))),
          current.error&&h('div',{className:'herdr-native-error',role:'status'},h('span',null,current.error),h('button',{type:'button',onClick:()=>load().catch(error=>publish({error:error.message}))},'重试')),
          h('div',{className:'herdr-native-tree',role:'list','aria-label':'Herdr 项目'},projects,(!current.snapshot.workspaces.length||!projects.some(Boolean))&&h('div',{className:'herdr-native-empty'},h('div',null,needle?'没有匹配的项目':current.connection==='loading'?'正在连接 Ovis…':current.connection==='offline'?'连接已断开':'还没有项目'),!needle&&h('div',{className:'herdr-native-empty-actions'},current.connection==='offline'&&h('button',{type:'button',onClick:()=>load().catch(error=>publish({error:error.message}))},'刷新'),current.connection!=='loading'&&h('button',{type:'button','data-primary':true,onClick:()=>showForm({kind:'workspace-create',value:'',cwd:''})},'新建项目')))),
          menu&&createPortal(h('div',{ref:menuRef,className:'herdr-native-menu',role:'menu','data-menu-material':true,style:{left:Math.min(menu.x,window.innerWidth-180),top:menu.y},onClick:event=>event.stopPropagation()},
            h('button',{role:'menuitem','data-herdr-menu-rename':true,onClick:()=>showForm({kind:'workspace-rename',id:menu.target.id,value:menu.target.label})},h(Glyph,{name:'edit',size:15}),h('span',null,'重命名项目')),
            h('button',{role:'menuitem','data-danger':true,'data-herdr-menu-close':true,onClick:()=>showForm({kind:'workspace-close',id:menu.target.id,label:menu.target.label})},h(Glyph,{name:'trash',size:15}),h('span',null,'关闭项目'))),document.body),
          form&&createPortal(h('div',{className:'herdr-native-shade',onMouseDown:event=>{if(event.target===event.currentTarget&&!busy)setForm(null);}},h('form',{ref:formRef,className:'herdr-native-dialog',role:'dialog','aria-modal':true,'aria-label':formTitle,onSubmit:submit,onKeyDown:dialogKeys},
            h('div',{className:'herdr-native-dialog-heading'},h('span',{className:'herdr-native-dialog-symbol','data-danger':closing},h(Glyph,{name:closing?'trash':form.kind==='workspace-create'?'folder':'edit',size:18})),h('div',{className:'herdr-native-dialog-copy'},h('h2',null,formTitle),!closing&&h('p',{className:'herdr-native-dialog-description'},form.kind==='workspace-create'?'为项目选择一个工作目录':'名称将同步更新到终端工作台')),h('button',{type:'button',className:'herdr-native-dialog-close','aria-label':'关闭对话框',disabled:busy,onClick:()=>setForm(null)},h(Glyph,{name:'close',size:14}))),
            closing?h('p',null,`关闭「${form.label}」及其中所有终端？`):h(React.Fragment,null,
              h('label',null,'名称',h('input',{'data-herdr-name-input':true,autoFocus:true,value:form.value,onChange:event=>setForm({...form,value:event.target.value})})),
              form.kind==='workspace-create'&&h('label',null,'工作目录',h('input',{'data-herdr-cwd-input':true,value:form.cwd,placeholder:'例如 /path/to/project',onChange:event=>setForm({...form,cwd:event.target.value})}))),
            formError&&h('div',{className:'herdr-native-error',role:'alert'},formError),
            h('div',{className:'herdr-native-dialog-actions'},h('button',{type:'button','data-herdr-cancel':true,disabled:busy,onClick:()=>setForm(null)},'取消'),h('button',{type:'submit','data-primary':!closing,'data-danger':closing,'data-herdr-confirm':true,disabled:busy},busy?'处理中…':closing?'关闭':'保存')))),document.body),settingsOpen&&h(HerdrSettingsOverlay,{onClose:()=>setSettingsOpen(false),onApplied:()=>load().catch(error=>publish({error:error.message}))}));
      }
      function Panel() {
        const current=useStore();
        const buildFrameUrl=()=>{
          const selection=state.pending?.selection||state.selection;
          const url=new URL(getBaseFrameUrl());
          if(selection){url.searchParams.set('ws',selection.workspace);url.searchParams.set('pane',selection.pane);url.searchParams.set('view',selection.view);}
          return url.href;
        };
        const [frameSrc,setFrameSrc]=React.useState(buildFrameUrl);
        React.useEffect(()=>{
          const sync=()=>setFrameSrc(prev=>{const next=buildFrameUrl();return prev===next?prev:next;});
          window.addEventListener('dsh-herdr-live-prefs',sync);
          return()=>window.removeEventListener('dsh-herdr-live-prefs',sync);
        },[]);
        React.useEffect(()=>{mounted++;syncLayout();return()=>{mounted--;active=false;stopData();clearTimeout(pendingTimer);if(state.pending)publish({pending:null});disposeSidebar?.();disposeSidebar=null;frameReady=false;lastSentRequestId=null;};},[]);
        const offline=current.connection==='offline';
        const loading=current.connection==='loading'&&!current.snapshot.workspaces.length;
        return h('section',{className:'herdr-live-panel','data-herdr-panel':true,'aria-label':'Herdr / Ovis'},h('style',null,styles),
          h('iframe',{ref:element=>{frame=element;},className:'herdr-live-frame','data-herdr-frame':true,title:'Herdr / Ovis',src:frameSrc,allow:'clipboard-read; clipboard-write; microphone; fullscreen',onLoad:()=>{frameLoads++;lastSentRequestId=null;sendHello();}}),
          (offline||loading)&&h('div',{className:'herdr-live-overlay',role:'status'},h('div',null,h('strong',null,offline?'Herdr 已离线':'正在连接 Herdr'),h('p',null,offline?(current.error||'显示最后一次项目列表，可稍后重试连接。'):'正在读取项目与终端状态…'),offline&&h('button',{type:'button','data-primary':true,onClick:()=>load().catch(error=>publish({error:error.message}))},'重新连接'))));
      }
      function syncLayout() {
        active=ctx.layout.panelInfo.getSnapshot().activePanelId===ID;
        if(active){
          if(sidebarAvailable&&!disposeSidebar)disposeSidebar=ctx.slots.register({name:'sidebar.workspaces',priority:-1000},Sidebar);
          startData();
        }else{
          stopData();clearTimeout(pendingTimer);
          if(state.pending)publish({pending:null});
          if(disposeSidebar){disposeSidebar();disposeSidebar=null;}
        }
      }
      ctx.slots.inject(SOURCE_TAB_SLOT,()=>ctx.slots.register({name:SOURCE_TAB_SLOT,id:ID,order:10,label:'Herdr'},props=>h(SourceTab,{...props,sourceId:ID,panelId:ID,label:'Herdr',icon:Icon})));
      onSettingsApplied=()=>load().catch(error=>publish({error:error.message}));
      ctx.effect(()=>()=>{onSettingsApplied=()=>{};});
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:ID},Panel));
      // A sidebar owner can unload while the active main panel remains mounted.
      ctx.slots.inject('sidebar.workspaces',()=>{sidebarAvailable=true;syncLayout();return()=>{sidebarAvailable=false;disposeSidebar?.();disposeSidebar=null;};});
      // Source observation outlives a temporary replacement of the sidebar declaration.
      ctx.effect(()=>{
        const unsubscribe=ctx.layout.panelInfo.subscribe(syncLayout);syncLayout();
        return()=>{unsubscribe();stopData();disposeSidebar?.();disposeSidebar=null;};
      });
      const diagnostic={show:()=>ctx.layout.selectPanel(ID),back:()=>ctx.layout.selectPanel(null),frameOrigin:getFrameOrigin(),selectPane:choosePane,selectWorkspace:chooseWorkspace,snapshot:()=>({activePanelId:ctx.layout.panelInfo.getSnapshot().activePanelId,mounted,frameOrigin:getFrameOrigin(),frameSrc:frame?.getAttribute('src')??null,frameMounted:frame!==null,frameLoads,frameReady,nativeSidebarActive:Boolean(disposeSidebar),counts:{workspaces:state.snapshot.workspaces.length,tabs:state.snapshot.tabs.length,panes:state.snapshot.panes.length},selection:state.selection,pending:state.pending,connection:state.connection,navigationEntries:ctx.slots.entriesOfSlot('sidebar.panellist').map(entry=>({id:entry.options.id??null,order:entry.options.order??0}))})};
      ctx.effect(()=>{window.addEventListener('message',message);window.__HERDR_LIVE__=diagnostic;return()=>{disposed=true;clearTimeout(pendingTimer);window.removeEventListener('message',message);stopData();disposeSidebar?.();if(window.__HERDR_LIVE__===diagnostic)delete window.__HERDR_LIVE__;};});
    }
    return {inject:['slots','layout'],apply,SettingsPanel:()=>h(HerdrSettingsPanel,{onApplied:onSettingsApplied})};
}
