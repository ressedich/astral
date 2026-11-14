export type Mode = 'tun' | 'proxy'
export type Phase = 'idle' | 'connecting' | 'connected' | 'error'
export type Protocol = 'direct' | 'socks5' | 'http' | 'vless' | 'hysteria2'

export type VlessLink = {
  uuid: string
  flow: string
  network: string
  security: string
  sni: string
  fp: string
  pbk: string
  sid: string
  path: string
  hostHeader: string
  serviceName: string
  alpn: string
  packetEncoding: string
  mode: string
}

export type ServerProfile = {
  id: string
  name: string
  host: string
  port: number
  protocol: Protocol
  username: string
  password: string
  subId: string | null
  vless: VlessLink | null
  core: Record<string, unknown> | null
  xray: Record<string, unknown> | null
}

export type Subscription = {
  id: string
  name: string
  url: string
  updatedAt: number | null
  announce: string
  upload: number | null
  download: number | null
  total: number | null
  expire: number | null
  known: boolean
}

export type Settings = {
  mode: Mode
  serverId: string
  servers: ServerProfile[]
  subscriptions: Subscription[]
  socksPort: number
  httpPort: number
  systemProxy: boolean
  tunName: string
  mtu: number
  dns: string
  allowRoutes: boolean
}

export type SessionSnapshot = {
  phase: Phase
  mode: Mode
  message: string
  startedAt: number | null
  rx: number
  tx: number
  egressIp: string | null
  socks: string | null
  http: string | null
  systemProxy: boolean
  tunName: string | null
}

export type ConnectBody = {
  mode: Mode
  upstream: {
    type: Protocol
    host: string
    port: number
    username: string
    password: string
    vless: VlessLink | null
    core: Record<string, unknown> | null
    xray: Record<string, unknown> | null
  }
  proxy: {
    socksPort: number
    httpPort: number
    systemProxy: boolean
  }
  tun: {
    name: string
    mtu: number
    dns: string
    allowRoutes: boolean
  }
}

export type ImportedServer = {
  name: string
  host: string
  port: number
  protocol: Protocol
  vless: VlessLink | null
  core: Record<string, unknown> | null
  xray: Record<string, unknown> | null
}

export type ImportResult = {
  name: string
  url: string
  servers: ImportedServer[]
  info: {
    announce: string
    upload: number | null
    download: number | null
    total: number | null
    expire: number | null
  }
}
