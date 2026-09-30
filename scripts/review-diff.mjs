import { parseReviewSource } from './review-parser.mjs'

/**
 * Line diff and review units for the independent reviewer. Pure: text in, units out.
 * Modified files become unified-diff hunks (git diff semantics, with context lines and the
 * enclosing declaration as label), added files are complete numbered text, and deleted files are
 * their complete numbered merge-base text marked removed, with an inventory line (size, lines,
 * declared names).
 */
export const DIFF_CONTEXT_LINES = 5
/** Myers edit bound per segment; beyond it unique-line anchors split the segment (patience). */
export const DIFF_MAX_EDITS = 1500
const ANCHOR_DEPTH = 8
const LABEL_CHARS = 160
const LABEL_SEARCH_LINES = 4000
export const MAX_DECLARATION_NAMES = 400
/** Largest removed file shown inline (split across batches); a larger one needs separate review. */
export const MAX_DELETED_BYTES = 2 * 1024 * 1024
const NO_EOL = '\0no-eol'

export function splitLines(text) {
  if (text === '') return { lines: [], finalNewline: true }
  const lines = text.split('\n')
  const finalNewline = lines.at(-1) === ''
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}

/** Minimal edit script by Myers' O(ND) algorithm; null when more than `limit` edits are needed. */
function myers(a, b, limit) {
  const n = a.length,
    m = b.length,
    max = n + m,
    offset = max + 1
  const v = new Int32Array(2 * max + 3),
    trace = []
  for (let d = 0; d <= Math.min(max, limit); d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) (x++, y++)
      v[offset + k] = x
      if (x >= n && y >= m) {
        const ops = []
        let cx = n,
          cy = m
        for (let step = trace.length - 1; step >= 0; step--) {
          const snapshot = trace[step],
            at = (index) => snapshot[index + step + 1],
            ck = cx - cy
          const previous = ck === -step || (ck !== step && at(ck - 1) < at(ck + 1)) ? ck + 1 : ck - 1
          const px = at(previous),
            py = px - previous
          while (cx > px && cy > py) (ops.push(' '), cx--, cy--)
          if (step > 0) ops.push(cx === px ? '+' : '-')
          cx = px
          cy = py
        }
        return ops.reverse()
      }
    }
  }
  return null
}

/** Patience anchors: lines unique on both sides, longest increasing chain. */
function anchors(a, b) {
  const count = (lines) => {
    const map = new Map()
    lines.forEach((line, index) => {
      const entry = map.get(line)
      if (entry) entry.n++
      else map.set(line, { n: 1, index })
    })
    return map
  }
  const left = count(a),
    right = count(b),
    pairs = []
  for (const [line, entry] of left) {
    const other = right.get(line)
    if (entry.n === 1 && other?.n === 1) pairs.push([entry.index, other.index])
  }
  pairs.sort((x, y) => x[0] - y[0])
  const tails = [],
    links = new Array(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0,
      hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1
      else hi = mid
    }
    links[i] = lo ? tails[lo - 1] : -1
    tails[lo] = i
  }
  const chain = []
  for (let i = tails.length ? tails.at(-1) : -1; i >= 0; i = links[i]) chain.push(pairs[i])
  return chain.reverse()
}

function diffSegment(a, b, depth) {
  let start = 0,
    endA = a.length,
    endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) (endA--, endB--)
  const ops = new Array(start).fill(' ')
  const middleA = a.slice(start, endA),
    middleB = b.slice(start, endB)
  let middle = myers(middleA, middleB, DIFF_MAX_EDITS)
  if (!middle) {
    const chain = depth < ANCHOR_DEPTH ? anchors(middleA, middleB) : []
    if (!chain.length) middle = [...middleA.map(() => '-'), ...middleB.map(() => '+')]
    else {
      middle = []
      let x = 0,
        y = 0
      for (const [ia, ib] of [...chain, [middleA.length, middleB.length]]) {
        middle.push(...diffSegment(middleA.slice(x, ia), middleB.slice(y, ib), depth + 1))
        if (ia < middleA.length) middle.push(' ')
        x = ia + 1
        y = ib + 1
      }
    }
  }
  for (const op of middle) ops.push(op)
  for (let i = endA; i < a.length; i++) ops.push(' ')
  return ops
}

