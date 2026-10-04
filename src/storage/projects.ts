import type {
  LegacyStoredProject,
  ProjectExport,
  ScoreVersion,
  StoredProject,
} from '../score/types'

const databaseName = 'rehearsal-stand'
const storeName = 'projects'
const version = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createVersion(name: string, originalXml: string): ScoreVersion {
  return {
    id: crypto.randomUUID(),
    name,
    originalXml,
    marks: [],
    createdAt: new Date().toISOString(),
  }
}

export function createProject(name: string, originalXml: string): StoredProject {
  const now = new Date().toISOString()
  const firstVersion = createVersion('版本 1', originalXml)
  return {
    id: crypto.randomUUID(),
    name,
    versions: [firstVersion],
    activeVersionId: firstVersion.id,
    updatedAt: now,
    createdAt: now,
  }
}

/** 把新 XML 追加为工程的新版本并设为当前版本；旧版本的 XML 与标记保持原样。 */
export function appendVersion(project: StoredProject, name: string, originalXml: string): ScoreVersion {
  const version = createVersion(name, originalXml)
  project.versions.push(version)
  project.activeVersionId = version.id
  project.updatedAt = new Date().toISOString()
  return version
}

export function activeVersionOf(project: StoredProject): ScoreVersion {
  return project.versions.find((item) => item.id === project.activeVersionId) ?? project.versions[0]
}

/**
 * 把任意来源的工程数据整理成多版本形状。
 * 旧版单版本工程（顶层 originalXml/marks）会被包成“版本 1”，标记原样保留。
 * 数据无法识别时抛错，而不是猜测或丢弃内容。
 */
export function normalizeProject(raw: unknown): StoredProject {
  const candidate = raw as Partial<StoredProject & LegacyStoredProject> | null
  if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string') {
    throw new Error('工程数据缺少名称，无法识别。')
  }
  const now = new Date().toISOString()

  let versions: ScoreVersion[]
  if (Array.isArray(candidate.versions) && candidate.versions.length > 0) {
    versions = candidate.versions.map((item, index) => {
      if (typeof item?.originalXml !== 'string') {
        throw new Error(`工程的第 ${index + 1} 个版本缺少原始 XML，无法打开。`)
      }
      return {
        id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        name: typeof item.name === 'string' && item.name ? item.name : `版本 ${index + 1}`,
        originalXml: item.originalXml,
        marks: Array.isArray(item.marks) ? item.marks : [],
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
      }
    })
  } else if (typeof candidate.originalXml === 'string') {
    versions = [
      {
        id: crypto.randomUUID(),
        name: '版本 1',
        originalXml: candidate.originalXml,
        marks: Array.isArray(candidate.marks) ? candidate.marks : [],
        createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
      },
    ]
  } else {
    throw new Error('工程既没有版本列表也没有原始 XML，无法迁移。')
  }

  const activeVersionId = versions.some((item) => item.id === candidate.activeVersionId)
    ? (candidate.activeVersionId as string)
    : versions[0].id

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : crypto.randomUUID(),
    name: candidate.name,
    versions,
    activeVersionId,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  }
}

export async function listProjects(): Promise<StoredProject[]> {
  const database = await openDatabase()
  try {
    const result = await requestPromise(database.transaction(storeName, 'readonly').objectStore(storeName).getAll())
    return result.map(normalizeProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } finally {
    database.close()
  }
}

export async function saveProject(project: StoredProject): Promise<void> {
  const database = await openDatabase()
  try {
    await requestPromise(database.transaction(storeName, 'readwrite').objectStore(storeName).put(project))
  } finally {
    database.close()
  }
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase()
  try {
    await requestPromise(database.transaction(storeName, 'readwrite').objectStore(storeName).delete(id))
  } finally {
    database.close()
  }
}

export function exportProject(project: StoredProject): ProjectExport {
  return {
    format: 'local-rehearsal-project/v2',
    exportedAt: new Date().toISOString(),
    project: JSON.parse(JSON.stringify(project)) as StoredProject,
  }
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 解析工程包 JSON：接受 v2 多版本与 v1 单版本两种格式，v1 会迁移成单版本工程。 */
export function parseProjectBundle(text: string): StoredProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('工程包不是有效的 JSON。')
  }
  const bundle = parsed as { format?: unknown; project?: unknown }
  if (bundle.format !== 'local-rehearsal-project/v2' && bundle.format !== 'local-rehearsal-project/v1') {
    throw new Error('不是有效的 local-rehearsal-project 工程文件（支持 v2 多版本与 v1 单版本）。')
  }
  const project = normalizeProject(bundle.project)
  return {
    ...project,
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  }
}

export async function importProjectFile(file: File): Promise<StoredProject> {
  return parseProjectBundle(await file.text())
}
