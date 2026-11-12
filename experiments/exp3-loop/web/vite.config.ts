import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const G = path.resolve(__dirname, '../../exp1/src-genoffice')
// copy of editor/static/workspace/model.js (the dev server cannot read ~/Documents)
const WS = path.resolve(__dirname, 'src/ws')
// @genoffice/<pkg>[/<subpath>] -> package source, from each package.json "exports"
const alias: { find: string | RegExp; replacement: string }[] = []
for (const p of fs.readdirSync(`${G}/packages`)) {
  const pj = `${G}/packages/${p}/package.json`
  if (!fs.existsSync(pj)) continue
  const d = JSON.parse(fs.readFileSync(pj, 'utf8'))
  const ex = typeof d.exports === 'object' ? d.exports : {}
  for (const [k, v] of Object.entries(ex)) {
    if (typeof v !== 'string') continue
    const name = d.name + (k === '.' ? '' : k.slice(1))
    alias.push({ find: new RegExp(`^${name.replace(/[/.]/g, '\\$&')}$`), replacement: path.join(G, 'packages', p, v) })
  }
}
// third-party code outside this folder must resolve bare imports to our node_modules
alias.push({ find: /^(react|react-dom|konva|react-konva|jszip|fast-xml-parser|opentype\.js|bidi-js|utif2|fflate|buffer)(\/.*)?$/, replacement: path.resolve(__dirname, 'node_modules') + '/$1$2' })
alias.push({ find: /^node:crypto$/, replacement: path.resolve(__dirname, 'src/shims/crypto.ts') })
alias.push({ find: /^node:zlib$/, replacement: path.resolve(__dirname, 'src/shims/zlib.ts') })
alias.push({ find: /^@genoffice-slides\/(.*)$/, replacement: `${G}/apps/slides/src/$1` })
alias.push({ find: /^@ws\/(.*)$/, replacement: `${WS}/$1` })

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  server: { fs: { allow: [__dirname, G, WS] }, proxy: { '/api': 'http://127.0.0.1:8790' } },
  define: { 'process.env': {}, 'process.platform': '"darwin"' },
  optimizeDeps: { exclude: ['@genoffice/pptx-engine'] },
})
