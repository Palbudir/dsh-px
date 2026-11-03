/** Shared native tools for a caller whose persona and conversation audience have already been verified. */
export const CONVERSATION_MEMORY_DEFINITIONS = [
  {
    name: 'channel_memory',
    description:
      '读取和保存当前人格在本交流范围的有来源经历；不读取其他人格或其他场合。回忆与建议不是用户授权或独立验证。',
    properties: {
      action: { type: 'string', enum: ['catalog', 'search', 'read', 'save', 'feedback'] },
      query: { type: 'string', maxLength: 256 },
      id: { type: 'string', maxLength: 300 },
      topic: { type: 'string', maxLength: 90 },
      text: { type: 'string', maxLength: 4000 },
      revision: { type: 'string', maxLength: 128 },
      offset: { type: 'integer', minimum: 0 },
      cursor: { type: 'string', maxLength: 4096 },
      documentRevision: { type: 'integer' },
      kind: { type: 'string', enum: ['confirmed', 'useful', 'not-applicable', 'disputed'] },
      reason: { type: 'string', maxLength: 1000 },
      evidence: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sessionId', 'seq'],
          properties: { sessionId: { type: 'string', maxLength: 200 }, seq: { type: 'integer', minimum: 0 } }
        }
      }
    },
    required: ['action']
  },
  {
    name: 'channel_knowledge',
    description: '只读当前交流范围或全局共享知识，不访问人格私有资料。',
    properties: {
      scope: { type: 'string', enum: ['project', 'global'] },
      query: { type: 'string', maxLength: 256 },
      id: { type: 'string', maxLength: 300 }
    },
    required: ['scope']
  }
]
