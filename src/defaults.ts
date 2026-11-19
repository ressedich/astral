import type { ServerProfile, SessionSnapshot, Settings } from './types'

export const storageKey = 'astral.settings.v2'

export function defaultSettings(): Settings {
  return {
    mode: 'proxy',
    serverId: '',
    servers: [],
    subscriptions: [],
    socksPort: 1080,
    httpPort: 8080,
    systemProxy: false,
    tunName: 'Astral',
    mtu: 1400,
    dns: '1.1.1.1',
    allowRoutes: false,
    configRouting: true,
    blockAds: false,
    bypassLocal: true,
    autoRefresh: true,
    refreshMinutes: 180,
  }
}

export function emptySnapshot(): SessionSnapshot {
  return {
    phase: 'idle',
    mode: 'proxy',
    message: '',
    startedAt: null,
    rx: 0,
    tx: 0,
    egressIp: null,
    socks: null,
    http: null,
    systemProxy: false,
    tunName: null,
  }
}

export const emptyServer: ServerProfile = {
  id: '',
  name: '',
  host: '',
  port: 0,
  protocol: 'direct',
  username: '',
  password: '',
  subId: null,
  vless: null,
  core: null,
  xray: null,
}
