import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.DOMParser = dom.window.DOMParser
globalThis.document = dom.window.document

import { buildPerformancePath, parseMusicXml } from '../src/score/parser'
import { addProjectVersion, createProject, exportProject, importProjectFile, normalizeProject } from '../src/storage/projects'
import { fullSampleXml } from '../src/score/samples'
import type { RehearsalMark, StoredProject } from '../src/score/types'

// crypto.randomUUID 在 Node 19+ 全局可用；低版本回退。
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `id-${Math.random().toString(36).slice(2)}-${Date.now()}` },
  })
}

/** 简单的单声部 8 小节 partwise XML，可选择在 4-5 小节之间加一次后反复。 */
function buildXml(withRepeat: boolean, layoutOnlyNote = false): string {
  const forward = '<barline location="left"><repeat direction="forward"/></barline>'
  const backward = '<barline location="right"><repeat direction="backward" times="1"/></barline>'
  const measures = Array.from({ length: 8 }, (_, i) => {
    const left = withRepeat && i === 3 ? forward : ''
    const right = withRepeat && i === 4 ? backward : ''
    // 排版差异：改字体相关记号，不改变任何小节/反复/音符时长结构。
    const words = layoutOnlyNote && i === 0
      ? '<direction placement="above"><direction-type><words>dolce</words></direction-type></direction>'
      : ''
    return `<measure number="${i + 1}">
      ${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}
      ${words}${left}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>${right}
    </measure>`
  }).join('\n')
  return `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`
}

function occurrences(project: StoredProject, versionIndex: number, measureIndex: number): number[] {
  const version = project.versions[versionIndex]
  const parsed = parseMusicXml(version.originalXml)
  return buildPerformancePath(parsed).arrivals.find((item) => item.measureIndex === measureIndex)?.occurrences ?? []
}

// 1. 只改排版的新版：两版都能打开，书面小节数一致，标记互不覆盖。
{
  const project = createProject('排版修订', buildXml(false))
  const v1 = project.versions[0]
  const oldMark: RehearsalMark = {
    id: 'm-old', measureIndex: 3, occurrence: 1, label: '旧版标记',
    comment: '只属于旧版', color: '#f4b942', createdAt: '2026-09-01T00:00:00.000Z',
  }
  v1.marks.push(oldMark)

  const newXml = buildXml(false, true)
  const added = addProjectVersion(project, '仅排版调整', newXml)

  assert.equal(project.versions.length, 2, '应有两个版本')
  assert.equal(project.currentVersionId, added.id, '导入后当前选择应为新版本')
  assert.deepEqual(v1.marks.map((m) => m.id), ['m-old'], '旧版标记必须原样保留')
  assert.deepEqual(added.marks, [], '新版本不得自动迁移旧标记')

  const oldScore = parseMusicXml(v1.originalXml)
  const newScore = parseMusicXml(added.originalXml)
  assert.equal(oldScore.measures.length, newScore.measures.length, '排版修订不应改变小节数')
  const oldPath = buildPerformancePath(oldScore)
  const newPath = buildPerformancePath(newScore)
  assert.ok(oldPath.closed && newPath.closed, '两版路径都应可闭合')
  assert.deepEqual(
    newPath.steps.map((s) => s.measureNumber),
    oldPath.steps.map((s) => s.measureNumber),
    '只改排版时两版实际路径应一致',
  )

  // 在新版加标记，不影响旧版。
  added.marks.push({
    id: 'm-new', measureIndex: 5, occurrence: 1, label: '新版标记',
    comment: '只属于新版', color: '#f4b942', createdAt: '2026-10-01T00:00:00.000Z',
  })
  assert.deepEqual(v1.marks.map((m) => m.id), ['m-old'], '新版标记不得覆盖旧版')
  console.log('✓ 只改排版：两版分别打开，标记互不覆盖')
}

// 2. 含不同反复路径的新版：旧版“第二次到达”标记不错位。
{
  const project = createProject('反复修订', buildXml(false))
  const v1 = project.versions[0]
  // 旧版第 4 小节只到达 1 次。
  assert.deepEqual(occurrences(project, 0, 3), [1])
  v1.marks.push({
    id: 'm-repeat', measureIndex: 3, occurrence: 1, label: '旧版第4小节第1次',
    comment: '', color: '#f4b942', createdAt: '2026-09-01T00:00:00.000Z',
  })

  addProjectVersion(project, '加反复', buildXml(true))

  // 新版第 4 小节（index 3）到达两次，第 5 小节（index 4）也到达两次。
  const newPath = buildPerformancePath(parseMusicXml(project.versions[1].originalXml))
  const numbers = newPath.steps.map((s) => s.measureNumber)
  assert.deepEqual(numbers, ['1', '2', '3', '4', '5', '4', '5', '6', '7', '8'], '新版应体现反复返回')
  assert.deepEqual(occurrences(project, 1, 3), [1, 2], '新版第 4 小节应到达两次')

  // 关键验收点：旧版标记仍锚定旧版路径，occurrence=1 解析不到“第二次到达”。
  assert.deepEqual(occurrences(project, 0, 3), [1], '旧版路径不得被新版反复改变')
  const oldMark = project.versions[0].marks[0]
  assert.equal(oldMark.measureIndex, 3)
  assert.equal(oldMark.occurrence, 1, '旧版标记仍是旧路径上的第一次到达，不被新版第 2 次错位')
  assert.equal(project.versions[1].marks.length, 0, '新版不继承旧标记，因此也不存在错位的“第二次到达”')
  console.log('✓ 不同反复路径：旧版标记锚定旧路径，不出现错位的第二次到达')
}

