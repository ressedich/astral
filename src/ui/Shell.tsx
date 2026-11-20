import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getSystem, probe, setAutostart } from '../api'
import { FlagIcon } from '../flag-icon'
import { countryOf, labelOf } from '../flags'
import { formatBytes, formatDuration } from '../format'
import { useSession } from '../session'
import { Sky } from '../scene/Sky'
import type { AppUpdateState } from '../vite-env'
import type { ServerProfile, Subscription } from '../types'

export function Shell() {
  const session = useSession()
  const { settings, server, phase, message, snapshot, locked, stopping, sheet, setSheet } = session
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
            <IconButton title="Пинг" disabled={ping.busy || !settings.servers.length} onClick={() => void ping.run()}>
              <PulseIcon />
            </IconButton>
            <IconButton title="Добавить" onClick={() => setAddOpen(true)}>
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
                    disabled={ping.busy}
                    onClick={() => void ping.run(nodes.map((item) => item.id))}
                  >
                    пинг
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={refreshing === sub.id}
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
            className={
              stopping
                ? 'power live stopping'
                : phase === 'connecting'
                  ? 'power live connecting'
                  : live
                    ? 'power live'
                    : 'power'
            }
            disabled={stopping}
            onClick={() => session.choose(live ? 'off' : selectedMode)}
          >
            <PowerIcon />
            {stopping ? 'Отключение' : phase === 'connecting' ? 'Подключение' : live ? 'Выключить' : 'Включить'}
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
        {!sheet && (
          <button
            type="button"
            className="settings-tab"
            aria-label="Настройки"
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
          >
            <SlidersIcon />
            <span>Настройки</span>
          </button>
        )}
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function PlugIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 2v3.2M10.5 2v3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3.6 5.2h8.8v1.6a4.4 4.4 0 0 1-8.8 0Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 11.3V14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="4" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="12" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.9 4H9a3 3 0 0 1 3 3v3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 8A5.2 5.2 0 1 1 11.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M13.4 2.4v3.3h-3.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.2" y="3" width="11.6" height="7.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 13.4h4M8 10.6v2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  const { settings, locked, snapshot, phase, stopping } = session
  const busy = phase === 'connecting' || stopping
  const [system, setSystem] = useState<{ available: boolean; enabled: boolean } | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoError, setAutoError] = useState('')
  const appUpdate = useAppUpdate()
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [refreshNote, setRefreshNote] = useState('')
  const subscriptions = settings.subscriptions.filter((item) => item.url)
  const lastUpdated = subscriptions.reduce<number | null>(
    (latest, item) => (item.updatedAt && (!latest || item.updatedAt > latest) ? item.updatedAt : latest),
    null,
  )
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'ещё не обновлялась'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    getSystem()
      .then((value) => {
        if (!cancelled) setSystem(value.autostart)
      })
      .catch(() => {
        if (!cancelled) setSystem({ available: false, enabled: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function toggleAutostart(enabled: boolean) {
    if (autoBusy) return
    setAutoBusy(true)
    setAutoError('')
    try {
      const value = await setAutostart(enabled)
      setSystem(value.autostart)
    } catch (reason) {
      setAutoError(reason instanceof Error ? reason.message : 'Не удалось изменить автозапуск')
    } finally {
      setAutoBusy(false)
    }
  }

  async function refreshAll() {
    if (refreshBusy) return
    setRefreshBusy(true)
    setRefreshNote('')
    try {
      const result = await session.refreshAll()
      if (!result.updated && !result.failed) setRefreshNote('Нет подписок для обновления')
      else if (!result.updated) setRefreshNote('Не удалось обновить подписки')
      else if (result.failed) setRefreshNote(`Обновлено: ${result.updated} · не удалось: ${result.failed}`)
      else setRefreshNote(`Обновлено подписок: ${result.updated}`)
    } catch (reason) {
      setRefreshNote(reason instanceof Error ? reason.message : 'Не удалось обновить подписки')
    } finally {
      setRefreshBusy(false)
    }
  }

  return (
    <div className="sheet-layer" onMouseDown={onClose}>
      <form
        className="settings-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onClose()
        }}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <header className="settings-head">
          <div>
            <h2>Настройки</h2>
            <p>Подключение, маршрутизация и подписки</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>
        <div className="settings-scroll">
          <section className="settings-block">
            <div className="block-head">
              <span className="block-icon"><PlugIcon /></span>
              <div>
                <h3>Подключение</h3>
                <p>Порты локального прокси и параметры туннеля</p>
              </div>
            </div>
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
            <div className="grid-2">
              <label className="field">
                <span>Имя TUN</span>
                <input
                  value={settings.tunName}
                  disabled={locked}
                  maxLength={32}
                  onChange={(event) => session.patchSettings({ tunName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>MTU</span>
                <input
                  value={settings.mtu}
                  disabled={locked}
                  inputMode="numeric"
                  onChange={(event) => session.patchSettings({ mtu: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="field">
              <span>DNS</span>
              <input
                value={settings.dns}
                disabled={locked}
                placeholder="1.1.1.1"
                onChange={(event) => session.patchSettings({ dns: event.target.value })}
              />
            </label>
            {phase === 'connected' && snapshot.socks && (
              <p className="fine">
                {snapshot.socks}
                {snapshot.http ? ` · ${snapshot.http}` : ''}
              </p>
            )}
          </section>

          <section className="settings-block">
            <div className="block-head">
              <span className="block-icon"><RouteIcon /></span>
              <div>
                <h3>Маршрутизация</h3>
                <p>Правила из подписки применяются автоматически</p>
              </div>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.blockAds}
                disabled={locked}
                onChange={(event) => session.patchSettings({ blockAds: event.target.checked })}
              />
              <span>
                <b>Блокировать рекламу и трекеры</b>
                <small>Список geosite:category-ads-all, работает и без правил подписки.</small>
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.bypassLocal}
                disabled={locked}
                onChange={(event) => session.patchSettings({ bypassLocal: event.target.checked })}
              />
              <span>
                <b>Локальная сеть напрямую</b>
                <small>Принтеры, роутер и другие устройства в домашней сети не идут в туннель.</small>
              </span>
            </label>
            {locked && (
              <p className="fine offset">Изменения маршрутизации применятся после переподключения.</p>
            )}
          </section>

          <section className="settings-block">
            <div className="block-head">
              <span className="block-icon"><RefreshIcon /></span>
              <div>
                <h3>Подписки</h3>
                <p>Автоматическое обновление списка серверов</p>
              </div>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.autoRefresh}
                disabled={busy}
                onChange={(event) => session.patchSettings({ autoRefresh: event.target.checked })}
              />
              <span>
                <b>Обновлять автоматически</b>
                <small>
                  Подписок: {subscriptions.length} · обновлено {updatedLabel}
                </small>
              </span>
            </label>
            <div className="inline-row">
              <label className="field grow">
                <span>Период</span>
                <select
                  value={settings.refreshMinutes}
                  disabled={busy || !settings.autoRefresh}
                  onChange={(event) => session.patchSettings({ refreshMinutes: Number(event.target.value) })}
                >
                  <option value="30">каждые 30 минут</option>
                  <option value="60">каждый час</option>
                  <option value="180">каждые 3 часа</option>
                  <option value="360">каждые 6 часов</option>
                  <option value="720">каждые 12 часов</option>
                  <option value="1440">раз в сутки</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                disabled={refreshBusy || !subscriptions.length || busy}
                onClick={() => void refreshAll()}
              >
                {refreshBusy ? 'Обновляю…' : 'Обновить все'}
              </button>
            </div>
            {refreshNote && <p className="fine">{refreshNote}</p>}
          </section>

          <section className="settings-block">
            <div className="block-head">
              <span className="block-icon"><MonitorIcon /></span>
              <div>
                <h3>Система</h3>
                <p>Автозапуск и обновления Astral</p>
              </div>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={system?.enabled === true}
                disabled={autoBusy || !system?.available}
                onChange={(event) => void toggleAutostart(event.target.checked)}
              />
              <span>
                <b>Запускать при входе в Windows</b>
                <small>
                  {system?.available
                    ? 'Astral появится сразу после входа в систему.'
                    : 'Доступно в установленной версии Astral.'}
                </small>
              </span>
            </label>
            {autoError && <p className="form-error">{autoError}</p>}
            <div className="update-row">
              <div>
                <b>{appUpdate.version ? `Версия ${appUpdate.version}` : 'Обновления'}</b>
                <small>{appUpdate.message}</small>
              </div>
              <div className="update-actions">
                {appUpdate.status === 'ready' ? (
                  <button type="button" className="ghost" onClick={() => void appUpdate.install()}>
                    Установить и перезапустить
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost"
                    disabled={!appUpdate.canCheck || appUpdate.busy}
                    onClick={() => void appUpdate.check()}
                  >
                    {appUpdate.busy ? 'Проверяю…' : 'Проверить'}
                  </button>
                )}
                <a className="ghost" href="https://github.com/ressedich/astral/releases/latest" target="_blank" rel="noreferrer">
                  Релизы
                </a>
              </div>
            </div>
          </section>
        </div>
        <div className="form-actions">
          <button type="submit" className="solid">
            Готово
          </button>
        </div>
      </form>
    </div>
  )
}

const updateFallback: AppUpdateState = {
  version: '',
  status: 'unavailable',
  message: 'Доступно в установленной версии Astral.',
  percent: null,
  nextVersion: null,
}

function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(updateFallback)

  useEffect(() => {
    const api = window.astral
    if (!api) return
    void api.getUpdate().then(setState).catch(() => {})
    const unsubscribe = api.onUpdate(setState)
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'available'
  return {
    ...state,
    busy,
    canCheck: state.status !== 'unavailable' && Boolean(window.astral),
    check: async () => {
      const api = window.astral
      if (!api) return
      setState(await api.checkForUpdates())
    },
    install: async () => {
      const api = window.astral
      if (!api) return
      setState(await api.installUpdate())
    },
  }
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
