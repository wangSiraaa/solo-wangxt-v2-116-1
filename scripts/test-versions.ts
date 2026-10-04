import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.DOMParser = dom.window.DOMParser
globalThis.document = dom.window.document

import { buildPerformancePath, parseMusicXml } from '../src/score/parser'
import { fullSampleXml } from '../src/score/samples'
import {
  activeVersionOf,
  appendVersion,
  createProject,
  exportProject,
  normalizeProject,
  parseProjectBundle,
} from '../src/storage/projects'
import type { LegacyProjectExport, RehearsalMark, StoredProject } from '../src/score/types'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function makeMark(measureIndex: number, occurrence: number, label: string): RehearsalMark {
  return {
    id: crypto.randomUUID(),
    measureIndex,
    occurrence,
    label,
    comment: '',
    color: '#f4b942',
    createdAt: new Date().toISOString(),
  }
}

function pathNumbers(xml: string): string[] {
  return buildPerformancePath(parseMusicXml(xml)).steps.map((step) => step.measureNumber)
}

// 含反复的三小节曲：v1 有后反复（1,2,1,2,3），v2 去掉反复（1,2,3）
function repeatXml(withRepeat: boolean): string {
  const barline = withRepeat
    ? '<barline location="right"><barline-style>light-heavy</barline-style><repeat direction="backward" times="1"/></barline>'
    : ''
  const body = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>'
  return `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">${body}</measure>
    <measure number="2">${body}${barline}</measure>
    <measure number="3">${body}</measure>
  </part>
</score-partwise>`
}

// 1) 只改排版的新版：两版可分别打开，标记互不覆盖，且不自动迁移
const baseXml = fullSampleXml()
const layoutOnlyXml = baseXml.replace('<measure number="3">', '<measure number="3"><print new-system="yes"/>')
assert(layoutOnlyXml !== baseXml, '排版变体应与原 XML 不同')

const layoutProject = createProject('排版对比', baseXml)
const layoutV1 = layoutProject.versions[0]
layoutV1.marks.push(makeMark(4, 2, 'A2'))
const layoutV2 = appendVersion(layoutProject, '版本 2', layoutOnlyXml)

assert(layoutProject.versions.length === 2, '应有两个版本')
assert(layoutProject.activeVersionId === layoutV2.id, '新版本应成为当前版本')
assert(JSON.stringify(pathNumbers(baseXml)) === JSON.stringify(pathNumbers(layoutOnlyXml)), '只改排版不应改变演奏路径')
assert(layoutV1.marks.length === 1 && layoutV1.marks[0].label === 'A2', '旧版标记应原样保留')
assert(layoutV2.marks.length === 0, '新版本不应自动迁入旧标记')
assert(activeVersionOf(layoutProject).id === layoutV2.id, 'activeVersionOf 应返回当前版本')

// 2) 反复路径不同的新版：旧版“第二次到达”标记保持在自己的版本与路径上
const repeatProject = createProject('反复对比', repeatXml(true))
const repeatV1 = repeatProject.versions[0]
assert(JSON.stringify(pathNumbers(repeatV1.originalXml)) === JSON.stringify(['1', '2', '1', '2', '3']), 'v1 应演奏两遍小节 2')
const secondArrivalMark = makeMark(1, 2, '第二次到达')
repeatV1.marks.push(secondArrivalMark)

const repeatV2 = appendVersion(repeatProject, '无反复版', repeatXml(false))
assert(JSON.stringify(pathNumbers(repeatV2.originalXml)) === JSON.stringify(['1', '2', '3']), 'v2 不应有反复')
const kept = repeatV1.marks[0]
assert(kept.measureIndex === 1 && kept.occurrence === 2, '旧版“第二次到达”标记不应被改写')
assert(repeatV2.marks.length === 0, '新版不应继承旧标记')
const v1Path = buildPerformancePath(parseMusicXml(repeatV1.originalXml))
assert(
  v1Path.arrivals.find((item) => item.measureIndex === kept.measureIndex)?.occurrences.includes(kept.occurrence ?? 0) === true,
  '旧版标记在其自身路径中仍应可定位',
)

