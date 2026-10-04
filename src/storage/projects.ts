import type { ProjectExport, RehearsalMark, ScoreVersion, StoredProject } from '../score/types'

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

function createId(): string {
  return crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 统一数据形态：旧的单版本工程（originalXml + marks）就地升级为一个版本，
 * 升级只改变容器，原始 XML 与标记逐字保留；新工程直接按版本容器处理。
 * 没有任何可用 XML 的记录会被拒绝。
 */
export function normalizeProject(raw: unknown): StoredProject {
  if (!isRecord(raw)) throw new Error('工程数据不是有效对象。')

  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()

  let versions: ScoreVersion[] = []
  if (Array.isArray(raw.versions)) {
    versions = raw.versions
      .map((entry) => normalizeVersion(entry, createdAt))
      .filter((entry): entry is ScoreVersion => entry !== null)
  } else if (typeof raw.originalXml === 'string' && raw.originalXml.length > 0) {
    const marks = Array.isArray(raw.marks) ? (raw.marks as RehearsalMark[]) : []
    versions = [{
      id: createId(),
      label: '初始版本',
      originalXml: raw.originalXml,
      marks: marks.map((mark) => ({ ...mark })),
      importedAt: createdAt,
    }]
  }

  if (!versions.length) throw new Error('工程中没有包含任何乐谱版本。')

  const currentVersionId = typeof raw.currentVersionId === 'string' && versions.some((item) => item.id === raw.currentVersionId)
    ? raw.currentVersionId
    : versions[0].id

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名工程',
    versions,
    currentVersionId,
    createdAt,
    updatedAt,
  }
}

function normalizeVersion(raw: unknown, fallbackTime: string): ScoreVersion | null {
  if (!isRecord(raw) || typeof raw.originalXml !== 'string' || raw.originalXml.length === 0) return null
  const marks = Array.isArray(raw.marks) ? (raw.marks as RehearsalMark[]) : []
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    label: typeof raw.label === 'string' && raw.label ? raw.label : '未命名版本',
    originalXml: raw.originalXml,
    marks: marks.map((mark) => ({ ...mark })),
    importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : fallbackTime,
  }
}

export async function listProjects(): Promise<StoredProject[]> {
  const database = await openDatabase()
  try {
    const result = await requestPromise(database.transaction(storeName, 'readonly').objectStore(storeName).getAll())
    return result
      .map((item) => {
        try {
          return normalizeProject(item)
        } catch {
          return null
        }
      })
      .filter((item): item is StoredProject => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

export function createProject(name: string, originalXml: string): StoredProject {
  const now = new Date().toISOString()
  const firstVersion: ScoreVersion = {
    id: createId(),
    label: '初始版本',
    originalXml,
    marks: [],
    importedAt: now,
  }
  return {
    id: createId(),
    name,
    versions: [firstVersion],
    currentVersionId: firstVersion.id,
    updatedAt: now,
    createdAt: now,
  }
}

/** 解析通过后才调用：把新 XML 作为一个独立版本追加，标记从空开始（不迁移旧标记）。 */
export function addProjectVersion(project: StoredProject, label: string, originalXml: string): ScoreVersion {
  const version: ScoreVersion = {
    id: createId(),
    label: label.trim() || `版本 ${project.versions.length + 1}`,
    originalXml,
    marks: [],
    importedAt: new Date().toISOString(),
  }
  project.versions.push(version)
  project.currentVersionId = version.id
  project.updatedAt = new Date().toISOString()
  return version
}

export function exportProject(project: StoredProject): ProjectExport {
  return {
    format: 'local-rehearsal-project/v2',
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

export async function importProjectFile(file: File): Promise<StoredProject> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('工程包不是有效的 JSON。')
  }

  const bundle = parsed as { format?: string; project?: unknown }
  if (
    (bundle.format !== 'local-rehearsal-project/v2' && bundle.format !== 'local-rehearsal-project/v1') ||
    !bundle.project
  ) {
    throw new Error('不是有效的 local-rehearsal-project 工程文件。')
  }

  let normalized: StoredProject
  try {
    normalized = normalizeProject(bundle.project)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '工程文件内容无效。')
  }

  // 工程本身作为新副本入库；版本 id 与当前选择逐字保留。
  normalized.id = createId()
  normalized.updatedAt = new Date().toISOString()
  return normalized
}
