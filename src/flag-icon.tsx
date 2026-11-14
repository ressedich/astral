type Paint = { h?: string[]; v?: string[]; cross?: string; ring?: string; disc?: string; canton?: string }

const FLAGS: Record<string, Paint> = {
  DE: { h: ['#000', '#dd0000', '#ffce00'] },
  NL: { h: ['#ae1c28', '#fff', '#21468b'] },
  PL: { h: ['#fff', '#dc143c'] },
  RU: { h: ['#fff', '#0039a6', '#d52b1e'] },
  FR: { v: ['#0055a4', '#fff', '#ef4135'] },
  IT: { v: ['#009246', '#fff', '#ce2b37'] },
  BE: { v: ['#000', '#fdda24', '#ef3340'] },
  IE: { v: ['#169b62', '#fff', '#ff883e'] },
  RO: { v: ['#002b7f', '#fcd116', '#ce1126'] },
  BG: { h: ['#fff', '#00966e', '#d62612'] },
  HU: { h: ['#ce2939', '#fff', '#477050'] },
  AT: { h: ['#ed2939', '#fff', '#ed2939'] },
  EE: { h: ['#0072ce', '#000', '#fff'] },
  LV: { h: ['#9e3039', '#fff', '#9e3039'] },
  LT: { h: ['#fdb913', '#006a44', '#c1272d'] },
  UA: { h: ['#005bbb', '#ffd500'] },
  AM: { h: ['#d90012', '#0033a0', '#f2a800'] },
  AE: { v: ['#00732f', '#fff', '#000'] },
  TH: { h: ['#a51931', '#f4f5f8', '#2d2a4a', '#f4f5f8', '#a51931'] },
  ID: { h: ['#ce1126', '#fff'] },
  MC: { h: ['#ce1126', '#fff'] },
  ES: { h: ['#aa151b', '#f1bf00', '#aa151b'] },
  AR: { h: ['#74acdf', '#fff', '#74acdf'] },
  SE: { cross: '#006aa7:#fecc00' },
  FI: { cross: '#fff:#003580' },
  DK: { cross: '#c60c30:#fff' },
  NO: { cross: '#ba0c2f:#fff:#00205b' },
  IS: { cross: '#02529c:#fff:#dc1e35' },
  CH: { cross: '#d52b1e:#fff', disc: 'plus' },
  JP: { h: ['#fff'], disc: '#bc002d' },
  KR: { h: ['#fff'], disc: '#cd2e3a' },
  BD: { h: ['#006a4e'], disc: '#f42a41' },
  TR: { h: ['#e30a17'], disc: 'crescent' },
  US: { h: ['#bf0a30', '#fff'], canton: '#002868' },
  GB: { cross: 'jack' },
  AU: { cross: 'jack', canton: 'stars' },
  CA: { v: ['#ff0000', '#fff', '#ff0000'] },
  PT: { v: ['#006600', '#ff0000'] },
  MX: { v: ['#006847', '#fff', '#ce1126'] },
  BR: { h: ['#009c3b'], disc: '#ffdf00' },
  IN: { h: ['#ff9933', '#fff', '#138808'] },
  IL: { h: ['#fff', '#0038b8', '#fff'] },
  CZ: { h: ['#fff', '#d7141a'], canton: '#11457e' },
  SG: { h: ['#ef3340', '#fff'] },
  HK: { h: ['#de2910'] },
  TW: { h: ['#fe0000'], canton: '#000095' },
  VN: { h: ['#da251d'], disc: '#ff0' },
  MY: { h: ['#cc0001', '#fff'], canton: '#010066' },
  KZ: { h: ['#00afca'] },
  GE: { cross: '#fff:#ff0000', disc: 'plus' },
  RS: { h: ['#c6363c', '#0c4076', '#fff'] },
  MD: { v: ['#003da5', '#ffd200', '#c8102e'] },
  GR: { h: ['#0d5eaf', '#fff'], canton: '#0d5eaf' },
}

