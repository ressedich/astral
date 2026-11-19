import type { ConnectBody, ImportResult, SessionSnapshot, SystemInfo } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new Error('Движок Astral не отвечает')
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || 'Сбой запроса')
  return data
}

export function getSession() {
  return request<SessionSnapshot>('/api/session')
}

export function openSession(body: ConnectBody) {
  return request<SessionSnapshot>('/api/session', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function closeSession() {
  return request<SessionSnapshot>('/api/session', { method: 'DELETE' })
}

export function importLinks(source: string) {
  return request<ImportResult>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ source }),
  })
}

export function getSystem() {
  return request<SystemInfo>('/api/system')
}

export function setAutostart(enabled: boolean) {
  return request<SystemInfo>('/api/system', {
    method: 'POST',
    body: JSON.stringify({ autostart: enabled }),
  })
}

export async function probe(host: string, port: number) {
  try {
    const data = await request<{ ms: number }>(
      `/api/probe?host=${encodeURIComponent(host)}&port=${port}`,
    )
    return typeof data.ms === 'number' ? data.ms : -1
  } catch {
    return -1
  }
}
