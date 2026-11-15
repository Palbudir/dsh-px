import { createHash } from 'node:crypto'
import source from '../../config/im-community.json'

// The same method body is inserted into the readable source and its pinned upstream bundle.
// Bundle-private names below belong only to this exact source hash; an upstream rebuild must fail closed.
const controllerMethods = `
  #pxConsumerRevisions = new Map();
  #pxStopUncertain = new Set();
  pxReceptionState(botId) {
    const config = this.#requireBot(botId);
    if (!this.#pxConsumerRevisions.has(botId)) this.#pxConsumerRevisions.set(botId, pxModeRevisionId());
    return { version: 1, mode: config.consumerMode ?? 'standalone',
      revision: this.#pxConsumerRevisions.get(botId), active: this.#inboundConsumers.pxHas(botId),
      stopUncertain: this.#pxStopUncertain.has(botId) };
  }
  async restoreInbound(botId, { expectedFingerprint, expectedRevision, signal } = {}) {
    this.#assertOpen();
    return this.#serializeConfig(() => this.#withBotTransition(botId, async () => {
      this.#assertOpen(); signal?.throwIfAborted();
      const config = this.#requireBot(botId), account = await this.#deliveryAccount(config);
      this.#assertOpen(); signal?.throwIfAborted();
      if (account.fingerprint !== expectedFingerprint)
        throw Object.assign(new Error('account-changed'), { code: 'account-changed' });
      if (typeof expectedRevision !== 'string' || expectedRevision !== this.pxReceptionState(botId).revision)
        throw Object.assign(new Error('consumer-state-changed'), { code: 'consumer-state-changed' });
      if (this.#inboundConsumers.pxHas(botId))
        throw Object.assign(new Error('consumer-conflict'), { code: 'consumer-conflict' });
      if (config.consumerMode !== 'external-consumer') return this.status(botId);
      const resolved = await this.#credentials.resolve(config.secretRef);
      this.#assertOpen(); signal?.throwIfAborted();
      if (!resolved?.value) throw Object.assign(new Error('account-unverified'), { code: 'account-unverified' });
      this.#pxConsumerRevisions.set(botId, pxModeRevisionId());
      await this.#stopRuntime(botId);
      this.#assertOpen(); signal?.throwIfAborted();
      const saved = await this.#configStore.saveBot({ ...config, consumerMode: 'standalone' });
      this.#touch(); this.#assertOpen(); signal?.throwIfAborted();
      // If start fails, standalone remains the truthful stored mode; there is no automatic takeover.
      await this.#startRuntime(saved, resolved.value);
      this.#touch(); return this.status(botId);
    }));
  }
`

const stopRuntime = `async #stopRuntime(botId) {
    const runtime = this.#runtimes.get(botId);
    if (!runtime) return;
    try { await runtime.stop(); }
    catch (error) { this.#pxStopUncertain.add(botId); this.#touch(); throw error; }
    if (this.#runtimes.get(botId) === runtime) this.#runtimes.delete(botId);
    this.#pxStopUncertain.delete(botId);
  }`
const failedStart = `try {
        await runtime.stop({ preserveError: true });
        if (this.#runtimes.get(config.id) === runtime) this.#runtimes.delete(config.id);
        this.#pxStopUncertain.delete(config.id);
      } catch { this.#pxStopUncertain.add(config.id); }
      throw error;`

const restoreService = `
  async restoreInbound(botId, options = {}) {
    const id = botIdOf(botId);
    cancellation(options.signal);
    if (!/^[a-f0-9]{64}$/.test(options.expectedFingerprint ?? '') || typeof options.expectedRevision !== 'string')
      throw deliveryError('bad-request');
    const registration = await this.#checkedRegistrationFor(id);
    if (typeof registration.adapter.restoreInbound !== 'function') throw deliveryError('capability-unavailable');
    this.#assertRegistered(registration);
    const signal = options.signal ? AbortSignal.any([options.signal, registration.controller.signal]) : registration.controller.signal;
    // Keep errors and their codes: the UI distinguishes stale state, active ownership and connection failure.
    const result = await registration.adapter.restoreInbound(id, { ...options, signal });
    this.#assertRegistered(registration);
    return result;
  }
`

