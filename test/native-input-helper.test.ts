import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { DriverProcess } from '../packages/dsh-px-computer/src/driver-process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test(
  'compiled Windows executor rejects invalid plans and never starts without owner acknowledgement',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'px-native-contract-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const compiler = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    )
    assert.ok(existsSync(compiler), 'Supported Windows environment must provide the native helper compiler')
    const binary = join(dir, 'input.exe')
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/out:' + binary,
        '/r:System.Web.Extensions.dll',
        '/r:System.Drawing.dll',
        resolve('packages/dsh-px-computer/native/windows-input.cs'),
        resolve('packages/dsh-px-computer/native/windows-controls.cs'),
        resolve('packages/dsh-px-computer/native/windows-view.cs')
      ],
      { windowsHide: true }
    )
    const base = { pid: process.pid, window_id: 1, keys: [87], buttons: [], duration_ms: 250, dx: 0, dy: 0 }
    for (const plan of [
      base,
      { ...base, duration_ms: 10001 },
      { ...base, keys: [91] },
      { ...base, keys: [17, 18, 46] },
      { ...base, buttons: ['unknown'] }
    ]) {
      const result = spawnSync(
        binary,
        ['--guard', String(process.pid), Buffer.from(JSON.stringify(plan)).toString('base64')],
        { windowsHide: true, input: '', encoding: 'utf8', timeout: 5000 }
      )
      assert.equal(result.status, 1)
      const reply = JSON.parse(result.stdout.trim())
      assert.equal(reply.ok, false)
      assert.equal(reply.release_attempted, false)
      assert.ok(
        !result.stdout.includes('worker_pid'),
        'No input child may start before acknowledgement or validation'
      )
    }
    // A tiny uncompressed bitmap proves actual magnification, without depending on a desktop or image fixture.
    const bitmap = Buffer.alloc(62)
    bitmap.write('BM')
    bitmap.writeUInt32LE(62, 2)
    bitmap.writeUInt32LE(54, 10)
    bitmap.writeUInt32LE(40, 14)
    bitmap.writeInt32LE(2, 18)
    bitmap.writeInt32LE(1, 22)
    bitmap.writeUInt16LE(1, 26)
    bitmap.writeUInt16LE(24, 28)
    bitmap.writeUInt32LE(8, 34)
    bitmap.set([0, 0, 255, 0, 255, 0, 0, 0], 54)
    const input = join(dir, 'input.bmp'),
      output = join(dir, 'zoom.png')
    writeFileSync(input, bitmap)
    const enlarged = JSON.parse(
      execFileSync(binary, ['--magnify', input, output], { encoding: 'utf8', windowsHide: true })
    )
    assert.deepEqual(enlarged, { width: 8, height: 4, source_width: 2, source_height: 1 })
    const png = readFileSync(output)
    assert.equal(png.readUInt32BE(16), 8)
    assert.equal(png.readUInt32BE(20), 4)

    // Reuse the real image implementation; fake only window inspection, never inject OS input in unit tests.
    const helperSource = join(dir, 'view-helper.cs'),
      helper = join(dir, 'view-helper.exe')
    const pointLog = join(dir, 'point.json'),
      blockPoint = join(dir, 'point-block'),
      clickLog = join(dir, 'click.log')
    writeFileSync(
      helperSource,
      `using System;using System.Web.Script.Serialization;class ViewContractHelper{static void Main(string[] a){var j=new JavaScriptSerializer();if(a[0]=="--guard"){if(Console.ReadLine()!="start")Environment.Exit(2);var plan=j.Deserialize<System.Collections.Generic.Dictionary<string,object>>(System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(a[2])));bool failed=Convert.ToInt32(plan["dx"])<0;Console.WriteLine(j.Serialize(new{finished=true,ok=!failed,error=failed?"synthetic target lost":null,elapsed_ms=42,release_attempted=true,pointer_before=new{screen_x=10},pointer_after=new{near_client_edge=true,inside_client=true,relative_capture="unknown"}}));Environment.Exit(failed?1:0);}else if(a[0]=="--inspect")Console.WriteLine(j.Serialize(new{foreground=true,current_desktop=true,cloaked=0,bounds=new{left=0,top=0,right=4,bottom=3}}));else if(a[0]=="--magnify")Console.WriteLine(j.Serialize(WindowsView.Magnify(a[1],a[2])));else if(a[0]=="--point"){System.IO.File.WriteAllText(${JSON.stringify(pointLog)},System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(a[1])));if(System.IO.File.Exists(${JSON.stringify(blockPoint)})){Console.WriteLine(j.Serialize(new{error="synthetic overlay: point=(1,1) hit_window=9"}));Environment.Exit(1);}Console.WriteLine("{}");}else throw new Exception("Unexpected operation");}}`
    )
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/out:' + helper,
        '/r:System.Web.Extensions.dll',
        '/r:System.Drawing.dll',
        helperSource,
        resolve('packages/dsh-px-computer/native/windows-view.cs')
      ],
      { windowsHide: true }
    )
    const sdk = join(dir, 'sdk.mjs'),
      dummy = join(dir, 'not-run.exe')
    writeFileSync(dummy, 'verified fixture')
    writeFileSync(
      sdk,
      `import{appendFileSync}from'node:fs';const image={type:'image',mimeType:'image/bmp',data:'${bitmap.toString('base64')}'};
      export const EmbeddedPermissionMode={Standard:0},EmbeddedDriverHostOptions={create:o=>o};
      export const EmbeddedCuaDriverHost={withOptions:()=>({async start(){return{socketPath:'private-test',driverVersion:'0.28.0',generation:'1'}},waitForExit:()=>new Promise(()=>{}),async stop(){}})};
      export const CuaDriver={connect:()=>({async callTool(name,json){const args=JSON.parse(json);if(name==='click')appendFileSync(${JSON.stringify(clickLog)},'click;');return{rawJson:JSON.stringify(name==='get_window_state'?{content:[image],structuredContent:{screenshot_width:2,screenshot_height:1,window_bounds:{x:0,y:0,width:4,height:3}}}:name==='zoom'?{content:[image],structuredContent:{width:2,height:1}}:{content:[],structuredContent:{args}})};},uniffiDestroy(){}})};`
    )
    const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
    const worker = new DriverProcess(pathToFileURL(sdk).href, () => {}, 5000, {
      binaryPath: dummy,
      version: '0.28.0',
      files: { 'not-run.exe': sha(dummy) },
      input: { binaryPath: helper, sha256: sha(helper) }
    })
    t.after(() => worker.shutdown())
    const call = async (name: string, args: any, scope = 'a') =>
      JSON.parse((await worker.callTool(name, JSON.stringify(args), { scope })).rawJson)
    const target = { pid: 1, window_id: 2 }
    // Exercise the real worker/guardian handshake and failure transport, but never inject OS input.
    for (const dx of [1, -1]) {
      const receipt = await call('bounded_input', {
        ...target,
        dx,
        duration_ms: 100,
        delivery_mode: 'foreground'
      })
      assert.equal(receipt.isError, dx < 0)
      assert.equal(receipt.structuredContent.effect, 'unverifiable')
      assert.equal(receipt.structuredContent.release_attempted, true)
      assert.equal(receipt.structuredContent.elapsed_ms, 42)
      assert.equal(receipt.structuredContent.pointer_before.screen_x, 10)
      assert.equal(receipt.structuredContent.pointer_after.relative_capture, 'unknown')
      assert.match(receipt.content[0].text, /不要重复长动作或盲目居中/)
      if (dx < 0) assert.match(receipt.content[0].text, /synthetic target lost.*动作可能部分执行/)
    }
    await call('get_window_state', target)
    const zoom = await call('zoom', { ...target, x1: 0, y1: 0, x2: 2, y2: 1 })
    assert.equal(zoom.structuredContent.width, 8)
    assert.equal(zoom.content[0].mimeType, 'image/png')
    const clicked = await call('click', {
      ...target,
      x: 4,
      y: 2,
      from_zoom: true,
      delivery_mode: 'foreground'
    })
    assert.equal(clicked.structuredContent.args.x, 1)
    assert.equal(clicked.structuredContent.args.y, 0.5)
    const checkedPoint = JSON.parse(readFileSync(pointLog, 'utf8'))
    assert.equal(checkedPoint.x, 1)
    assert.equal(checkedPoint.y, 0.5)
    assert.equal(checkedPoint.image_width, 2)
    const beforeBlockedClick = readFileSync(clickLog, 'utf8')
    writeFileSync(blockPoint, 'blocked')
    await assert.rejects(
      call('click', { ...target, x: 1, y: 0, delivery_mode: 'foreground' }),
      /synthetic overlay: point=.*hit_window=/
    )
    assert.equal(
      readFileSync(clickLog, 'utf8'),
      beforeBlockedClick,
      'A refused point must never reach native click'
    )
    rmSync(blockPoint)
    await assert.rejects(
      call('click', { ...target, x: 4, y: 2, from_zoom: true, delivery_mode: 'foreground' }),
      /放大视图已失效/
    )
    await call('zoom', { ...target, x1: 0, y1: 0, x2: 2, y2: 1 })
    await call('get_window_state', { pid: 1, window_id: 3 }, 'b')
    await assert.rejects(
      call('click', { ...target, x: 1, y: 0, from_zoom: true, delivery_mode: 'foreground' }),
      /放大视图已失效/
    )
    await assert.rejects(call('click', { ...target, x: 1, y: 0, delivery_mode: 'foreground' }), /重新观察/)
    await worker.shutdown()
  }
)
