// 构建浏览器半：esbuild 打包为 CJS，再包成 window.__ModuleLoader__.load({id, factory}) 格式
// （与 client-modules 系统约定一致；react 等由模块图提供，保持外部化）。
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  write: false,
  minify: false,
  target: 'es2020',
})
const code = result.outputFiles[0].text
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-work-anywhere",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  code,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
writeFileSync('lib/client.js', wrapped)
console.log('client bundle written:', wrapped.length, 'bytes')
