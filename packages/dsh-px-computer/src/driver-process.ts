/** The native driver runs outside DSH: crashes or blocked UIA calls must not strand the host. */
import { spawn, type ChildProcess } from 'node:child_process'
import type { DriverLike } from './desktop'

export interface NativeDriverOptions {
  binaryPath: string
  version: string
  files: Record<string, string>
  input?: { binaryPath: string; sha256: string }
}

// The worker owns the SDK lifecycle; the actual Windows driver is a PMv2 native EXE.
const WORKER = String.raw`
process.on('disconnect', () => process.exit(0));
const sdk = await import(process.argv[1]);
const native = JSON.parse(process.argv[2] || 'null');
const guards = new Map();
const scopeClients = new Map();
const controlSnapshots = new Map();
const frames = new Map();
const zooms = new Map();
let controlSequence = 0;
const controlKey = args => String(args.__px_scope ?? args.session ?? '') + ':' + args.pid + ':' + args.window_id;
async function clientFor(scope) {
  if (!scope) return driver;
  if (!scopeClients.has(scope)) scopeClients.set(scope, Promise.resolve().then(() => native ? sdk.CuaDriver.connect(socketPath) : sdk.CuaDriver.create(undefined)));
  return scopeClients.get(scope);
}
const unavailable = text => ({rawJson:JSON.stringify({isError:true,content:[{type:'text',text}],structuredContent:{code:'background_unavailable',effect:'refused'}})});
async function verifiedInputPath() {
  if (!native?.input) throw Error('当前安装缺少有时长输入执行器，请更新电脑操作功能包');
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  if (createHash('sha256').update(await readFile(native.input.binaryPath)).digest('hex') !== native.input.sha256)
    throw Error('有时长输入执行器校验失败');
  return native.input.binaryPath;
}
async function helperCall(args, strict = false) {
  const { spawn } = await import('node:child_process');
  const child = spawn(await verifiedInputPath(), args, {windowsHide:true,stdio:['ignore','pipe','ignore']});
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-1048576); });
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    let result; try {result = JSON.parse(output.trim());} catch {}
    if(code !== 0 || !result) {if(strict)throw Object.assign(Error(result?.error || '原生窗口操作未完成；效果未知，请重新观察'),{code:result?.code});return null;}
    return result;
  } finally {clearTimeout(timer);}
}
const inspectWindow = args => helperCall(['--inspect', String(args.pid), String(args.window_id)]);
function observedFrame(args) {
  const frame = frames.get(args.pid);
  if (!frame || frame.scope !== args.__px_scope || frame.windowId !== args.window_id)
    throw Error('请先重新观察这个窗口；其他窗口或会话的观察不能用于本次像素操作');
  return frame;
}
async function magnifyZoom(raw, args) {
  const image = raw.content?.find(item => item.type === 'image' && typeof item.data === 'string');
  if (!image || raw.isError) return raw;
  const { mkdtemp, writeFile, readFile, rm, realpath } = await import('node:fs/promises');
  const { join, sep } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'dsh-px-zoom-'));
  try {
    const input = join(directory,'input.image'), output = join(directory,'zoom.png');
    await writeFile(input,Buffer.from(image.data,'base64'),{flag:'wx'});
    const size = await helperCall(['--magnify',input,output],true);
    image.data = (await readFile(output)).toString('base64'); image.mimeType = 'image/png';
    // Pinned Cua 0.28 crop_png_to_jpeg: native-pixel region, 20% padding, integer
    // clipping, then width <= 500. Validate the actual crop size before using this
    // mapping for a read-only foreground hit test; native Cua still sends the click.
    const frame=observedFrame(args), nativeWidth=frame.bounds.width-2, nativeHeight=frame.bounds.height-2;
    const ratio=nativeWidth/frame.width, x1=args.x1*ratio, y1=args.y1*ratio, x2=args.x2*ratio, y2=args.y2*ratio;
    const padX=Math.max(1,x2-x1)*0.2,padY=Math.max(1,y2-y1)*0.2;
    const originX=Math.min(nativeWidth,Math.floor(Math.max(0,x1-padX))),originY=Math.min(nativeHeight,Math.floor(Math.max(0,y1-padY)));
    const cropWidth=Math.max(1,Math.min(nativeWidth,Math.floor(x2+padX))-originX),cropHeight=Math.max(1,Math.min(nativeHeight,Math.floor(y2+padY))-originY);
    const expectedWidth=Math.min(500,cropWidth),expectedHeight=cropWidth>500?Math.max(1,Math.round(cropHeight*500/cropWidth)):cropHeight;
    if(size.source_width!==expectedWidth || size.source_height!==expectedHeight)throw Error('原生放大图尺寸与固定版本坐标契约不符，请重新观察并使用完整截图');
    zooms.set(args.pid,{scope:args.__px_scope,windowId:args.window_id,width:size.width,height:size.height,scaleX:size.width/size.source_width,scaleY:size.height/size.source_height,originX,originY,scaleInv:cropWidth/size.source_width});
    raw.content = raw.content.filter(item=>item.type !== 'text');
    raw.content.push({type:'text',text:'已放大到 '+size.width+'×'+size.height+'。需要点击此图时使用 computer_click(from_zoom:true)，坐标按本张放大图；仅最近一次放大有效。原生截图范围含边缘留白，勿自行猜偏移。'});
    raw.structuredContent = {...raw.structuredContent,width:size.width,height:size.height,mime_type:'image/png',format:'png'};
    return raw;
  } finally {if(!directory.startsWith(temporaryRoot+sep))throw Error('Invalid zoom cleanup path');await rm(directory,{recursive:true,force:true});}
}
async function dispatch(name, args, json, id, client) {
  let clickPoint;
  if (native?.input && name === 'move_pointer') {
    if(args.delivery_mode !== 'foreground')throw Error('真实指针移动必须显式使用 foreground');
    const frame=observedFrame(args);
    const request={pid:args.pid,window_id:args.window_id,x:args.x,y:args.y,image_width:frame.width,image_height:frame.height,window_width:frame.bounds.width,window_height:frame.bounds.height};
    zooms.delete(args.pid); controlSnapshots.delete(controlKey(args));
    const result=await helperCall(['--pointer',Buffer.from(JSON.stringify(request)).toString('base64')],true);
    return {rawJson:JSON.stringify({content:[{type:'text',text:'已移动真实鼠标指针，未点击。请重新观察悬停提示或界面变化。'}],structuredContent:{delivery:{mode:'foreground'},effect:'unverifiable',position:result}})};
  }
  if (native?.input && name === 'get_window_state') {frames.delete(args.pid);zooms.delete(args.pid);}
  if (native?.input && name === 'zoom') {
    const frame=observedFrame(args), current=await inspectWindow(args), bounds=current?.bounds;
    if(!bounds || bounds.right-bounds.left !== frame.bounds.width || bounds.bottom-bounds.top !== frame.bounds.height)
      throw Error('窗口尺寸已变化，请重新观察后再放大');
    zooms.delete(args.pid);
  }
  if (native?.input && name === 'click' && args.from_zoom === true) {
    const zoom=zooms.get(args.pid);
    if(!zoom || zoom.scope !== args.__px_scope || zoom.windowId !== args.window_id)throw Error('放大视图已失效或属于其他窗口，请重新放大');
    if(args.element_index !== undefined || !Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x<0 || args.y<0 || args.x>=zoom.width || args.y>=zoom.height)
      throw Error('放大图点击必须使用图内的 x/y，不能同时指定元素编号');
    const input=JSON.parse(json);input.x=args.x/zoom.scaleX;input.y=args.y/zoom.scaleY;json=JSON.stringify(input);
    clickPoint={x:zoom.originX+input.x*zoom.scaleInv,y:zoom.originY+input.y*zoom.scaleInv};
  } else if (native?.input && ['click','scroll','drag'].includes(name) && (args.x !== undefined || args.from_x !== undefined) && args.element_index === undefined) observedFrame(args);
  if(native?.input && name==='click' && args.delivery_mode==='foreground' && args.element_index===undefined) {
    const frame=observedFrame(args),ratio=(frame.bounds.width-2)/frame.width;
    const point=clickPoint??{x:args.x*ratio,y:args.y*ratio};
    zooms.delete(args.pid);
    const state=await inspectWindow(args);
    if(!state?.foreground) {
      const activated=JSON.parse((await client.callTool('bring_to_front',JSON.stringify({pid:args.pid,window_id:args.window_id,session:args.session}))).rawJson);
      if(activated.isError)throw Error('无法激活已授权目标窗口；点击未投递，请重新观察');
    }
    // Never treat an IME/overlay hit (even cloaked) as permission to click through.
    await helperCall(['--point',Buffer.from(JSON.stringify({pid:args.pid,window_id:args.window_id,...point,image_width:frame.bounds.width-2,image_height:frame.bounds.height-2,window_width:frame.bounds.width,window_height:frame.bounds.height})).toString('base64')],true);
  }
  if (['click','type_text','set_value','press_key','hotkey','scroll','drag','bring_to_front','invoke_menu','bounded_input'].includes(name)) {
    zooms.delete(args.pid);
    const previous=frames.get(args.pid);if(previous && (previous.scope !== args.__px_scope || previous.windowId !== args.window_id))frames.delete(args.pid);
  }
  if (name === 'bounded_input') {controlSnapshots.delete(controlKey(args));return boundedInput(id, json);}
  let beforeForeground;
  if (native?.input && ['click','type_text','set_value','press_key','hotkey','scroll','drag'].includes(name) && (args.delivery_mode !== 'foreground' || args.element_index >= 100000)) {
    const stored = controlSnapshots.get(controlKey(args));
    if (Number.isInteger(args.element_index) && args.element_index >= 100000) {
      if (!stored || args.snapshot_id !== stored.snapshot) throw Error('原生控件快照已失效，请重新观察');
      const control = stored.controls[args.element_index - 100000];
      if (!control) throw Error('原生控件编号无效');
      if (!['click','type_text','set_value'].includes(name) || (name === 'click' && (control.role !== 'Button' || args.button !== undefined && args.button !== 'left' || args.count !== undefined && args.count !== 1 || args.modifier?.length)) || (name !== 'click' && control.role !== 'Edit'))
        return unavailable('此控件不支持请求的后台操作；只支持按钮点击或文本值设置。');
      controlSnapshots.delete(controlKey(args));
      const request = {pid:args.pid,window_id:args.window_id,child_id:control.child_id,class_name:control.class_name,expected_text:control.text,
        action:name === 'click' ? 'click' : 'set_value',value:name === 'type_text' ? control.text + args.text : args.value};
      const receipt = await helperCall(['--control', Buffer.from(JSON.stringify(request)).toString('base64')], true);
      return {rawJson:JSON.stringify({content:[{type:'text',text:'已投递原生控件消息；请重新观察核对结果。'}],structuredContent:{delivery:{mode:'background'},effect:receipt.effect,route:'native_control'}})};
    }
    const state = await inspectWindow(args);
    if (!state || state.current_desktop === false || state.cloaked)
      return unavailable('跨虚拟桌面仅支持最近一次观察列出的原生按钮和文本框；其他操作需要前台或应用专用接口。');
    beforeForeground = state.foreground_window_id;
  }
  if (['click','type_text','set_value','press_key','hotkey','scroll','drag','bring_to_front','invoke_menu'].includes(name)) controlSnapshots.delete(controlKey(args));
  const result = await client.callTool(name, json);
  if (beforeForeground !== undefined) {
    const after = await helperCall(['--foreground'], true);
    if (after.window_id !== beforeForeground && after.pid === args.pid) throw Object.assign(Error('Target application became foreground during background delivery; inspect before continuing'),{code:'unexpected_foreground'});
    const raw=JSON.parse(result.rawJson);
    raw.structuredContent={...raw.structuredContent,px_background_observation:{foreground_unchanged:after.window_id===beforeForeground,target_became_foreground:after.window_id!==beforeForeground&&after.pid===args.pid}};
    // Pinned 0.28 SetValueTool only calls UIA ValuePattern/RangeValuePattern and returns no delivery record.
    // Do not infer delivery from arbitrary text or apply this to other SDK methods/versions.
    if(native.version==='0.28.0' && name==='set_value' && !raw.isError)
      raw.structuredContent={...raw.structuredContent,delivery:{mode:'background'},route:'uia_value_pattern',effect:'unverifiable'};
    result.rawJson=JSON.stringify(raw);
  }
  return result;
}
async function boundedInput(id, args) {
  const binaryPath = await verifiedInputPath();
  const { spawn } = await import('node:child_process');
  const child = spawn(binaryPath, ['--guard', String(process.pid), Buffer.from(args).toString('base64')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  guards.set(id, child);
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  child.stdin.on('error', () => {});
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      if (child.pid) process.send?.({ inputGuard: id, pid: child.pid });
    });
    const final = output.trim().split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(item => item?.finished).at(-1);
    if (!final) throw Error(errors || '有时长输入中断，未收到最终释放报告；效果未知，请重新观察目标');
    const pointer = final.pointer_after;
    const warning = pointer && (pointer.near_client_edge === true || pointer.inside_client === false)
      ? ' 系统指针已接近或越过客户区边缘；这不证明游戏转向成功。请检查当前是菜单还是捕获鼠标的3D场景，再做小幅校准；不要重复长动作或盲目居中。' : '';
    const failed = code !== 0 || !final.ok;
    const details = {elapsed_ms:final.elapsed_ms,release_attempted:final.release_attempted,pointer_before:final.pointer_before,pointer_after:final.pointer_after};
    const message = failed ? (final.error || errors || '有时长输入中断') + '；动作可能部分执行，请重新观察。' : '已执行有时长输入并尝试释放按键；请重新观察目标确认实际效果。';
    return { rawJson: JSON.stringify({ isError:failed,content: [{type:'text',text:message+warning+' 输入诊断：'+JSON.stringify(details)}], structuredContent:{delivery:{mode:'foreground'},effect:'unverifiable',...details} }) };
  } finally {
    guards.delete(id);
    process.send?.({ inputGuardEnded: id, pid: child.pid });
  }
}
let host, driver, socketPath;
if (native) {
  const { readFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  for (const [file, digest] of Object.entries(native.files)) {
    const bytes = await readFile(join(dirname(native.binaryPath), file));
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw Error('电脑操作原生驱动校验失败：' + file);
  }
  host = sdk.EmbeddedCuaDriverHost.withOptions(sdk.EmbeddedDriverHostOptions.create({
    binaryPath: native.binaryPath, hostBundleId: 'org.dsh-px.desktop',
    approveCapabilityManifest: false, approveSessionPolicy: false,
    dangerouslyBypassApprovals: false, permissionMode: sdk.EmbeddedPermissionMode.Standard,
    environment: [{ name: 'CUA_DRIVER_RS_TELEMETRY_ENABLED', value: 'false' }],
    inheritStderr: true, noOverlay: true
  }));
  const connection = await host.start();
  socketPath = connection.socketPath;
  if (connection.driverVersion !== native.version) {
    await host.stop();
    throw Error('电脑操作原生驱动版本不匹配');
  }
  driver = sdk.CuaDriver.connect(connection.socketPath);
  host.waitForExit(connection.generation).then(() => process.exit(20), () => process.exit(21));
} else driver = await sdk.CuaDriver.create(undefined);
process.on('message', async message => {
  if (message?.kind === 'input-start') { guards.get(message.id)?.stdin.end('start\n'); return; }
  if (!message || message.kind !== 'call') return;
  try {
    const scope = typeof message.scope === 'string' ? message.scope : '';
    if (message.name === '__px_close_scope') {
      const previous = scopeClients.get(scope); scopeClients.delete(scope);
      for (const key of controlSnapshots.keys()) if(key.startsWith(scope + ':'))controlSnapshots.delete(key);
      for(const [pid,frame]of frames)if(frame.scope===scope){frames.delete(pid);zooms.delete(pid);}
      if(previous)(await previous).uniffiDestroy?.();
      process.send?.({id:message.id,result:{rawJson:'{"content":[]}'}}); return;
    }
    const client = await clientFor(scope);
    const callArgs = {...JSON.parse(message.args),__px_scope:scope};
    let result = await dispatch(message.name, callArgs, message.args, message.id, client);
    if(native?.input && message.name === 'zoom') result={rawJson:JSON.stringify(await magnifyZoom(JSON.parse(result.rawJson),callArgs))};
    if (native?.input && ['get_window_state', 'bring_to_front'].includes(message.name)) {
      const raw = JSON.parse(result.rawJson), args = callArgs;
      let state = await inspectWindow(args);
      if (message.name === 'get_window_state') {
        const key = controlKey(args);
        controlSnapshots.delete(key);
        const shot=raw.structuredContent;
        if(!raw.isError && shot?.screenshot_frame_valid!==false && shot?.window_bounds && shot.screenshot_width>0 && shot.screenshot_height>0 && raw.content?.some(item=>item.type==='image'))
          frames.set(args.pid,{scope:args.__px_scope,windowId:args.window_id,width:shot.screenshot_width,height:shot.screenshot_height,bounds:shot.window_bounds});
        if (!raw.isError && state && (state.current_desktop === false || state.cloaked)) {
          const observed = await helperCall(['--controls', String(args.pid), String(args.window_id)]);
          const controls = observed?.controls ?? [];
          const snapshot = 'px-native-' + (++controlSequence);
          controlSnapshots.set(key,{snapshot,controls});
          const clipped = text => text.length > 512 ? text.slice(0,512) + '…（显示已截短）' : text;
          const rows = controls.map((control,index)=>({element_index:100000+index,role:control.role,label:control.role === 'Button' ? clipped(control.text) : '文本框',value:control.role === 'Edit' ? clipped(control.text) : undefined,actions:[control.role === 'Button'?'invoke':'set_value']}));
          const tree = '- 跨虚拟桌面原生控件（只列出支持后台操作的按钮和文本框；其他内容请看截图）\n' + rows.map(row=>'  - ['+row.element_index+'] '+row.role+' '+JSON.stringify(row.label)+(row.value !== undefined ? ' value='+JSON.stringify(row.value) : '')).join('\n');
          raw.structuredContent = {...raw.structuredContent,snapshot_id:snapshot,elements:rows,tree_markdown:tree,element_count:rows.length,total_element_count:rows.length,returned_element_count:rows.length,elements_complete:false};
          raw.content = (raw.content ?? []).filter(item=>item.type !== 'text');
          raw.content.unshift({type:'text',text:tree});
        }
      }
      if (message.name === 'bring_to_front' && raw.isError) {
        const deadline = Date.now() + 800;
        while (state && (!state.foreground || state.cloaked !== 0) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
          state = await inspectWindow(args);
        }
        if (state?.foreground && state.cloaked === 0) {
          raw.isError = false;
          raw.content = [{type:'text',text:'窗口已处于前台（已核对 Windows 完成异步激活）。'}];
          raw.structuredContent = {landed_on_target:true,delivery:{mode:'foreground'},effect:'confirmed'};
        }
      }
      if (state) raw.structuredContent = {...raw.structuredContent,px_window:state};
      if (message.name === 'bring_to_front' && !raw.isError)
        raw.structuredContent = {...raw.structuredContent,delivery:{mode:'foreground'}};
      result = {rawJson:JSON.stringify(raw)};
    }
    process.send?.({ id: message.id, result });
  } catch (error) {
    const detail = error?.inner?.message ?? error?.inner?.reason ?? error?.message ?? error;
    const code = typeof error?.inner?.errorCode === 'string' ? error.inner.errorCode : typeof error?.code === 'string' ? error.code : undefined;
    const ended = /^session '([^']+)' has ended; tool call '([a-z_]+)' was rejected\./.exec(String(detail));
    let requestedSession;try{requestedSession=JSON.parse(message.args).session;}catch{}
    const sessionEnded = !!ended && ended[2] === message.name &&
      (/^sdk-[0-9a-f-]+$/.test(ended[1]) || typeof requestedSession === 'string' && ended[1] === requestedSession);
    process.send?.({ id: message.id, error: (code ? '[' + code + '] ' : '') + String(detail).slice(0,2000), driverErrorCode: code, sessionEnded });
  }
});
process.send?.({ ready: true });
`

