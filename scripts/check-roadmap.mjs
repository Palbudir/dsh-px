import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function validateCatalog(catalog) {
  if (
    catalog?.schemaVersion !== 2 ||
    catalog.statusAuthority !== '../ROADMAP.md' ||
    typeof catalog.purpose !== 'string' ||
    !Array.isArray(catalog.features) ||
    !catalog.features.length
  )
    throw new Error(
      'Roadmap catalog must contain version-2 specifications and point to ROADMAP.md for current status'
    )
  const ids = new Set()
  const fields = new Set([
    'id',
    'phase',
    'category',
    'name',
    'priority',
    'utility',
    'difficulty',
    'fit',
    'effort',
    'intro',
    'subtasks',
    'acceptance',
    'route',
    'dependencies'
  ])
  for (const feature of catalog.features) {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature))
      throw new Error('Invalid feature record')
    for (const key of Object.keys(feature))
      if (!fields.has(key)) throw new Error(`Unsupported or stale catalog field: ${key}`)
    for (const key of [
      'id',
      'phase',
      'category',
      'name',
      'priority',
      'effort',
      'intro',
      'acceptance',
      'route'
    ])
      if (typeof feature[key] !== 'string' || !feature[key].trim())
        throw new Error(`Missing feature text: ${key}`)
    if (ids.has(feature.id)) throw new Error(`Duplicate feature ID: ${feature.id}`)
    ids.add(feature.id)
    for (const key of ['utility', 'difficulty', 'fit'])
      if (!Number.isInteger(feature[key]) || feature[key] < 1 || feature[key] > 5)
        throw new Error(`Invalid 1–5 score: ${key}`)
    for (const key of ['subtasks', 'dependencies'])
      if (
        !Array.isArray(feature[key]) ||
        !feature[key].every((value) => typeof value === 'string' && value.trim())
      )
        throw new Error(`Invalid feature list: ${key}`)
  }
  for (const feature of catalog.features)
    for (const id of feature.dependencies)
      if (!ids.has(id) || id === feature.id) throw new Error(`Invalid dependency ${feature.id} -> ${id}`)
  for (const key of ['utility', 'difficulty', 'fit'])
    if (typeof catalog.scoring?.[key] !== 'string') throw new Error(`Missing scoring legend: ${key}`)
  return { features: ids.size }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(validateCatalog(JSON.parse(readFileSync('docs/roadmap/catalog.json', 'utf8')))))
