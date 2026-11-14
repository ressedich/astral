export function formatBytes(value: number) {
  const n = Math.max(0, value)
  if (n < 1024) return `${Math.round(n)} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

export function formatDuration(startedAt: number | null, now: number) {
  if (!startedAt) return '00:00:00'
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatLatency(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 0) return 'нет'
  return `${ms} мс`
}
