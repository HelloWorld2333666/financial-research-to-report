import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// GenOffice source fetched by vendor/genoffice/tools/sync.py (pinned commit + our patches)
const G = path.resolve(__dirname, '../../vendor/genoffice/src')
if (!fs.existsSync(path.join(G, '.synced'))) throw new Error('Run: python3 -I vendor/genoffice/tools/sync.py')

const alias: { find: RegExp; replacement: string }[] = []
// @genoffice/<pkg>[/<subpath>] -> package source, from each vendored package.json "exports"
for (const p of fs.readdirSync(path.join(G, 'packages'))) {
  const pj = path.join(G, 'packages', p, 'package.json')
  if (!fs.existsSync(pj)) continue
  const d = JSON.parse(fs.readFileSync(pj, 'utf8'))
  for (const [k, v] of Object.entries<any>(d.exports || {})) {
    if (typeof v !== 'string') continue
    const name = d.name + (k === '.' ? '' : k.slice(1))
    alias.push({ find: new RegExp(`^${name.replace(/[/.]/g, '\\$&')}$`), replacement: path.join(G, 'packages', p, v) })
  }
}
alias.push(
  // vendored files live outside this folder: their bare imports must resolve to our node_modules
  { find: /^(react|react-dom|konva|react-konva|jszip|fast-xml-parser|opentype\.js|bidi-js|utif2|fflate|buffer)(\/.*)?$/, replacement: path.resolve(__dirname, 'node_modules') + '/$1$2' },
  { find: /^node:crypto$/, replacement: path.resolve(__dirname, 'src/platform/shims/crypto.ts') },
  { find: /^node:zlib$/, replacement: path.resolve(__dirname, 'src/platform/shims/zlib.ts') },
  { find: /^@genoffice-slides\/(.*)$/, replacement: `${G}/apps/slides/src/$1` },
)

// GenOffice's editor text in 22 languages is 1.6 MB; the app is English, so its string table resolves to a
// two-language module (src/platform/shims/genoffice-strings.ts). Only locale.tsx's `./strings` import is redirected.
const englishOnlyGenOffice = {
  name: 'genoffice-strings-en-zh',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (source === './strings' && importer && /renderer[\\/]i18n[\\/]locale\.tsx$/.test(importer)) return path.resolve(__dirname, 'src/platform/shims/genoffice-strings.ts')
    return null
  },
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), englishOnlyGenOffice],
  // vitest runs in Node, which has the real node:crypto / node:zlib
  resolve: { alias: mode === 'test' ? alias.filter((a) => !String(a.find).includes('node:')) : alias },
  server: { fs: { allow: [__dirname, G] }, proxy: { '/api': 'http://127.0.0.1:8791' } },
  define: { 'process.env': {}, 'process.platform': '"darwin"' },
  build: { chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}))
