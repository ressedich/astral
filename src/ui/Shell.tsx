import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { probe } from '../api'
import { FlagIcon } from '../flag-icon'
import { countryOf, labelOf } from '../flags'
import { formatBytes, formatDuration } from '../format'
import { useSession } from '../session'
import { Sky } from '../scene/Sky'
import type { ServerProfile, Subscription } from '../types'

export function Shell() {
  const session = useSession()
  const { settings, server, phase, message, snapshot, locked, sheet, setSheet } = session
  const [addOpen, setAddOpen] = useState(false)
  const ping = useManualPings(settings.servers)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [subError, setSubError] = useState<{ id: string; text: string } | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const loose = settings.servers.filter((item) => !item.subId)
  const live = phase === 'connected' || phase === 'connecting'
  const selectedMode = settings.mode === 'tun' ? 'tun' : 'proxy'

  function pick(mode: 'proxy' | 'tun') {
    if (live) {
      if (settings.mode !== mode) session.choose(mode)
      return
    }
    session.patchSettings({ mode })
  }

  useEffect(() => {
    if (!infoId) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.subpop, .info-btn')) return
      setInfoId(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [infoId])

  async function refresh(id: string) {
    setSubError(null)
    setRefreshing(id)
    try {
      await session.refreshSubscription(id)
    } catch (error) {
      setSubError({ id, text: error instanceof Error ? error.message : 'Не удалось обновить подписку' })
    } finally {
      setRefreshing(null)
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <header className="side-head">
          <div className="mark">astral</div>
          <div className="tools">
            <IconButton title="Пинг" disabled={locked || ping.busy || !settings.servers.length} onClick={() => void ping.run()}>
              <PulseIcon />
            </IconButton>
            <IconButton title="Параметры" disabled={locked} onClick={() => setSheet(true)}>
              <SlidersIcon />
            </IconButton>
            <IconButton title="Добавить" disabled={locked} onClick={() => setAddOpen(true)}>
              <PlusIcon />
            </IconButton>
          </div>
        </header>
        <div className="servers">
          {settings.subscriptions.map((sub) => {
            const nodes = settings.servers.filter((item) => item.subId === sub.id)
            if (!nodes.length) return null
            return (
              <section key={sub.id} className="group">
                <div className="subline">
                  <span>{sub.name}</span>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={locked || ping.busy}
                    onClick={() => void ping.run(nodes.map((item) => item.id))}
                  >
                    пинг
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={locked || refreshing === sub.id}
                    onClick={() => void refresh(sub.id)}
                  >
                    {refreshing === sub.id ? '…' : 'обновить'}
                  </button>
                  <button type="button" className="text-btn" disabled={locked} onClick={() => session.removeSubscription(sub.id)}>
                    убрать
                  </button>
                  <button
                    type="button"
                    className={infoId === sub.id ? 'text-btn info-btn on' : 'text-btn info-btn'}
                    onClick={() => setInfoId(infoId === sub.id ? null : sub.id)}
                  >
                    инфо
                  </button>
                </div>
                {infoId === sub.id && <SubscriptionFacts sub={sub} now={session.now} />}
                {subError?.id === sub.id && <p className="subinfo">{subError.text}</p>}
                <ServerSections
                  nodes={nodes}
                  selectedId={server.id}
                  pings={ping.pings}
                  busyIds={ping.busyIds}
                  onSelect={session.selectServer}
                />
              </section>
            )
          })}
          {loose.length > 0 && (
            <ServerSections nodes={loose} selectedId={server.id} pings={ping.pings} busyIds={ping.busyIds} onSelect={session.selectServer} />
          )}
          {!settings.servers.length && (
            <p className="empty">
              Добавьте подписку по ссылке
              <br />
              или вставьте vless://
            </p>
          )}
        </div>
      </aside>

      <main className="stage">
        <Sky phase={phase} />
        <div className="dock">
          <div className="chip">
            <Flag name={server.name} />
            <span className="chip-name">{server.id ? labelOf(server.name) : 'Нет сервера'}</span>
          </div>
          <div className="modes" role="tablist" aria-label="Режим">
            <button type="button" className={selectedMode === 'proxy' ? 'on' : ''} onClick={() => pick('proxy')}>
              PROXY
            </button>
            <button type="button" className={selectedMode === 'tun' ? 'on' : ''} onClick={() => pick('tun')}>
              TUN
            </button>
          </div>
          <button
            type="button"
            className={live ? 'power live' : 'power'}
            onClick={() => session.choose(live ? 'off' : selectedMode)}
          >
            <PowerIcon />
            {phase === 'connecting' ? 'Подключение' : live ? 'Выключить' : 'Включить'}
          </button>
          {message && <p className="dock-note">{message}</p>}
          {phase === 'connected' && (
            <p className="dock-meta">
              {formatDuration(snapshot.startedAt, session.now)}
              {(snapshot.rx > 0 || snapshot.tx > 0) && (
                <>
                  <span>·</span>
                  ↑ {formatBytes(snapshot.tx)}
                  <span>·</span>
                  ↓ {formatBytes(snapshot.rx)}
                </>
              )}
              {snapshot.http && (
                <>
                  <span>·</span>
                  {snapshot.http}
                </>
              )}
              {snapshot.egressIp && (
                <>
                  <span>·</span>
                  {snapshot.egressIp}
                </>
              )}
            </p>
          )}
        </div>
        {addOpen && <AddDialog onClose={() => setAddOpen(false)} />}
        {sheet && <SettingsDialog onClose={() => setSheet(false)} />}
      </main>
    </div>
  )
}

function bucketOf(name: string) {
  if (/бел/i.test(name)) return 'Белые списки'
  if (/^авто/i.test(labelOf(name)) || /игров/i.test(name) || /gemini/i.test(name)) return 'Отдельные'
  if (countryOf(name)) return 'Страны'
  return 'Отдельные'
}

function SubscriptionFacts({ sub, now }: { sub: Subscription; now: number }) {
  const used = (sub.upload ?? 0) + (sub.download ?? 0)
  const hasTraffic = sub.upload != null || sub.download != null || sub.total != null
  const traffic = !hasTraffic
    ? ''
    : sub.total
      ? `${formatBytes(used)} из ${formatBytes(sub.total)}`
      : formatBytes(used)
  const until = sub.expire
    ? `до ${new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' }).format(sub.expire * 1000)}`
    : ''
  const updated = updatedLabel(sub.updatedAt, now)
  const meta = [traffic, until, updated].filter(Boolean).join(' · ')
  if (!sub.announce && !meta) {
    return (
      <div className="subpop">
        <p className="submeta">Нет описания подписки</p>
      </div>
    )
  }
  return (
    <div className="subpop">
      {sub.announce && <p className="subinfo">{sub.announce}</p>}
      {meta && <p className="submeta">{meta}</p>}
    </div>
  )
}

function updatedLabel(updatedAt: number | null, now: number) {
  if (!updatedAt) return ''
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60000))
  if (minutes < 1) return 'обновлено только что'
  if (minutes < 60) return `обновлено ${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `обновлено ${hours} ч назад`
  return `обновлено ${new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(updatedAt)}`
}

function ServerSections({
  nodes,
  selectedId,
  pings,
  busyIds,
  onSelect,
}: {
  nodes: ServerProfile[]
  selectedId: string
  pings: Record<string, number>
  busyIds: string[]
  onSelect: (id: string) => void
}) {
  const order = ['Отдельные', 'Страны', 'Белые списки']
  const groups = order
    .map((title) => ({ title, items: nodes.filter((item) => bucketOf(item.name) === title) }))
    .filter((group) => group.items.length)
  return (
    <>
      {groups.map((group) => (
        <div key={group.title}>
          <div className="section-label">{group.title}</div>
          {group.items.map((item) => (
            <Node
              key={item.id}
              server={item}
              selected={item.id === selectedId}
              ping={pings[item.id]}
              busy={busyIds.includes(item.id)}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      ))}
    </>
  )
}

function Node({
  server,
  selected,
  ping,
  busy,
  onSelect,
}: {
  server: ServerProfile
  selected: boolean
  ping: number | undefined
  busy: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={selected ? 'node on' : 'node'} onClick={onSelect}>
      <Flag name={server.name} />
      <span className="node-name">{labelOf(server.name)}</span>
      <PingMark ms={ping} busy={busy && ping == null} />
    </button>
  )
}

function PingMark({ ms, busy }: { ms: number | undefined; busy: boolean }) {
  if (busy) return <span className="ping busy">···</span>
  if (ms == null) return <span className="ping mute">—</span>
  if (ms < 0) return <span className="ping mute">нет</span>
  const fill = Math.round(Math.max(8, Math.min(100, (1 - Math.min(ms, 400) / 400) * 100)))
  return (
    <span className="ping" title={`${ms} мс`}>
      <i className="meter" style={{ ['--fill' as string]: `${fill}%` }} />
      {ms} мс
    </span>
  )
}

function Flag({ name }: { name: string }) {
  const code = name ? countryOf(name) : ''
  if (code) return <FlagIcon code={code} />
  const letter = (labelOf(name) || '?').slice(0, 1).toUpperCase()
  return <span className="mono">{letter}</span>
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.2v5.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 3.6a5.2 5.2 0 1 0 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8h2.2l1.4-3.2 2.3 6.4 1.6-3.2H14.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5h12M2 11.5h12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.5" fill="currentColor" />
      <circle cx="10" cy="11.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="icon" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await session.importSource(value)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <form
        className="panel"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>Добавить</h2>
        <p>Ссылка на подписку или одна и несколько строк vless://</p>
        <textarea
          autoFocus
          value={value}
          spellCheck={false}
          placeholder="https://…  или  vless://…"
          onChange={(event) => setValue(event.target.value)}
        />
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="solid" disabled={busy || !value.trim()}>
            {busy ? '…' : 'Добавить'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const { settings, locked, snapshot, phase } = session

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={onClose}>
      <form
        className="panel"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onClose()
        }}
      >
        <h2>Параметры</h2>
        <div className="grid-2">
          <label className="field">
            <span>SOCKS5</span>
            <input
              value={settings.socksPort}
              disabled={locked}
              inputMode="numeric"
              onChange={(event) => session.patchSettings({ socksPort: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>HTTP</span>
            <input
              value={settings.httpPort}
              disabled={locked}
              inputMode="numeric"
              onChange={(event) => session.patchSettings({ httpPort: Number(event.target.value) })}
            />
          </label>
        </div>
        <p>Кнопка включает Astral для Windows и возвращает прежний прокси, когда вы её выключаете.</p>
        {phase === 'connected' && snapshot.socks && (
          <p className="fine">
            {snapshot.socks}
            {snapshot.http ? ` · ${snapshot.http}` : ''}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="solid">
            Готово
          </button>
        </div>
      </form>
    </div>
  )
}

function useManualPings(servers: ServerProfile[]) {
  const [pings, setPings] = useState<Record<string, number>>({})
  const [busyIds, setBusyIds] = useState<string[]>([])
  const run = useCallback(async (ids?: string[]) => {
    const targets = servers.filter((item) => item.host && item.protocol !== 'direct' && (!ids || ids.includes(item.id)))
    if (!targets.length || busyIds.length) return
    const running = targets.map((item) => item.id)
    setBusyIds(running)
    setPings((current) => {
      const next = { ...current }
      for (const id of running) delete next[id]
      return next
    })
    try {
      for (let index = 0; index < targets.length; index += 4) {
        const slice = targets.slice(index, index + 4)
        const rows = await Promise.all(
          slice.map(async (item) => [item.id, await probe(item.host, Number(item.port))] as const),
        )
        setPings((current) => {
          const next = { ...current }
          for (const [id, ms] of rows) next[id] = ms
          return next
        })
        setBusyIds((current) => current.filter((id) => !slice.some((item) => item.id === id)))
      }
    } finally {
      setBusyIds([])
    }
  }, [busyIds.length, servers])
  return { pings, busy: busyIds.length > 0, busyIds, run }
}
