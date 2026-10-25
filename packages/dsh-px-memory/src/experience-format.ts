import { MemoryError } from './store'

/** Construct a real Skill file; prose wrappers from a model must not own the file contract. */
export async function skillDraftContent(
  name: string,
  value: { description: string; body: string },
  previousFrontmatter?: string
) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 64 ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    value.description.length > 500 ||
    typeof value.body !== 'string' ||
    !value.body.trim() ||
    value.body.length > 14000
  )
    throw new MemoryError('Skill 描述或正文无效，未保存草稿', 422)
  const { parse, stringify } = await import('yaml')
  const metadata = previousFrontmatter === undefined ? { 'dsh-px-managed': true } : parse(previousFrontmatter)
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new MemoryError('原 Skill 元数据不可读取，未重建或覆盖', 409)
  // Preserve invocation flags and other user metadata when updating an existing Skill.
  const content =
    '---\n' +
    stringify({ ...metadata, name, description: value.description.trim() }) +
    '---\n\n' +
    value.body.trim() +
    '\n'
  if (content.length > 16000) throw new MemoryError('Skill 草稿过长，未保存', 422)
  return content
}