const validateRpc = `
  if (endpoint === 'bot.reception.describe')
    return hasOnlyKeys(payload, new Set(['botId'])) && safeOpaqueId(payload.botId) ? null : 'A valid botId is required.';
  if (endpoint === 'bot.reception.restore')
    return hasOnlyKeys(payload, new Set(['botId','expectedFingerprint','expectedRevision'])) && safeOpaqueId(payload.botId)
      && /^[a-f0-9]{64}$/.test(payload.expectedFingerprint ?? '') && typeof payload.expectedRevision === 'string'
      && /^[a-f0-9-]{36}$/.test(payload.expectedRevision) ? null : 'Verified account and reception revision are required.';
`
const handleRpc = `
      if (endpoint === 'bot.reception.describe') {
        const description = await controller.describeDeliveryAccount(payload.botId);
        value = { botId: description.botId, fingerprint: description.account.fingerprint,
          connected: description.connected, reception: description.reception };
      } else if (endpoint === 'bot.reception.restore') {
        await controller.restoreInbound(payload.botId, { expectedFingerprint: payload.expectedFingerprint,
          expectedRevision: payload.expectedRevision, signal });
        value = { restored: true };
      } else `

function renamed(code: string, names: Record<string, string>): string {
  // Longest names first; every template identifier has an explicit mapping for the fixed bundle.
  for (const [from, to] of Object.entries(names).sort(([a], [b]) => b.length - a.length))
    code = code.replaceAll(from, to)
  return code
}

