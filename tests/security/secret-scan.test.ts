import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Recursively scan the repository (excluding node_modules, .git, and tests)
function* walk(dir: string): IterableIterator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name)
    if (entry.isDirectory()) {
      // skip large/common vendor and build dirs
      if (['node_modules', '.git', 'tests', 'dist', 'build', '.netlify', 'public', '.next', '.vercel', '.cache'].includes(entry.name)) continue
      yield* walk(res)
    } else {
      yield res
    }
  }
}

test('no service_role or hardcoded environment keys in repo', () => {
  const root = path.resolve(process.cwd())
  const patterns = [/service_role/i, /SERVICE_ROLE/, /service-role/i, /(?:api|secret|private|access|key)[\s_\-:=]{0,4}["'`]?\w{8,}/i]
  const hits: Array<{file:string,line:number,text:string}> = []

  const allowedExt = new Set([
    '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.json', '.env', '.html', '.css', '.scss', '.yml', '.yaml', '.sql', '.sh', '.ps1', '.py', '.rb', '.go', '.rs', '.java', '.xml', '.toml', '.lock'
  ])

  for (const file of walk(root)) {
    // skip vendor/build archives and large binary assets
    const lower = file.toLowerCase()
    if (lower.includes(`${path.sep}node_modules${path.sep}`) || lower.includes(`${path.sep}.netlify${path.sep}`) || lower.includes(`${path.sep}public${path.sep}`)) continue
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.wasm') || lower.endsWith('.map') || lower.endsWith('.zip') || lower.endsWith('.gz') || lower.endsWith('.tar')) continue

    const ext = path.extname(file).toLowerCase()
    if (ext && !allowedExt.has(ext)) continue
    try {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const p of patterns) {
          if (p.test(line)) {
            // ignore legitimate env file references and process.env usages
            if (/\.env/.test(file)) continue
            if (/process\.env/.test(line)) continue
            // skip obvious env name references (we're looking for hardcoded values)
            if (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|APIFY_TOKEN|API_KEY|TOKEN/i.test(line)) continue
            hits.push({ file: path.relative(root, file), line: i + 1, text: line.trim() })
          }
        }
      }
    } catch (err) {
      // ignore unreadable files
    }
  }

  if (hits.length > 0) {
    const lines = hits.slice(0, 20).map(h => `${h.file}:${h.line} -> ${h.text}`)
    throw new Error(`Found possible hardcoded secrets or service_role strings:\n${lines.join('\n')}`)
  }

  expect(hits.length).toBe(0)
})