// 3. 旧单版本工程（v1 结构）仍可打开，并升级成单版本容器。
{
  const xml = buildXml(false)
  const legacy = {
    id: 'legacy-1', name: '旧工程', originalXml: xml,
    marks: [{ id: 'm1', measureIndex: 1, occurrence: 1, label: 'A', comment: '', color: '#fff', createdAt: 'x' }],
    updatedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z',
  }
  const normalized = normalizeProject(legacy)
  assert.equal(normalized.versions.length, 1, '旧工程升级为单版本')
  assert.equal(normalized.versions[0].originalXml, xml, '原始 XML 逐字保留')
  assert.deepEqual(normalized.versions[0].marks.map((m) => m.id), ['m1'], '旧标记逐字保留')
  assert.equal(normalized.currentVersionId, normalized.versions[0].id)
  const parsed = parseMusicXml(normalized.versions[0].originalXml)
  assert.ok(buildPerformancePath(parsed).closed, '旧工程仍可解析打开')
  console.log('✓ 现有单版本工程仍可打开')
}

// 4. 工程包导出再导入：版本与当前选择保留（v1 旧包也能导入）。
{
  const project = createProject('导出测试', buildXml(false))
  addProjectVersion(project, '加反复版', buildXml(true))
  project.currentVersionId = project.versions[0].id // 故意切回旧版作为当前选择
  const bundle = exportProject(project)
  assert.equal(bundle.format, 'local-rehearsal-project/v2')

  const file = new File([JSON.stringify(bundle)], 'x.rehearsal.json', { type: 'application/json' })
  const imported = await importProjectFile(file)
  assert.equal(imported.versions.length, 2, '版本数保留')
  assert.deepEqual(
    imported.versions.map((v) => v.originalXml),
    project.versions.map((v) => v.originalXml),
    '两版原始 XML 逐字保留',
  )
  const importedCurrent = imported.versions.find((v) => v.id === imported.currentVersionId)
  const sourceCurrent = project.versions.find((v) => v.id === project.currentVersionId)
  assert.equal(importedCurrent?.originalXml, sourceCurrent?.originalXml, '当前选择的版本必须保留')

  // v1 旧格式工程包同样可导入并升级。
  const v1File = new File([JSON.stringify({
    format: 'local-rehearsal-project/v1',
    project: { id: 'p', name: '老包', originalXml: buildXml(false), marks: [], updatedAt: 'x', createdAt: 'x' },
  })], 'old.rehearsal.json', { type: 'application/json' })
  const importedV1 = await importProjectFile(v1File)
  assert.equal(importedV1.versions.length, 1, 'v1 工程包导入后升级为单版本')
  console.log('✓ 导出再导入保留版本与当前选择（兼容 v1 工程包）')
}

// 5. 无效 XML 不能进入版本容器。
{
  assert.throws(() => parseMusicXml('<score-partwise><part></score-partwise>'), '语法错误 XML 应被解析器拒绝')
  const project = createProject('有效工程', buildXml(false))
  assert.doesNotThrow(() => parseMusicXml(project.versions[0].originalXml), '被拒后当前工程仍可继续使用')

  // 不是 partwise 的 XML 也被拒绝，且没有产生新版本。
  assert.throws(
    () => parseMusicXml('<?xml version="1.0"?><score-timewise version="4.0"></score-timewise>'),
    'timewise 不在支持范围，应被拒绝',
  )
  assert.equal(project.versions.length, 1, '被拒绝的 XML 不得产生新版本')

  // 归一化层也要拒绝没有任何版本/XML 的数据。
  assert.throws(() => normalizeProject({ id: 'bad', name: '空', versions: [] }), '无版本工程应被拒绝')
  console.log('✓ 无效 XML 被拒且当前工程继续可用')
}

// 样例回归：确保版本改造没有破坏既有路径。
{
  const sample = parseMusicXml(fullSampleXml())
  const samplePath = buildPerformancePath(sample)
  assert.deepEqual(
    samplePath.steps.map((s) => s.measureNumber),
    ['0', '1', '2', '3', '4', '5', '2', '3', '4', '6', '7', '8'],
  )
  console.log('✓ 原有样例路径回归通过')
}

console.log('\n全部版本功能验收测试通过。')