export class DriverProcess implements DriverLike {
  private child?: ChildProcess
  private ready?: Promise<ChildProcess>
  private sequence = 0
  private pending = new Map<
    number,
    { resolve: (value: { rawJson: string }) => void; reject: (error: Error) => void }
  >()
  private closed = false
  private inputGuards = new Set<number>()

  private async waitForInputRelease(): Promise<void> {
    const deadline = Date.now() + 3000
    while (this.inputGuards.size) {
      for (const pid of this.inputGuards) {
        try {
          process.kill(pid, 0)
        } catch (error: any) {
          if (error.code === 'ESRCH') this.inputGuards.delete(pid)
          else throw Error('无法确认输入监护进程已退出；暂不执行下一步')
        }
      }
      if (!this.inputGuards.size) return
      if (Date.now() >= deadline) throw Error('输入释放仍未确认；暂不执行下一步，请检查目标窗口')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  constructor(
    private readonly moduleUrl: string,
    private readonly reset: () => void = () => {},
    private readonly timeoutMs = 45000,
    private readonly native?: NativeDriverOptions
  ) {}

  private start(): Promise<ChildProcess> {
    if (this.closed) return Promise.reject(Error('电脑操作进程已关闭'))
    if (this.ready) return this.ready
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', WORKER, this.moduleUrl, JSON.stringify(this.native ?? null)],
      {
        windowsHide: true,
        env: {
          ...process.env,
          CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      }
    )
    this.child = child
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    const ready = new Promise<ChildProcess>((resolve, reject) => {
      const timer = setTimeout(() => fail(Error('电脑操作进程启动超时')), this.timeoutMs)
      const fail = (error: Error) => {
        clearTimeout(timer)
        reject(error)
        if (this.child === child) this.terminate(error)
      }
      child.once('error', fail)
      child.once('exit', (code, signal) =>
        fail(Error(`电脑操作进程已退出（${signal ?? code}）${stderr ? ': ' + stderr : ''}`))
      )
      child.on('message', (message: any) => {
        if (this.child !== child) return
        if (message?.ready) {
          clearTimeout(timer)
          resolve(child)
          return
        }
        if (Number.isSafeInteger(message?.pid) && message.pid > 0) {
          if (message.inputGuard !== undefined) {
            this.inputGuards.add(message.pid)
            child.send({ kind: 'input-start', id: message.inputGuard })
            return
          }
          if (message.inputGuardEnded !== undefined) {
            this.inputGuards.delete(message.pid)
            return
          }
        }
        const item = this.pending.get(message?.id)
        if (!item) return
        this.pending.delete(message.id)
        if (typeof message.error === 'string')
          item.reject(
            message.sessionEnded
              ? Object.assign(
                  Error('底层电脑控制会话已结束，已暂停本会话。请在电脑操作面板点击恢复，再重新授权窗口。'),
                  { code: 'driver_session_ended', nativeDetail: message.error }
                )
              : message.driverErrorCode === 'unexpected_foreground'
                ? Object.assign(
                    Error('后台动作期间前台窗口发生变化，已停止本会话控制；动作可能已生效，请重新观察。'),
                    { code: 'driver_unexpected_foreground', nativeDetail: message.error }
                  )
                : Error(message.error)
          )
        else if (typeof message.result?.rawJson === 'string') item.resolve(message.result)
        else item.reject(Error('电脑操作进程返回了无效结果'))
      })
    })
    this.ready = ready
    return ready
  }

  private terminate(error: Error): void {
    const child = this.child
    this.child = undefined
    this.ready = undefined
    for (const item of this.pending.values()) item.reject(error)
    this.pending.clear()
    if (child) {
      child.kill()
      this.reset()
    }
  }

  async callTool(
    name: string,
    args: string,
    options?: { signal?: AbortSignal; scope?: string }
  ): Promise<{ rawJson: string }> {
    const signal = options?.signal
    signal?.throwIfAborted()
    if (name === '__px_close_scope' && !this.child) {
      await this.waitForInputRelease()
      return { rawJson: '{"content":[]}' }
    }
    // Includes startup: cancelling during native library initialization must be bounded too.
    let cancel!: (error: Error) => void
    const cancelled = new Promise<never>((_, reject) => {
      cancel = reject
    })
    const stop = (error: Error) => {
      this.terminate(error)
      cancel(error)
    }
    const abort = () => stop(Error('电脑操作已取消；动作可能已经生效，请重新观察后再决定下一步'))
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => stop(Error('电脑操作超时，已停止驱动进程；动作结果未知，不会自动重试')),
      this.timeoutMs
    )
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          await this.waitForInputRelease()
          const child = await this.start()
          signal?.throwIfAborted()
          if (this.child !== child) throw Error('电脑操作进程已重置，请重新观察窗口')
          const id = ++this.sequence
          return await new Promise<{ rawJson: string }>((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            child.send({ kind: 'call', id, name, args, scope: options?.scope }, (error) => {
              if (error && this.child === child) this.terminate(error)
            })
          })
        })()
      ])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      await this.waitForInputRelease()
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true
    this.terminate(Error('电脑操作进程已关闭，未完成动作的结果未知'))
    await this.waitForInputRelease()
  }
}
