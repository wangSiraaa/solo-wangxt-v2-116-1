<template>
  <div v-if="preview" class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal panel">
      <h2>导入为新乐谱版本</h2>
      <p class="muted">
        将在工程「{{ projectName }}」中新增一个版本。新版本从空标记开始，
        <strong>不会</strong>按同名小节迁移旧版本的排练标记。
      </p>

      <label class="field">
        版本名称
        <input v-model="label" :placeholder="`版本 ${versionCount + 1}`" />
      </label>

      <div class="preview-block">
        <div class="detail-title">
          路径状态预览
          <span :class="['tag', preview.path.closed ? 'ok-tag' : 'bad-tag']">
            {{ preview.path.closed ? '路径可闭合' : '路径存在错误' }}
          </span>
        </div>
        <div class="stat-grid">
          <span>实际演奏小节</span><strong>{{ preview.path.steps.length }}</strong>
          <span>书面小节</span><strong>{{ preview.score.measures.length }}</strong>
          <span>总时长</span><strong>{{ formatTime(preview.path.totalSeconds) }}</strong>
        </div>
        <ol v-if="preview.path.steps.length" class="preview-path">
          <li v-for="(step, index) in preview.path.steps" :key="index">
            小节 {{ step.measureNumber }} <em>#{{ step.occurrence }}</em>
            <small>{{ step.event }}</small>
          </li>
        </ol>
        <p v-else class="muted">该 XML 没有可演奏的小节。</p>
        <ul v-if="errorWarnings.length" class="preview-warnings">
          <li v-for="(warning, index) in errorWarnings" :key="index" :class="warning.level">
            {{ warning.level === 'error' ? '错误' : warning.level === 'warning' ? '警告' : '信息' }}：{{ warning.message }}
          </li>
        </ul>
      </div>

      <div class="modal-actions">
        <button class="button secondary" @click="$emit('cancel')">取消</button>
        <button class="button primary" @click="confirm">确认保存为新版本</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatTime } from '../score/parser'
import type { BuiltPath } from '../score/types'
import type { ParsedScore } from '../score/parser'

export interface VersionImportPreview {
  fileName: string
  xml: string
  score: ParsedScore
  path: BuiltPath
}

const props = defineProps<{
  preview: VersionImportPreview | null
  projectName: string
  versionCount: number
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [label: string, xml: string]
}>()

const label = ref('')

watch(
  () => props.preview,
  (preview) => {
    label.value = preview ? preview.fileName : ''
  },
)

const errorWarnings = computed(() => props.preview?.path.warnings ?? [])

function confirm(): void {
  if (!props.preview) return
  emit('confirm', label.value.trim() || props.preview.fileName, props.preview.xml)
}
</script>
