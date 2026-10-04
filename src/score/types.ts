export type WarningLevel = 'error' | 'warning' | 'info'

export interface ParseWarning {
  level: WarningLevel
  code:
    | 'no-measures'
    | 'different-measure-count'
    | 'unsupported-jump-word'
    | 'missing-back-repeat'
    | 'missing-forward-repeat'
    | 'orphan-ending'
    | 'overlapping-ending'
    | 'missing-segno'
    | 'duplicate-segno'
    | 'missing-coda'
    | 'duplicate-coda'
    | 'missing-fine'
    | 'multiple-fine'
    | 'unresolved-nav-target'
    | 'unclosed-jump'
    | 'unrecognized-direction'
    | 'time-signature-change'
    | 'unknown'
  message: string
  measureNumber?: number
  xmlPath?: string
}

export interface TimeSignature {
  numerator: number
  denominator: number
  beatUnitSeconds: number
}

export interface TempoEvent {
  measureIndex: number
  bpm: number
  label: string
  source: 'sound' | 'metronome' | 'default'
}

export type BarlineLocation = 'left' | 'right' | 'middle'

export interface RepeatInfo {
  location: BarlineLocation
  direction: 'forward' | 'backward'
  times: number
}

export interface EndingInfo {
  location: BarlineLocation
  type: 'start' | 'stop' | 'discontinue'
  numbers: number[]
}

export type NavType =
  | 'segno'
  | 'coda'
  | 'fine'
  | 'dacapo'
  | 'dalsegno'
  | 'tocoda'

export interface NavMarker {
  type: NavType
  measureIndex: number
  text: string
  alFine?: boolean
  alCoda?: boolean
  consumed: boolean
}

export interface WrittenMeasure {
  index: number
  number: string
  implicit: boolean
  durationQuarters: number
  declaredDurationQuarters: number | null
  isPickup: boolean
  hasMultipleVoices: boolean
  voiceCount: number
  partMeasureCounts: Record<string, number>
  timeSignature: TimeSignature | null
  repeats: RepeatInfo[]
  endings: EndingInfo[]
  navMarkers: NavMarker[]
  warnings: ParseWarning[]
}

export type JumpKind =
  | 'straight'
  | 'repeat-back'
  | 'volta-skip'
  | 'da-capo'
  | 'dal-segno'
  | 'to-coda'
  | 'fine-stop'
  | 'end'

export interface PathStep {
  occurrence: number
  measureIndex: number
  measureNumber: string
  iteration: number
  bpm: number
  durationSeconds: number
  startSeconds: number
  endSeconds: number
  activeEndingNumbers: number[]
  incomingJump: JumpKind
  event: string
  isPickup: boolean
}

export interface BuiltPath {
  steps: PathStep[]
  arrivals: Array<{ measureIndex: number; occurrences: number[] }>
  totalSeconds: number
  warnings: ParseWarning[]
  closed: boolean
}

export interface RehearsalMark {
  id: string
  measureIndex: number
  occurrence?: number
  label: string
  comment: string
  color: string
  createdAt: string
}

export interface ScoreVersion {
  id: string
  label: string
  /** 导入时逐字保留的原始 MusicXML，不在版本之间改写或迁移。 */
  originalXml: string
  /** 排练标记只锚定本版本自己的实际演奏路径（书面小节索引 + 第几次到达）。 */
  marks: RehearsalMark[]
  importedAt: string
}

export interface StoredProject {
  id: string
  name: string
  /** 每个版本各自保留原始 XML 与排练标记，不会按同名小节互相迁移。 */
  versions: ScoreVersion[]
  /** 当前选中的版本（ScoreVersion.id），导出再导入后保留。 */
  currentVersionId: string
  updatedAt: string
  createdAt: string
}

export type ProjectExport =
  | {
      format: 'local-rehearsal-project/v2'
      project: StoredProject
    }
  | {
      format: 'local-rehearsal-project/v1'
      project: {
        id: string
        name: string
        originalXml: string
        marks: RehearsalMark[]
        updatedAt: string
        createdAt: string
      }
    }
