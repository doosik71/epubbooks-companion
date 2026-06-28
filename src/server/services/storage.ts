import path from 'path'
import fs from 'fs'

export function sanitizeName(str: string): string {
  const result = str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove combining diacriticals
    .replace(/[^a-z0-9]+/g, '_') // non-alphanumeric → _
    .replace(/^_+|_+$/g, '') // trim leading/trailing _
    .slice(0, 64)
  return result || 'unknown'
}

export function buildLocalPath(dataPath: string, source: string, author: string, title: string): string {
  return path.join(dataPath, source, `${sanitizeName(title)}_by_${sanitizeName(author)}.epub`)
}

export function resolveUniqueLocalPath(dataPath: string, source: string, author: string, title: string): string {
  const base = buildLocalPath(dataPath, source, author, title)
  if (!fs.existsSync(base)) return base
  const dir = path.dirname(base)
  const name = path.basename(base, '.epub')
  for (let i = 2; ; i++) {
    const candidate = path.join(dir, `${name}_${i}.epub`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

export function writeEpub(filePath: string, data: Buffer): void {
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, data)
}