/** Diff rows with old/new line numbers; verified to reproduce both texts exactly. */
export function diffRows(beforeText, afterText) {
  const before = splitLines(beforeText),
    after = splitLines(afterText)
  const keys = (side) =>
    side.lines.map((line, i) => (i === side.lines.length - 1 && !side.finalNewline ? line + NO_EOL : line))
  const a = keys(before),
    b = keys(after)
  const ops = diffSegment(a, b, 0),
    rows = []
  let i = 0,
    j = 0
  for (const op of ops) {
    if (op === ' ') {
      if (a[i] !== b[j]) throw new Error('Review diff is inconsistent')
      rows.push({ op, old: i + 1, new: j + 1, at: j, text: before.lines[i], noEol: a[i].endsWith(NO_EOL) })
      ;(i++, j++)
    } else if (op === '-') {
      rows.push({ op, old: i + 1, at: j, text: before.lines[i], noEol: a[i].endsWith(NO_EOL) })
      i++
    } else {
      rows.push({ op, new: j + 1, at: j, text: after.lines[j], noEol: b[j].endsWith(NO_EOL) })
      j++
    }
  }
  if (i !== a.length || j !== b.length) throw new Error('Review diff does not cover both texts')
  const rebuild = (keep) =>
    rows
      .filter((row) => row.op === ' ' || row.op === keep)
      .map((row) => row.text + '\n')
      .join('')
  const trim = (text, side) => (side.finalNewline || !side.lines.length ? text : text.slice(0, -1))
  if (trim(rebuild('-'), before) !== beforeText || trim(rebuild('+'), after) !== afterText)
    throw new Error('Review diff does not reproduce the source texts')
  return { rows, before, after }
}