// 3) 无效 XML 被拒：工程对象不被改动，当前版本仍可分析
const beforeReject = JSON.stringify(repeatProject)
let rejected = false
try {
  parseMusicXml('<score-partwise><part><measure>')
} catch {
  rejected = true
}
assert(rejected, '截断的 XML 应被解析器拒绝')
let wrongRoot = false
try {
  parseMusicXml('<html><body>not musicxml</body></html>')
} catch {
  wrongRoot = true
}
assert(wrongRoot, '非 score-partwise 的 XML 应被拒绝')
assert(JSON.stringify(repeatProject) === beforeReject, '拒绝无效 XML 后工程应保持不变')
assert(pathNumbers(activeVersionOf(repeatProject).originalXml).length === 3, '当前工程应仍可继续分析')

// 4) 现有单版本工程（旧形状）仍可打开，标记迁入“版本 1”
const legacyProject = {
  id: 'legacy-id',
  name: '旧工程',
  originalXml: baseXml,
  marks: [makeMark(2, 1, '旧标记')],
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const migrated = normalizeProject(JSON.parse(JSON.stringify(legacyProject)))
assert(migrated.id === 'legacy-id', '迁移应保留工程 id')
assert(migrated.versions.length === 1, '旧工程应迁移为单版本')
assert(migrated.versions[0].originalXml === baseXml, '迁移应保留原 XML')
assert(migrated.versions[0].marks.length === 1 && migrated.versions[0].marks[0].label === '旧标记', '迁移应保留标记')
assert(migrated.activeVersionId === migrated.versions[0].id, '迁移后当前版本应指向唯一版本')

// 5) 工程包导出再导入：版本与当前选择都保留
const bundleText = JSON.stringify(exportProject(repeatProject))
const restored = parseProjectBundle(bundleText)
assert(restored.id !== repeatProject.id, '导入应生成新工程 id')
assert(restored.versions.length === 2, '工程包应保留全部版本')
assert(restored.activeVersionId === repeatProject.activeVersionId, '工程包应保留当前版本选择')
assert(restored.versions[0].id === repeatV1.id && restored.versions[1].id === repeatV2.id, '版本 id 应保留')
assert(restored.versions[0].marks.length === 1 && restored.versions[0].marks[0].occurrence === 2, '版本各自的标记应保留')
assert(restored.versions[1].originalXml === repeatV2.originalXml, '版本各自的原始 XML 应保留')

// v1 单版本工程包也可导入
const legacyBundle: LegacyProjectExport = { format: 'local-rehearsal-project/v1', project: legacyProject }
const migratedBundle = parseProjectBundle(JSON.stringify(legacyBundle))
assert(migratedBundle.versions.length === 1 && migratedBundle.versions[0].marks.length === 1, 'v1 工程包应迁移为单版本')

// 无效工程包与无效工程数据应报明确的错，而不是猜测
const invalidInputs: Array<[string, unknown]> = [
  ['非 JSON', '{oops'],
  ['未知格式', { format: 'something-else', project: {} }],
  ['空工程', { format: 'local-rehearsal-project/v2', project: { name: '空' } }],
]
for (const [label, input] of invalidInputs) {
  let threw = false
  try {
    parseProjectBundle(typeof input === 'string' ? input : JSON.stringify(input))
  } catch {
    threw = true
  }
  assert(threw, `${label} 应被拒绝`)
}

// normalizeProject 对损坏的当前版本选择应回退到第一个版本
const brokenSelection = normalizeProject({
  name: '选择损坏',
  versions: [{ id: 'v1', name: '版本 1', originalXml: baseXml, marks: [] }],
  activeVersionId: 'does-not-exist',
} as Partial<StoredProject>)
assert(brokenSelection.activeVersionId === 'v1', '当前版本选择损坏时应回退到第一个版本')

console.log('版本功能测试全部通过')
console.log(JSON.stringify({
  layoutPath: pathNumbers(layoutOnlyXml),
  repeatV1Path: pathNumbers(repeatV1.originalXml),
  repeatV2Path: pathNumbers(repeatV2.originalXml),
  restoredActiveVersion: restored.activeVersionId,
}, null, 2))