export function patchImModule(file: keyof typeof source.files, original: string): string {
  if (createHash('sha256').update(original).digest('hex') !== source.files[file])
    throw Error('IM community source hash mismatch: ' + file)
  let code = original
  const replace = (from: string, to: string) => {
    if (code.split(from).length !== 2)
      throw Error('IM compatibility anchor mismatch: ' + file + ': ' + from.slice(0, 80))
    code = code.replace(from, to)
  }
  if (file === 'src/channels/feishu/multi-bot-controller.mjs') {
    code = "import { randomUUID as pxModeRevisionId } from 'node:crypto';\n" + code
    replace(
      '  async describeDeliveryAccount(botId) {',
      controllerMethods + '\n  async describeDeliveryAccount(botId) {'
    )
    replace(
      'connected: isConnected(connectionStatus(this.#runtimes.get(botId))),',
      'reception: this.pxReceptionState(botId),\n        connected: isConnected(connectionStatus(this.#runtimes.get(botId))),'
    )
    replace(
      "capabilities: ['proactive-text-checked'",
      "capabilities: ['consumer-mode-control-px1', 'proactive-text-checked'"
    )
    replace(
      'async consumeInbound(botId, { expectedFingerprint, onEvent, signal } = {})',
      'async consumeInbound(botId, { expectedFingerprint, expectedRevision, onEvent, signal } = {})'
    )
    replace(
      'async #stopRuntime(botId) {\n    const runtime = this.#runtimes.get(botId);\n    this.#runtimes.delete(botId);\n    if (runtime) await runtime.stop();\n  }',
      stopRuntime
    )
    replace(
      'if (this.#runtimes.get(config.id) === runtime) this.#runtimes.delete(config.id);\n      await runtime.stop({ preserveError: true }).catch(() => undefined);\n      throw error;',
      failedStart
    )
    replace(
      'const dispose = this.#inboundConsumers.register(botId, { fingerprint: expectedFingerprint, onEvent, signal });',
      "if (expectedRevision !== undefined && expectedRevision !== this.pxReceptionState(botId).revision) throw Object.assign(new Error('consumer-state-changed'), { code: 'consumer-state-changed' });\n      const dispose = this.#inboundConsumers.register(botId, { fingerprint: expectedFingerprint, onEvent, signal });\n      this.#pxConsumerRevisions.set(botId, pxModeRevisionId());"
    )
  } else if (file === 'src/channels/feishu/external-consumer.mjs') {
    replace(
      '  signalFor(botId, fingerprint) {',
      '  pxHas(botId) { return this.#entries.has(botId); }\n\n  signalFor(botId, fingerprint) {'
    )
  } else if (file === 'plugin-src/host/delivery-service.mjs') {
    replace(
      '  async consumeInbound(botId, options = {}) {',
      restoreService + '\n  async consumeInbound(botId, options = {}) {'
    )
  } else if (file === 'plugin-src/host/delivery-adapter.mjs') {
    replace(
      '    consumeInbound: (botId, options) => {',
      `    restoreInbound: (botId, options) => {
      if (typeof coreController.restoreInbound !== 'function') throw Object.assign(new Error('capability-unavailable'), { code: 'capability-unavailable' });
      return coreController.restoreInbound(botId, options);
    },
    consumeInbound: (botId, options) => {`
    )
  } else if (file === 'plugin-src/host/index.mjs') {
    replace(
      '          inboundVersion: 1,',
      '          inboundVersion: 1,\n          pxModeControlVersion: 1,\n          restoreInbound: (botId, options) => deliveryService.restoreInbound(botId, options),'
    )
  } else if (file === 'plugin-src/host/channels/feishu/rpc.mjs') {
    replace(
      "  reconnectBot: 'bot.reconnect',",
      "  receptionDescribe: 'bot.reception.describe',\n  receptionRestore: 'bot.reception.restore',\n  reconnectBot: 'bot.reconnect',"
    )
    replace(
      '  if (endpoint === FEISHU_MULTI_ENDPOINTS.reconnectBot) {',
      validateRpc + '\n  if (endpoint === FEISHU_MULTI_ENDPOINTS.reconnectBot) {'
    )
    replace(
      '      if (endpoint === FEISHU_ENDPOINTS.status) {',
      handleRpc + 'if (endpoint === FEISHU_ENDPOINTS.status) {'
    )
  } else if (file === 'plugin-src/client/channels/feishu/index.js') {
    code = "import { ImReceptionPanel } from './px-reception.js';\n" + code
    replace(
      'export function BotCard({\n  connection,',
      'export function BotCard({\n  receptionInvoke,\n  connection,'
    )
    replace(
      '        h(WorkspaceEditor, {',
      '        h(ImReceptionPanel, { botId: connection.botId, invoke: receptionInvoke }),\n        h(WorkspaceEditor, {'
    )
    replace(
      '          connection: bot,',
      '          connection: bot,\n          receptionInvoke: props.receptionInvoke,'
    )
    replace(
      '                  bots: model.bots,',
      '                  bots: model.bots,\n                  receptionInvoke: invoke,'
    )
  } else if (file === 'lib/index.js') {
    code = "import { randomUUID as pxModeRevisionId } from 'node:crypto';\n" + code
    replace(
      'async describeDeliveryAccount(t){',
      renamed(controllerMethods, {
        '#requireBot': '#m',
        '#inboundConsumers': '#p',
        '#assertOpen': '#R',
        '#serializeConfig': '#T',
        '#withBotTransition': '#L',
        '#deliveryAccount': '#B',
        '#credentials': '#r',
        '#runtimes': '#o',
        '#stopRuntime': '#k',
        '#touch': '#F',
        '#configStore': '#a',
        '#startRuntime': '#b'
      }) + 'async describeDeliveryAccount(t){'
    )
    replace(
      'account:a,connected:Qg(mc(this.#o.get(t))),capabilities:["proactive-text-checked"',
      'account:a,reception:this.pxReceptionState(t),connected:Qg(mc(this.#o.get(t))),capabilities:["consumer-mode-control-px1","proactive-text-checked"'
    )
    replace(
      'let r=this.#p.register(t,{fingerprint:o,onEvent:a,signal:e});try{',
      'if(pxExpectedRevision!==undefined&&pxExpectedRevision!==this.pxReceptionState(t).revision)throw Object.assign(new Error("consumer-state-changed"),{code:"consumer-state-changed"});let r=this.#p.register(t,{fingerprint:o,onEvent:a,signal:e});this.#pxConsumerRevisions.set(t,pxModeRevisionId());try{'
    )
    replace(
      'async consumeInbound(t,{expectedFingerprint:o,onEvent:a,signal:e}={})',
      'async consumeInbound(t,{expectedFingerprint:o,expectedRevision:pxExpectedRevision,onEvent:a,signal:e}={})'
    )
    replace(
      'async#k(t){let o=this.#o.get(t);this.#o.delete(t),o&&await o.stop()}',
      renamed(stopRuntime, { '#stopRuntime': '#k', '#runtimes': '#o', '#touch': '#F' })
    )
    replace(
      'throw this.#o.get(t.id)===a&&this.#o.delete(t.id),await a.stop({preserveError:!0}).catch(()=>{}),e',
      renamed(failedStart, {
        '#runtimes': '#o',
        'runtime.': 'a.',
        'config.': 't.',
        '=== runtime': '=== a',
        'throw error;': 'throw e;'
      })
    )
    replace(
      'signalFor(t,o){let a=this.#e.get(t);',
      'pxHas(botId){return this.#e.has(botId)}signalFor(t,o){let a=this.#e.get(t);'
    )
    replace(
      'async consumeInbound(t,o={}){let a=aa(t);',
      renamed(restoreService, {
        'botIdOf(': 'aa(',
        'cancellation(': 'cI(',
        'deliveryError(': 'cA(',
        '#checkedRegistrationFor': '#r',
        '#assertRegistered': '#A'
      }) + 'async consumeInbound(t,o={}){let a=aa(t);'
    )
    replace(
      'consumeInbound:(s,c)=>{if(typeof o.consumeInbound',
      'restoreInbound:(botId,options)=>{if(typeof o.restoreInbound!=="function")throw Object.assign(new Error("capability-unavailable"),{code:"capability-unavailable"});return o.restoreInbound(botId,options)},consumeInbound:(s,c)=>{if(typeof o.consumeInbound'
    )
    // The provider's minified local service name is checked together with the whole archive hash.
    const marker = 'contractVersion:1,receiptVersion:1,inboundVersion:1,consumeInbound:'
    const at = code.indexOf(marker)
    if (at < 0 || code.indexOf(marker, at + 1) >= 0) throw Error('IM provider anchor mismatch')
    const tail = code.slice(at + marker.length, at + marker.length + 120)
    const match = tail.match(/^\((\w+),(\w+)\)=>(\w+)\.consumeInbound\(\1,\2\)/)
    if (!match) throw Error('IM provider service binding mismatch')
    replace(
      marker,
      `contractVersion:1,receiptVersion:1,inboundVersion:1,pxModeControlVersion:1,restoreInbound:(botId,options)=>${match[3]}.restoreInbound(botId,options),consumeInbound:`
    )
    replace(
      'var Zp=Object.freeze({reconnectBot:',
      'var Zp=Object.freeze({receptionDescribe:"bot.reception.describe",receptionRestore:"bot.reception.restore",reconnectBot:'
    )
    replace(
      'if(n===Zp.reconnectBot)',
      renamed(validateRpc, {
        endpoint: 'n',
        payload: 't',
        hasOnlyKeys: '_a',
        safeOpaqueId: 'Xa'
      }) + 'if(n===Zp.reconnectBot)'
    )
    replace(
      'if(A===Lt.status)g=await pr(await n.status(),{encodeQr:i});',
      renamed(handleRpc, {
        endpoint: 'A',
        payload: 'r',
        controller: 'n',
        'value =': 'g =',
        'signal });': 'signal:s });'
      }) + 'if(A===Lt.status)g=await pr(await n.status(),{encodeQr:i});'
    )
  } else throw Error('Unknown IM compatibility module: ' + file)
  return code
}