const indent = (line) => /^[\t ]*/.exec(line)[0].replace(/\t/g, '  ').length
const CODE_LABEL =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\b|class\s|interface\s|type\s+[\w$]+\s*[=<]|enum\s|namespace\s|module\s|(?:const|let|var)\s+[\w$]+\s*[:=])|^\s*(?:test|it|describe|suite)\s*\(|^\s*(?:(?:public|private|protected|static|async|get|set|readonly|override)\s+)*[\w$#]+\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::[^=;]*)?\{\s*$|^\s*[\w$]+\s*:\s*(?:async\s+)?(?:function\b|\()/
const CONTROL = /^\s*(?:if|for|while|switch|catch|return|else|do|try|with|await|new|throw)\b/
const DOC_LABEL = /^#{1,6}\s+\S/
const DATA_LABEL = /^\s*(?:"[^"]+"|[\w$.-]+)\s*:\s*(?:[[{]\s*)?$|^\s*-?\s*(?:name|id|on|jobs)\s*:/
function labelRule(path) {
  if (/\.(?:md|markdown)$/i.test(path)) return (line) => DOC_LABEL.test(line)
  if (/\.(?:json|ya?ml)$/i.test(path)) return (line) => DATA_LABEL.test(line)
  return (line) => CODE_LABEL.test(line) && !CONTROL.test(line)
}

/** Nearest enclosing declaration line above `at` (git diff funcname semantics, indentation-aware). */
export function enclosingLabel(path, lines, at, changed) {
  const rule = labelRule(path),
    depth = changed === undefined ? Infinity : indent(changed)
  for (let i = Math.min(at, lines.length) - 1; i >= 0 && i >= at - LABEL_SEARCH_LINES; i--) {
    const line = lines[i]
    if (!line.trim() || !rule(line)) continue
    const own = indent(line)
    if (own < depth || (depth === 0 && own === 0)) return line.trim().replace(/\r$/, '').slice(0, LABEL_CHARS)
  }
  return undefined
}

/** A trailing CR is shown as U+240D; a literal U+240D is doubled, so rendering is reversible. */
const visible = (text) => text.replace(/\u240d/g, '\u240d\u240d').replace(/\r$/, '\u240d')
const width = (count) => String(Math.max(1, count)).length

/** Unified hunks: each carries line ranges (0-based, end exclusive) and a numbered body. */
export function diffHunks(path, beforeText, afterText, context = DIFF_CONTEXT_LINES) {
  const { rows, before, after } = diffRows(beforeText, afterText)
  const changes = []
  rows.forEach((row, index) => row.op !== ' ' && changes.push(index))
  if (!changes.length) return []
  const oldAt = [0],
    newAt = [0]
  for (const row of rows) {
    oldAt.push(oldAt.at(-1) + (row.old !== undefined ? 1 : 0))
    newAt.push(newAt.at(-1) + (row.new !== undefined && row.op !== '-' ? 1 : 0))
  }
  const groups = []
  for (const index of changes) {
    const last = groups.at(-1)
    if (last && index - last.last <= 2 * context) last.last = index
    else groups.push({ first: index, last: index })
  }
  const pad = Math.max(width(before.lines.length), width(after.lines.length))
  const number = (value) => (value === undefined ? '' : String(value)).padStart(pad)
  return groups.map(({ first, last }) => {
    const from = Math.max(0, first - context),
      to = Math.min(rows.length, last + context + 1)
    const oldFrom = oldAt[from],
      oldCount = oldAt[to] - oldFrom,
      newFrom = newAt[from],
      newCount = newAt[to] - newFrom
    const firstChange = rows[first]
    const label =
      enclosingLabel(path, after.lines, firstChange.at, firstChange.text) ??
      enclosingLabel(path, before.lines, (firstChange.old ?? oldFrom + 1) - 1, firstChange.text)
    const range = (start, count) => `${count ? start + 1 : start},${count}`
    const body = []
    for (const row of rows.slice(from, to)) {
      body.push(
        `${number(row.old)} ${number(row.op === '-' ? undefined : row.new)} ${row.op}${visible(row.text)}`
      )
      if (row.noEol) body.push('\\ No newline at end of file')
    }
    return {
      before: [oldFrom, oldFrom + oldCount, before.lines.length],
      after: [newFrom, newFrom + newCount, after.lines.length],
      header: `@@ -${range(oldFrom, oldCount)} +${range(newFrom, newCount)} @@${label ? ' ' + label : ''}`,
      label: label ?? null,
      pad,
      body: body.join('\n')
    }
  })
}

const NO_EOL_MARK = '\\ No newline at end of file'
const unvisible = (text) => {
  const run = /\u240d*$/.exec(text)[0].length,
    cr = run % 2 === 1
  return (cr ? text.slice(0, -1) : text).replace(/\u240d\u240d/g, '\u240d') + (cr ? '\r' : '')
}

/**
 * Rebuild the head text of one file from exactly the unit bodies the model is shown and the
 * merge-base text (the reviewer-visible, possibly masked, "before" side). Any diff defect,
 * dropped hunk or lost piece makes this differ from the head text, so coverage fails closed.
 */
export function rebuildAfter(before, units) {
  if (!units.length) throw new Error('No review units')
  const kind = units[0].kind
  if (units.some((unit) => unit.kind !== kind)) throw new Error('Mixed review unit kinds')
  if (kind === 'mode') return before
  const parseRows = (body, pad, numberedHunk) => {
    const rows = [],
      pattern = numberedHunk
        ? new RegExp(`^([ \\d]{${pad}}) ([ \\d]{${pad}}) ([ +-])(.*)$`, 's')
        : new RegExp(`^([ \\d]{${pad}}) (.*)$`, 's')
    for (const line of body.split('\n')) {
      if (line === NO_EOL_MARK) {
        if (!rows.length) throw new Error('Misplaced end-of-file marker')
        rows.at(-1).noEol = true
        continue
      }
      const match = pattern.exec(line)
      if (!match) throw new Error('Unparseable review unit row')
      rows.push(
        numberedHunk
          ? { old: match[1].trim(), new: match[2].trim(), op: match[3], text: unvisible(match[4]) }
          : { new: match[1].trim(), op: '+', text: unvisible(match[2]) }
      )
    }
    return rows
  }
  const join = (lines, finalNewline) => (lines.length ? lines.join('\n') + (finalNewline ? '\n' : '') : '')
  if (kind === 'deleted') {
    // The shown rows must be the complete merge-base text, each marked removed.
    if (units.length !== 1) throw new Error('Deleted file must be one unit')
    const shown =
      units[0].body === '(empty file)'
        ? ''
        : join(
            ...(() => {
              const rows = parseRows(units[0].body, width(units[0].before[2]), false)
              rows.forEach((row, i) => {
                if (Number(row.new) !== i + 1 || !row.text.startsWith('-'))
                  throw new Error('Deleted file rows are not contiguous')
              })
              return [rows.map((row) => row.text.slice(1)), !rows.at(-1)?.noEol]
            })()
          )
    if (shown !== before) throw new Error('Deleted file rows do not reproduce the merge-base text')
    return ''
  }
  if (kind === 'added') {
    if (units.length !== 1) throw new Error('Added file must be one unit')
    if (units[0].body === '(empty file)') return ''
    const rows = parseRows(units[0].body, width(units[0].after[2]), false)
    rows.forEach((row, i) => {
      if (Number(row.new) !== i + 1) throw new Error('Added file rows are not contiguous')
    })
    return join(
      rows.map((row) => row.text),
      !rows.at(-1)?.noEol
    )
  }
  const old = splitLines(before),
    out = []
  let cursor = 0,
    finalNewline = old.finalNewline,
    touchedEnd = false
  const sorted = [...units].sort((a, b) => a.index - b.index)
  sorted.forEach((unit, index) => {
    if (unit.index !== index || unit.count !== units.length) throw new Error('Review hunks are incomplete')
    const body = unit.body.startsWith('MODE CHANGE ')
      ? unit.body.slice(unit.body.indexOf('\n') + 1)
      : unit.body
    const rows = parseRows(body, unit.pad, true)
    if (unit.before[0] < cursor) throw new Error('Review hunks overlap')
    while (cursor < unit.before[0]) out.push(old.lines[cursor++])
    for (const row of rows) {
      if (row.op !== '+') {
        if (Number(row.old) !== cursor + 1 || old.lines[cursor] !== row.text)
          throw new Error('Review hunk does not match the merge-base text')
        cursor++
      }
      if (row.op !== '-') out.push(row.text)
      if (row.noEol && row.op !== '-') finalNewline = false
    }
    if (cursor !== unit.before[1]) throw new Error('Review hunk range is inconsistent')
    if (cursor === old.lines.length) touchedEnd = true
  })
  while (cursor < old.lines.length) out.push(old.lines[cursor++])
  // A hunk that reaches the old end shows the new end state; otherwise it is unchanged.
  if (touchedEnd) {
    const last = sorted.at(-1)
    const rows = parseRows(
      last.body.startsWith('MODE CHANGE ') ? last.body.slice(last.body.indexOf('\n') + 1) : last.body,
      last.pad,
      true
    )
    finalNewline = !rows.some((row) => row.noEol && row.op !== '-')
  }
  return join(out, finalNewline)
}

/** Top-level declared and exported names of a removed source file (names and lines only). */
export function declarationNames(path, text) {
  const names = []
  const add = (name, line) => {
    if (typeof name === 'string' && name && names.length < MAX_DECLARATION_NAMES)
      names.push(`${name.slice(0, 120)}@${line}`)
  }
  if (/\.[cm]?[jt]sx?$/.test(path)) {
    try {
      const ast = parseReviewSource(text, { jsx: /\.[jt]sx$/.test(path), filename: path })
      const bind = (pattern, line) => {
        if (!pattern) return
        if (pattern.type === 'Identifier') add(pattern.name, line)
        else if (pattern.type === 'ObjectPattern')
          for (const item of pattern.properties) bind(item.value ?? item.argument, line)
        else if (pattern.type === 'ArrayPattern') for (const item of pattern.elements) bind(item, line)
        else if (pattern.type === 'AssignmentPattern') bind(pattern.left, line)
        else if (pattern.type === 'RestElement') bind(pattern.argument, line)
      }
      const declare = (node) => {
        const line = node?.loc?.start?.line ?? 0
        if (!node) return
        if (node.type === 'VariableDeclaration') for (const item of node.declarations) bind(item.id, line)
        else if (node.id?.type === 'Identifier') add(node.id.name, line)
        else if (node.id?.type === 'StringLiteral') add(JSON.stringify(node.id.value), line)
      }
      for (const node of ast.program.body) {
        if (node.type === 'ExportNamedDeclaration') {
          declare(node.declaration)
          for (const item of node.specifiers ?? [])
            add(`export ${item.exported?.name ?? item.exported?.value}`, node.loc.start.line)
        } else if (node.type === 'ExportDefaultDeclaration') add('default', node.loc.start.line)
        else if (node.type === 'ExportAllDeclaration')
          add(`export * from ${node.source.value}`, node.loc.start.line)
        else declare(node)
      }
      return { names, source: 'ast', complete: names.length < MAX_DECLARATION_NAMES }
    } catch {
      /* fall through to declaration lines */
    }
  }
  const rule = labelRule(path)
  splitLines(text).lines.forEach((line, index) => {
    if (indent(line) === 0 && line.trim() && rule(line)) add(line.trim().slice(0, 120), index + 1)
  })
  return { names, source: 'declaration-lines', complete: names.length < MAX_DECLARATION_NAMES }
}

function numbered(text, sign = '') {
  const { lines, finalNewline } = splitLines(text)
  if (!lines.length) return '(empty file)'
  const pad = width(lines.length)
  const body = lines.map((line, i) => `${String(i + 1).padStart(pad)} ${sign}${visible(line)}`)
  if (!finalNewline) body.push('\\ No newline at end of file')
  return body.join('\n')
}

/**
 * Review units of one change record. Every unit has `before`/`after` line ranges
 * ([start, end, total], 0-based, end exclusive) and a `body` whose complete UTF-16 range must be
 * covered by the batches of every group that reviews the file.
 */
export function changeUnits(file) {
  if (file.binary) throw new Error(`Binary change requires a separate verified review: ${file.path}`)
  const before = file.before ?? '',
    after = file.after ?? ''
  if (before.includes('\0') || after.includes('\0'))
    throw new Error(`Binary change requires a separate verified review: ${file.path}`)
  const status = file.status ?? (before && !after ? 'deleted' : !before && after ? 'added' : 'modified')
  const beforeLines = splitLines(before).lines.length,
    afterLines = splitLines(after).lines.length
  const mode = file.mode ? `mode ${file.mode[0]} -> ${file.mode[1]}` : null
  if (status === 'added')
    return [
      {
        path: file.path,
        kind: 'added',
        index: 0,
        count: 1,
        before: [0, 0, 0],
        after: [0, afterLines, afterLines],
        header: `added file, complete text (${afterLines} lines)${file.newMode ? `, mode ${file.newMode}` : ''}`,
        body: numbered(after)
      }
    ]
  if (status === 'deleted') {
    // A removal is reviewed like any other change: the complete old text is shown line by line.
    const bytes = file.beforeBytes ?? Buffer.byteLength(before)
    if (bytes > MAX_DELETED_BYTES)
      throw new Error(
        `Deleted file exceeds the inline review limit (${bytes} > ${MAX_DELETED_BYTES} bytes): ${file.path}`
      )
    const declared = declarationNames(file.path, before)
    const inventory = {
      bytes,
      lines: beforeLines,
      oid: file.beforeOid ?? null,
      mode: file.oldMode ?? null,
      declarations: declared.names.slice(0, 60),
      declarationsTotal: declared.names.length
    }
    const units = [
      {
        path: file.path,
        kind: 'deleted',
        index: 0,
        count: 1,
        before: [0, beforeLines, beforeLines],
        after: [0, 0, 0],
        header: `deleted file, complete merge-base text removed (${beforeLines} lines) ${JSON.stringify(inventory)}`,
        body: numbered(before, '-')
      }
    ]
    if (rebuildAfter(before, units) !== '') throw new Error(`Review diff cannot rebuild ${file.path}`)
    return units
  }
  const hunks = diffHunks(file.path, before, after)
  if (!hunks.length) {
    // Git reports the path, but the reviewer-visible texts are identical (e.g. an attribute-only
    // change): one explicit unit keeps coverage complete without inventing a diff.
    if (!mode)
      return [
        {
          path: file.path,
          kind: 'mode',
          index: 0,
          count: 1,
          before: [0, 0, beforeLines],
          after: [0, 0, afterLines],
          header: `no textual or mode difference (${afterLines} lines)`,
          body: 'NO TEXT CHANGE'
        }
      ]
    return [
      {
        path: file.path,
        kind: 'mode',
        index: 0,
        count: 1,
        before: [0, 0, beforeLines],
        after: [0, 0, afterLines],
        header: `${mode}, content identical (${afterLines} lines)`,
        body: `MODE CHANGE ${file.mode[0]} -> ${file.mode[1]}`
      }
    ]
  }
  const units = hunks.map((hunk, index) => ({
    path: file.path,
    kind: 'hunk',
    index,
    count: hunks.length,
    before: hunk.before,
    after: hunk.after,
    label: hunk.label,
    pad: hunk.pad,
    header: `${hunk.header}${index === 0 && mode ? ` [${mode}]` : ''}`,
    body: (index === 0 && mode ? `MODE CHANGE ${file.mode[0]} -> ${file.mode[1]}\n` : '') + hunk.body
  }))
  // The rendered hunks must reproduce the head text byte for byte before they are used.
  if (rebuildAfter(before, units) !== after) throw new Error(`Review diff cannot rebuild ${file.path}`)
  return units
}
