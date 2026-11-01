// 从 app 的目录数据生成 tools/import-editor/src/meta.json，
// 保证网页里的病种 / 药名 / 注射部位和 App 完全一致。
//
// 不引入新依赖：用 App 自己 devDependencies 里的 @babel/core + preset-typescript
// 把 src/data/*.ts 转成 JS 再 import，拿到的就是真实目录数据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const babel = require('@babel/core')

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const buildDir = path.join(here, '.build')
fs.mkdirSync(buildDir, { recursive: true })

async function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const { code } = babel.transformSync(source, {
    filename: path.basename(relative),
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve('@babel/preset-typescript'),
        { onlyRemoveTypeImports: true, allowDeclareFields: true },
      ],
    ],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    sourceType: 'module',
    compact: false,
  })
  const outfile = path.join(buildDir, `${path.basename(relative, '.ts')}.cjs`)
  // 目录文件里的 `@/types` 只用于类型，运行时不需要；保险起见把别名替换成空对象。
  const patched = code.replace(/require\("@\/types"\)/g, '{}')
  fs.writeFileSync(outfile, patched, 'utf8')
  return require(outfile)
}

try {
  const diseases = await load('src/data/diseases.ts')
  const catalog = await load('src/data/catalog.ts')
  const rotation = await load('src/domain/rotation.ts')
  const i18n = await load('src/i18n/zh.ts')

  const diseaseOptions = diseases.DISEASES.map((item) => ({
    id: item.id,
    name: item.name,
    group: diseases.DISEASE_GROUPS.find((group) => group.id === item.group)?.name ?? item.group,
  }))

  const drugsByDisease = {}
  for (const disease of diseaseOptions) {
    drugsByDisease[disease.id] = catalog.drugsForDisease(disease.id).map((item) => ({
      key: item.drug.key,
      name: item.drug.name,
      genericName: item.drug.genericName,
      brandNames: item.drug.brandNames,
      route: item.drug.route,
      defaultDose: item.drug.defaultDose,
      unit: item.drug.unit,
    }))
  }

  const allDrugs = catalog.CATALOG_DRUGS.map((drug) => ({
    key: drug.key,
    name: drug.name,
    genericName: drug.genericName,
    brandNames: drug.brandNames,
    route: drug.route,
    defaultDose: drug.defaultDose,
    unit: drug.unit,
  }))

  const sites = Object.entries(rotation.SITE_LABELS).map(([value, label]) => ({ value, label }))

  const output = {
    diseaseOptions,
    drugsByDisease,
    allDrugs,
    sites,
    defaultSymptomTags: [...i18n.DEFAULT_SYMPTOM_TAGS],
  }

  const srcDir = path.join(here, '..', 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  const metaJson = JSON.stringify(output, null, 2)
  fs.writeFileSync(path.join(srcDir, 'meta.json'), metaJson, 'utf8')
  // meta.js 让工具用 file:// 直接打开也能读到数据（fetch 本地 JSON 会被浏览器拦）。
  fs.writeFileSync(
    path.join(srcDir, 'meta.js'),
    `// 由 scripts/generate-meta.mjs 生成，请勿手改。\nwindow.BIOCLOCK_META = ${metaJson}\n`,
    'utf8',
  )
  console.log(
    `meta.json / meta.js 已生成：${diseaseOptions.length} 个病种、${allDrugs.length} 种药、${sites.length} 个注射部位、${output.defaultSymptomTags.length} 个默认症状`,
  )
} finally {
  fs.rmSync(buildDir, { recursive: true, force: true })
}