function bars(colors: string[], vertical: boolean) {
  const size = colors.length
  return colors.map((fill, index) =>
    vertical ? (
      <rect key={fill + index} x={(60 / size) * index} y={0} width={60 / size + 0.4} height={40} fill={fill} />
    ) : (
      <rect key={fill + index} x={0} y={(40 / size) * index} width={60} height={40 / size + 0.4} fill={fill} />
    ),
  )
}

function nordic(bg: string, cross: string, outline?: string) {
  return (
    <>
      <rect width="60" height="40" fill={bg} />
      {outline && (
        <>
          <rect x="14" width="14" height="40" fill={outline} />
          <rect y="12" width="60" height="14" fill={outline} />
        </>
      )}
      <rect x="17" width="8" height="40" fill={cross} />
      <rect y="15" width="60" height="8" fill={cross} />
    </>
  )
}

function jack() {
  return (
    <>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0 L60 40 M60 0 L0 40" stroke="#fff" strokeWidth="7" />
      <path d="M0 0 L60 40" stroke="#C8102E" strokeWidth="2.4" />
      <path d="M60 0 L0 40" stroke="#C8102E" strokeWidth="2.4" />
      <rect x="26" width="8" height="40" fill="#fff" />
      <rect y="16" width="60" height="8" fill="#fff" />
      <rect x="28" width="4" height="40" fill="#C8102E" />
      <rect y="18" width="60" height="4" fill="#C8102E" />
    </>
  )
}

function paint(code: string) {
  if (code === 'EU') {
    const stars = []
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 - Math.PI / 2
      stars.push(
        <circle key={index} cx={30 + Math.cos(angle) * 11} cy={20 + Math.sin(angle) * 7} r="1.15" fill="#fc0" />,
      )
    }
    return (
      <>
        <rect width="60" height="40" fill="#039" />
        {stars}
      </>
    )
  }
  if (code === 'US') {
    const rows = []
    for (let index = 0; index < 13; index += 1) {
      rows.push(
        <rect
          key={index}
          y={(40 / 13) * index}
          width="60"
          height={40 / 13 + 0.3}
          fill={index % 2 ? '#fff' : '#bf0a30'}
        />,
      )
    }
    return (
      <>
        {rows}
        <rect width="26" height="21" fill="#002868" />
      </>
    )
  }
  if (code === 'GB') return jack()
  if (code === 'AU') {
    return (
      <>
        <rect width="60" height="40" fill="#012169" />
        <g transform="scale(0.5)">{jack()}</g>
        <circle cx="44" cy="28" r="2" fill="#fff" />
        <circle cx="50" cy="14" r="1.6" fill="#fff" />
        <circle cx="36" cy="22" r="1.4" fill="#fff" />
      </>
    )
  }
  const flag = FLAGS[code]
  if (!flag) return null
  if (flag.cross === 'jack') return jack()
  if (flag.cross && flag.disc === 'plus') {
    const [bg, cross] = flag.cross.split(':')
    return (
      <>
        <rect width="60" height="40" fill={bg} />
        <rect x="26" y="8" width="8" height="24" fill={cross} />
        <rect x="18" y="16" width="24" height="8" fill={cross} />
      </>
    )
  }
  if (flag.cross) {
    const [bg, cross, inner] = flag.cross.split(':')
    return nordic(bg, inner || cross, inner ? cross : undefined)
  }
  return (
    <>
      {flag.h && bars(flag.h, false)}
      {flag.v && bars(flag.v, true)}
      {flag.canton && <rect width="24" height="16" fill={flag.canton} />}
      {flag.disc && flag.disc !== 'crescent' && flag.disc !== 'plus' && (
        <circle cx="30" cy="20" r="8" fill={flag.disc} />
      )}
      {flag.disc === 'crescent' && (
        <>
          <circle cx="28" cy="20" r="8" fill="#fff" />
          <circle cx="31" cy="20" r="6.5" fill="#e30a17" />
        </>
      )}
    </>
  )
}

export function FlagIcon({ code }: { code: string }) {
  const body = paint(code)
  if (!body) {
    return <span className="flag bare" aria-hidden="true" />
  }
  return (
    <svg className="flag-icon" viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {body}
    </svg>
  )
}
