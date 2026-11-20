import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { closeSession, getSession, importLinks, openSession } from './api'
import { defaultSettings, emptyServer, emptySnapshot, storageKey } from './defaults'
import type {
  ConnectBody,
  ImportResult,
  Mode,
  Phase,
  Protocol,
  ServerProfile,
  SessionSnapshot,
  Settings,
  Subscription,
  VlessLink,
} from './types'

type SessionContextValue = {
  settings: Settings
  server: ServerProfile
  phase: Phase
  message: string
  snapshot: SessionSnapshot
  now: number
  sheet: boolean
  setSheet: (open: boolean) => void
  locked: boolean
  stopping: boolean
  selectServer: (id: string) => void
  patchSettings: (patch: Partial<Settings>) => void
  importSource: (source: string) => Promise<void>
  removeServer: (id: string) => void
  removeSubscription: (id: string) => void
  refreshSubscription: (id: string) => Promise<void>
  refreshAll: () => Promise<{ updated: number; failed: number }>
  choose: (next: 'off' | Mode) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function sameSnapshot(current: SessionSnapshot, next: SessionSnapshot) {
  return (
    current.phase === next.phase &&
    current.mode === next.mode &&
    current.message === next.message &&
    current.startedAt === next.startedAt &&
    current.rx === next.rx &&
    current.tx === next.tx &&
    current.egressIp === next.egressIp &&
    current.socks === next.socks &&
    current.http === next.http &&
    current.systemProxy === next.systemProxy &&
    current.tunName === next.tunName
  )
}

function sanitizeVless(value: Partial<VlessLink> | null | undefined): VlessLink | null {
  if (!value || typeof value !== 'object') return null
  const uuid = String(value.uuid || '')
  if (!/^[0-9a-fA-F-]{8,80}$/.test(uuid)) return null
  return {
    uuid,
    flow: String(value.flow || ''),
    network: String(value.network || 'tcp'),
    security: String(value.security || 'none'),
    sni: String(value.sni || ''),
    fp: String(value.fp || ''),
    pbk: String(value.pbk || ''),
    sid: String(value.sid || ''),
    path: String(value.path || ''),
    hostHeader: String(value.hostHeader || ''),
    serviceName: String(value.serviceName || ''),
    alpn: String(value.alpn || ''),
    packetEncoding: String(value.packetEncoding || ''),
    mode: String(value.mode || ''),
  }
}

function sanitizeXray(value: unknown) {
  if (!value || typeof value !== 'object') return null
  try {
    const json = JSON.stringify(value)
    if (json.length > 200000) return null
    const parsed = JSON.parse(json) as { outbounds?: unknown }
    if (!Array.isArray(parsed.outbounds) || !parsed.outbounds.length) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function sanitizeCore(value: unknown) {
  if (!value || typeof value !== 'object') return null
  try {
    const json = JSON.stringify(value)
    if (json.length > 20000) return null
    const parsed = JSON.parse(json) as { type?: string }
    if (parsed?.type !== 'vless' && parsed?.type !== 'hysteria2') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function sanitizeServer(server: Partial<ServerProfile>): ServerProfile {
  const protocol: Protocol =
    server.protocol === 'http' ||
    server.protocol === 'socks5' ||
    server.protocol === 'direct' ||
    server.protocol === 'vless' ||
    server.protocol === 'hysteria2'
      ? server.protocol
      : 'socks5'
  const vless = protocol === 'vless' ? sanitizeVless(server.vless) : null
  const core = sanitizeCore(server.core)
  return {
    id: String(server.id || crypto.randomUUID()),
    name: String(server.name ?? 'Сервер').slice(0, 80),
    host: String(server.host || ''),
    port: Number(server.port) || 443,
    protocol: core || vless || protocol !== 'vless' ? protocol : 'socks5',
    username: String(server.username || ''),
    password: String(server.password || ''),
    subId: server.subId ? String(server.subId) : null,
    vless,
    core,
    xray: sanitizeXray(server.xray),
  }
}

function finite(value: unknown, allowZero: boolean) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (!allowZero && value === 0) return null
  return value
}

function sanitizeSubscription(item: Partial<Subscription>): Subscription {
  return {
    id: String(item.id || crypto.randomUUID()),
    name: String(item.name || 'Подписка').slice(0, 80),
    url: String(item.url || ''),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
    announce: String(item.announce || '').replace(/\r/g, '').trim().slice(0, 500),
    upload: finite(item.upload, true),
    download: finite(item.download, true),
    total: finite(item.total, false),
    expire: finite(item.expire, false),
    known: item.known === true,
  }
}

function described(result: ImportResult) {
  return {
    announce: String(result.info?.announce || '').replace(/\r/g, '').trim().slice(0, 500),
    upload: finite(result.info?.upload, true),
    download: finite(result.info?.download, true),
    total: finite(result.info?.total, false),
    expire: finite(result.info?.expire, false),
    known: true,
  }
}

function loadSettings(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Settings>
    const servers = Array.isArray(parsed.servers) ? parsed.servers.map((item) => sanitizeServer(item)) : []
    const subscriptions = Array.isArray(parsed.subscriptions)
      ? parsed.subscriptions.map((item) => sanitizeSubscription(item))
      : []
    const serverId = servers.some((item) => item.id === parsed.serverId) ? String(parsed.serverId) : (servers[0]?.id ?? '')
    const mode: Mode = parsed.mode === 'tun' ? 'tun' : 'proxy'
    return {
      ...base,
      mode,
      serverId,
      servers,
      subscriptions,
      socksPort: Number(parsed.socksPort) || base.socksPort,
      httpPort: Number(parsed.httpPort) || base.httpPort,
      systemProxy: Boolean(parsed.systemProxy),
      tunName: String(parsed.tunName || base.tunName),
      mtu: Number(parsed.mtu) || base.mtu,
      dns: String(parsed.dns || base.dns),
      allowRoutes: Boolean(parsed.allowRoutes),
      blockAds: Boolean(parsed.blockAds),
      bypassLocal: parsed.bypassLocal !== false,
      autoRefresh: parsed.autoRefresh !== false,
      refreshMinutes: Number(parsed.refreshMinutes) > 0 ? Number(parsed.refreshMinutes) : base.refreshMinutes,
    }
  } catch {
    return base
  }
}

function blockReason(settings: Settings, server: ServerProfile) {
  if (!server.id) return 'Добавьте сервер: ссылка подписки или vless://'
  if (settings.mode === 'tun' && server.protocol === 'direct') {
    return 'Для TUN нужен сервер vless, SOCKS5 или HTTP.'
  }
  if (server.protocol === 'vless' && !server.vless?.uuid && !server.core) return 'В ссылке vless нет UUID'
  if (server.protocol !== 'direct' && !server.host.trim()) return 'У сервера нет адреса'
  if (settings.mode === 'proxy' && Number(settings.socksPort) === Number(settings.httpPort)) {
    return 'Порты SOCKS и HTTP должны отличаться.'
  }
  return null
}

function nodeKey(server: { host: string; port: number; vless: VlessLink | null }) {
  return `${server.vless?.uuid || ''}|${server.host}|${server.port}`
}

function applyImport(current: Settings, result: ImportResult): Settings {
  const existingSub = result.url
    ? current.subscriptions.find((item) => item.url === result.url)
    : undefined
  const local = !result.url
  const reuseSubId = existingSub?.id ?? (local ? (result.servers.length > 1 ? 'local' : null) : null)
  const canReuse = Boolean(existingSub) || local
  const known = new Map<string, string>()
  if (canReuse) {
    for (const item of current.servers) {
      if (item.subId !== reuseSubId) continue
      const key = nodeKey(item)
      if (!known.has(key)) known.set(key, item.id)
    }
  }
  const used = new Set<string>()
  const pickId = (key: string) => {
    const existing = known.get(key)
    if (existing && !used.has(existing)) {
      used.add(existing)
      return existing
    }
    const fresh = crypto.randomUUID()
    used.add(fresh)
    return fresh
  }
  const created = result.servers.map((item) =>
    sanitizeServer({
      id: pickId(nodeKey(item)),
      name: item.name,
      host: item.host,
      port: item.port,
      protocol: item.protocol,
      vless: item.vless,
      core: item.core,
      xray: item.xray,
      subId: null,
    }),
  )
  if (!created.length) return current
  if (result.url) {
    const subId = existingSub?.id ?? crypto.randomUUID()
    const sub: Subscription = {
      id: subId,
      name: result.name || existingSub?.name || 'Подписка',
      url: result.url,
      updatedAt: Date.now(),
      ...described(result),
    }
    const subscriptions = existingSub
      ? current.subscriptions.map((item) => (item.id === subId ? sub : item))
      : [...current.subscriptions, sub]
    const tagged = created.map((item) => ({ ...item, subId }))
    const servers = [...current.servers.filter((item) => item.subId !== subId), ...tagged]
    return { ...current, subscriptions, servers, serverId: tagged[0].id }
  }
  if (created.length === 1) {
    const node = created[0]
    const servers = current.servers.filter((item) => nodeKey(item) !== nodeKey(node))
    return { ...current, servers: [...servers, node], serverId: node.id }
  }
  const subId = 'local'
  const sub: Subscription = {
    id: subId,
    name: 'Мои',
    url: '',
    updatedAt: Date.now(),
    announce: '',
    upload: null,
    download: null,
    total: null,
    expire: null,
    known: true,
  }
  const subscriptions = current.subscriptions.some((item) => item.id === subId)
    ? current.subscriptions.map((item) => (item.id === subId ? sub : item))
    : [...current.subscriptions, sub]
  const keys = new Set(created.map((item) => nodeKey(item)))
  const tagged = created.map((item) => ({ ...item, subId }))
  const servers = [
    ...current.servers.filter((item) => !(item.subId === subId && keys.has(nodeKey(item)))),
    ...tagged,
  ]
  return { ...current, subscriptions, servers, serverId: tagged[0].id }
}

function keepServer(current: Settings, next: Settings): Settings {
  const previous = current.servers.find((item) => item.id === current.serverId)
  const match = previous ? next.servers.find((item) => item.name === previous.name) : undefined
  const stillThere = next.servers.some((item) => item.id === current.serverId)
  return { ...next, mode: current.mode, serverId: match?.id || (stillThere ? current.serverId : next.serverId) }
}

function payload(settings: Settings, server: ServerProfile, mode: Mode): ConnectBody {
  return {
    mode,
    upstream: {
      type: server.protocol,
      host: server.host.trim(),
      port: Number(server.port),
      username: server.username,
      password: server.password,
      vless: server.vless,
      core: server.core,
      xray: server.xray,
    },
    proxy: {
      socksPort: Number(settings.socksPort),
      httpPort: Number(settings.httpPort),
      systemProxy: settings.systemProxy,
    },
    tun: {
      name: settings.tunName,
      mtu: Number(settings.mtu),
      dns: settings.dns.trim(),
      allowRoutes: settings.allowRoutes,
    },
    routing: {
      config: true,
      blockAds: settings.blockAds === true,
      bypassLocal: settings.bypassLocal !== false,
    },
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(emptySnapshot)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState(false)
  const [stopping, setStopping] = useState(false)
  const pending = useRef(false)
  const hold = useRef(false)
  const refreshed = useRef(false)
  const describedOnce = useRef(false)
  const refreshingAll = useRef(false)

  const persist = useCallback((next: Settings) => {
    localStorage.setItem(storageKey, JSON.stringify(next))
    return next
  }, [])

  const update = useCallback(
    (recipe: (current: Settings) => Settings) => {
      setSettings((current) => persist(recipe(current)))
    },
    [persist],
  )

  const server = useMemo(
    () => settings.servers.find((item) => item.id === settings.serverId) ?? settings.servers[0] ?? emptyServer,
    [settings],
  )

  const apply = useCallback((next: SessionSnapshot) => {
    setSnapshot((current) => (sameSnapshot(current, next) ? current : next))
    setPhase((current) => (current === next.phase ? current : next.phase))
    setMessage((current) => (current === next.message ? current : next.message))
  }, [])

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const next = await getSession()
        if (stop || pending.current) return
        if (hold.current && next.phase === 'idle') return
        hold.current = false
        apply(next)
      } catch {
        if (!stop && !pending.current) {
          setMessage((current) => current || 'Движок Astral не отвечает')
        }
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [apply])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    document.title = phase === 'connected' ? 'Astral — подключено' : 'Astral'
  }, [phase])

  useEffect(() => {
    if (refreshed.current) return
    const subs = settings.subscriptions.filter((item) => item.url)
    const stale = settings.servers.some((item) => item.subId && !item.xray)
    if (!subs.length || !stale) return
    refreshed.current = true
    let cancel = false
    void (async () => {
      for (const sub of subs) {
        if (cancel) return
        try {
          const result = await importLinks(sub.url)
          if (cancel) return
          update((current) => {
            const previous = current.servers.find((item) => item.id === current.serverId)
            const next = applyImport(current, result)
            const match = previous ? next.servers.find((item) => item.name === previous.name) : undefined
            return { ...next, mode: current.mode, serverId: match?.id || next.serverId }
          })
        } catch {
          /* подписка недоступна, список остаётся */
        }
      }
    })()
    return () => {
      cancel = true
    }
  }, [settings.servers, settings.subscriptions, update])

  useEffect(() => {
    if (describedOnce.current) return
    const pending = settings.subscriptions.filter((item) => item.url && !item.known)
    if (!pending.length) return
    describedOnce.current = true
    void (async () => {
      for (const sub of pending) {
        try {
          const result = await importLinks(sub.url)
          update((current) => keepServer(current, applyImport(current, result)))
        } catch {
          /* описание появится после обновления */
        }
      }
    })()
  }, [settings.subscriptions, update])

  useEffect(() => {
    if (!settings.autoRefresh) return
    const minutes = Number(settings.refreshMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    const tick = () => {
      if (refreshingAll.current) return
      const due = settings.subscriptions.filter(
        (item) => item.url && (!item.updatedAt || Date.now() - item.updatedAt >= minutes * 60_000),
      )
      if (!due.length) return
      refreshingAll.current = true
      void (async () => {
        try {
          for (const sub of due) {
            try {
              const result = await importLinks(sub.url)
              update((current) => keepServer(current, applyImport(current, result)))
            } catch {
              /* подписка недоступна, попробуем в следующий раз */
            }
          }
        } finally {
          refreshingAll.current = false
        }
      })()
    }
    const timer = window.setInterval(tick, 60_000)
    const boot = window.setTimeout(tick, 4000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(boot)
    }
  }, [settings.autoRefresh, settings.refreshMinutes, settings.subscriptions, update])

  const locked = phase === 'connecting' || phase === 'connected'

  const fail = useCallback((text: string, openSettings = false) => {
    hold.current = true
    setPhase('error')
    setMessage(text)
    if (openSettings) setSheet(true)
  }, [])

  const disconnect = useCallback(async () => {
    hold.current = false
    pending.current = true
    setStopping(true)
    try {
      apply(await closeSession())
    } catch (error) {
      setPhase('error')
      setMessage(error instanceof Error ? error.message : 'Не удалось отключить')
    } finally {
      pending.current = false
      setStopping(false)
    }
  }, [apply])

  const freshen = useCallback(async (current: Settings, chosen: ServerProfile) => {
    if (chosen.xray || !chosen.subId) return { settings: current, server: chosen }
    const sub = current.subscriptions.find((item) => item.id === chosen.subId && item.url)
    if (!sub) return { settings: current, server: chosen }
    const result = await importLinks(sub.url)
    const next = applyImport(current, result)
    const match = next.servers.find((item) => item.name === chosen.name) ?? next.servers.find((item) => item.id === next.serverId) ?? chosen
    return { settings: { ...next, mode: current.mode, serverId: match.id }, server: match }
  }, [])

  const refreshAll = useCallback(async () => {
    if (refreshingAll.current) return { updated: 0, failed: 0 }
    const subs = settings.subscriptions.filter((item) => item.url)
    if (!subs.length) return { updated: 0, failed: 0 }
    refreshingAll.current = true
    let updated = 0
    let failed = 0
    try {
      for (const sub of subs) {
        try {
          const result = await importLinks(sub.url)
          if (!result.servers.length) {
            failed += 1
            continue
          }
          update((current) => keepServer(current, applyImport(current, result)))
          updated += 1
        } catch {
          failed += 1
        }
      }
    } finally {
      refreshingAll.current = false
    }
    return { updated, failed }
  }, [settings.subscriptions, update])

  const connectAs = useCallback(
    async (mode: Mode, target?: ServerProfile) => {
      if (pending.current) return
      pending.current = true
      hold.current = false
      setPhase('connecting')
      setMessage('')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      let chosen = target ?? server
      let base = settings
      try {
        if (!chosen.xray && chosen.subId) {
          try {
            const fresh = await freshen(base, chosen)
            base = fresh.settings
            chosen = fresh.server
          } catch {
            /* оставляем уже сохранённый сервер */
          }
        }
        const nextSettings = { ...base, mode, serverId: chosen.id, systemProxy: mode === 'proxy' ? true : base.systemProxy }
        const reason = blockReason(nextSettings, chosen)
        if (reason) {
          fail(reason)
          return
        }
        update(() => nextSettings)
        apply(await openSession(payload(nextSettings, chosen, mode)))
      } catch (error) {
        setPhase('error')
        setMessage(error instanceof Error ? error.message : 'Не удалось подключить')
      } finally {
        pending.current = false
      }
    },
    [apply, fail, freshen, server, settings, update],
  )

  const choose = useCallback(
    (next: 'off' | Mode) => {
      void (async () => {
        if (pending.current) return
        if (next === 'off') {
          if (phase === 'connecting' || phase === 'connected') await disconnect()
          else {
            hold.current = false
            setPhase('idle')
            setMessage('')
          }
          return
        }
        if (phase === 'connected' && settings.mode === next) return
        if (phase === 'connecting' || phase === 'connected') await disconnect()
        await connectAs(next)
      })()
    },
    [connectAs, disconnect, phase, settings.mode],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      settings,
      server,
      phase,
      message,
      snapshot,
      now,
      sheet,
      setSheet,
      locked,
      stopping,
      selectServer: (id) => {
        if (pending.current || id === server.id) return
        const target = settings.servers.find((item) => item.id === id)
        if (!target) return
        if (phase === 'connected' || phase === 'connecting') {
          const mode = settings.mode
          void (async () => {
            await disconnect()
            await connectAs(mode, target)
          })()
          return
        }
        hold.current = false
        setPhase((current) => (current === 'error' ? 'idle' : current))
        setMessage('')
        update((current) => ({ ...current, serverId: id }))
      },
      patchSettings: (patch) => {
        if (locked) return
        update((current) => ({ ...current, ...patch }))
      },
      importSource: async (source) => {
        if (phase === 'connecting' || stopping) throw new Error('Дождитесь завершения подключения')
        const result = await importLinks(source)
        hold.current = false
        setPhase((current) => (current === 'error' ? 'idle' : current))
        setMessage('')
        update((current) => applyImport(current, result))
      },
      removeServer: (id) => {
        if (locked) return
        update((current) => {
          const servers = current.servers.filter((item) => item.id !== id)
          return {
            ...current,
            servers,
            serverId: current.serverId === id ? (servers[0]?.id ?? '') : current.serverId,
          }
        })
      },
      refreshSubscription: async (id) => {
        if (phase === 'connecting' || stopping) throw new Error('Дождитесь завершения подключения')
        const sub = settings.subscriptions.find((item) => item.id === id && item.url)
        if (!sub) throw new Error('У подписки нет ссылки')
        const result = await importLinks(sub.url)
        update((current) => keepServer(current, applyImport(current, result)))
      },
      refreshAll,
      removeSubscription: (id) => {
        if (locked) return
        update((current) => {
          const servers = current.servers.filter((item) => item.subId !== id)
          return {
            ...current,
            subscriptions: current.subscriptions.filter((item) => item.id !== id),
            servers,
            serverId: servers.some((item) => item.id === current.serverId) ? current.serverId : (servers[0]?.id ?? ''),
          }
        })
      },
      choose,
    }),
    [choose, connectAs, disconnect, locked, now, phase, refreshAll, server, settings, sheet, snapshot, stopping, message, update],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider missing')
  return value
}
