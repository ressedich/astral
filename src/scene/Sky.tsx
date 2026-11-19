import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Phase } from '../types'

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function glowTexture(size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()
  const half = size / 2
  const glow = ctx.createRadialGradient(half, half, 0, half, half, half)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.12, 'rgba(255,255,255,0.92)')
  glow.addColorStop(0.3, 'rgba(255,255,255,0.3)')
  glow.addColorStop(0.58, 'rgba(255,255,255,0.06)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function veilTexture(seed: number) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()
  const rand = mulberry32(seed)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 12; i += 1) {
    const x = size * (0.18 + rand() * 0.64)
    const y = size * (0.2 + rand() * 0.6)
    const r = size * (0.18 + rand() * 0.3)
    const alpha = 0.016 + rand() * 0.022
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, `rgba(220,230,255,${alpha.toFixed(4)})`)
    blob.addColorStop(0.6, `rgba(200,214,255,${(alpha * 0.4).toFixed(4)})`)
    blob.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = blob
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function starField(count: number, spread: number, depth: number, seed: number) {
  const rand = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rand() - 0.5) * spread
    positions[i * 3 + 1] = (rand() - 0.5) * spread * 0.7
    positions[i * 3 + 2] = (rand() - 0.5) * depth
    speeds[i] = 0.3 + rand() * 1.5
    const tone = rand()
    const level = 0.4 + rand() * 0.6
    colors[i * 3] = level * (tone < 0.5 ? 0.84 : 1)
    colors[i * 3 + 1] = level * 0.93
    colors[i * 3 + 2] = level * (tone < 0.5 ? 1 : 0.82)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return { geometry, positions, speeds }
}

function ringGeometry(radius: number, segments: number, seed: number, strength: number) {
  const positions = new Float32Array((segments + 1) * 3)
  const colors = new Float32Array((segments + 1) * 3)
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.sin(angle) * radius
    positions[i * 3 + 2] = 0
    const wave = 0.16 + 0.84 * Math.pow(0.5 + 0.5 * Math.sin(angle * 1.5 + seed), 2.2)
    const level = wave * strength
    colors[i * 3] = level
    colors[i * 3 + 1] = level
    colors[i * 3 + 2] = level
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function trailGeometry(radius: number, span: number, segments: number, strength: number) {
  const positions = new Float32Array((segments + 1) * 3)
  const colors = new Float32Array((segments + 1) * 3)
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const angle = -span + span * t
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.sin(angle) * radius
    positions[i * 3 + 2] = 0
    const level = Math.pow(t, 2.2) * strength
    colors[i * 3] = level
    colors[i * 3 + 1] = level
    colors[i * 3 + 2] = level
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function dustField(count: number, inner: number, outer: number, seed: number) {
  const rand = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2
    const radius = inner + Math.pow(rand(), 1.4) * (outer - inner)
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.sin(angle) * radius
    positions[i * 3 + 2] = (rand() - 0.5) * 0.06
    const level = 0.16 + rand() * 0.5
    colors[i * 3] = level
    colors[i * 3 + 1] = level
    colors[i * 3 + 2] = level
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

type Runner = {
  trail: THREE.Group
  bead: THREE.Sprite
  glow: THREE.Sprite
  angle: number
  speed: number
  size: number
}

type Shooter = {
  line: THREE.Line
  material: THREE.LineBasicMaterial
  active: boolean
  age: number
  life: number
  from: THREE.Vector3
  direction: THREE.Vector3
  length: number
}

export function Sky({ phase }: { phase: Phase }) {
  const host = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const root = host.current
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setClearColor(0x010101, 1)
    const density = window.devicePixelRatio || 1
    renderer.setPixelRatio(Math.min(2.5, Math.max(2, density)))
    const canvas = renderer.domElement
    canvas.className = 'sky'
    canvas.style.opacity = '0'
    canvas.style.transition = 'opacity 1500ms ease'
    root.appendChild(canvas)
    const reveal = window.setTimeout(() => {
      canvas.style.opacity = '1'
    }, 40)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60)
    camera.position.set(0, 0, 6)

    const glow = glowTexture()
    const disposables: Array<{ dispose: () => void }> = [glow]
    const track = <T extends { dispose: () => void }>(item: T) => {
      disposables.push(item)
      return item
    }

    const sky = new THREE.Group()
    scene.add(sky)

    const veilMaterial = track(
      new THREE.MeshBasicMaterial({
        map: track(veilTexture(23)),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    const veil = new THREE.Mesh(track(new THREE.PlaneGeometry(32, 32)), veilMaterial)
    veil.position.z = -15
    sky.add(veil)

    const layers = [
      { count: 1200, spread: 22, depth: 22, size: 0.032, opacity: 0.4, shift: 0 },
      { count: 520, spread: 15, depth: 15, size: 0.058, opacity: 0.6, shift: 1.9 },
      { count: 180, spread: 12, depth: 11, size: 0.096, opacity: 0.85, shift: 3.4 },
      { count: 30, spread: 10, depth: 9, size: 0.135, opacity: 0.95, shift: 4.9 },
    ].map((item, index) => {
      const made = starField(item.count, item.spread, item.depth, 7 + index * 13)
      const material = track(
        new THREE.PointsMaterial({
          map: glow,
          color: 0xffffff,
          size: item.size,
          transparent: true,
          opacity: item.opacity,
          depthWrite: false,
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        }),
      )
      const points = new THREE.Points(track(made.geometry), material)
      sky.add(points)
      return { ...made, material, base: item.opacity, shift: item.shift }
    })

    const rig = new THREE.Group()
    rig.position.set(0, 0.08, 0)
    scene.add(rig)

    const starHalo = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glow,
          color: 0xe9f0ff,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    )
    starHalo.scale.setScalar(2.5)
    rig.add(starHalo)

    const starCore = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glow,
          color: 0xffffff,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    )
    starCore.scale.setScalar(0.42)
    rig.add(starCore)

    const flareMaterial = track(
      new THREE.MeshBasicMaterial({
        map: glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    const flareH = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), flareMaterial)
    flareH.scale.set(2.6, 0.03, 1)
    rig.add(flareH)
    const flareV = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), track(flareMaterial.clone()))
    flareV.scale.set(0.03, 1.9, 1)
    rig.add(flareV)

    const disk = new THREE.Group()
    disk.rotation.set(1.16, 0.08, 0.05)
    rig.add(disk)

    const ringDefs = [
      { radius: 0.66, speed: 0.1, strength: 0.38, seed: 0.7 },
      { radius: 0.98, speed: -0.065, strength: 0.3, seed: 2.5 },
      { radius: 1.36, speed: 0.04, strength: 0.22, seed: 4.4 },
    ]
    const rings = ringDefs.map((def) => {
      const line = new THREE.Line(
        track(ringGeometry(def.radius, 260, def.seed, def.strength)),
        track(
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      )
      disk.add(line)
      return { ...def, line }
    })

    const runners: Runner[] = []
    const runnerDefs = [
      { radius: 0.98, size: 0.052, speed: 0.32, phase: 1.2, span: 0.7 },
      { radius: 1.36, size: 0.036, speed: -0.18, phase: 3.6, span: 0.55 },
    ]
    for (const def of runnerDefs) {
      const trail = new THREE.Group()
      trail.rotation.z = def.phase
      disk.add(trail)
      trail.add(
        new THREE.Line(
          track(trailGeometry(def.radius, def.span, 24, 0.55)),
          track(
            new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.9,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              toneMapped: false,
            }),
          ),
        ),
      )
      const glowSprite = new THREE.Sprite(
        track(
          new THREE.SpriteMaterial({
            map: glow,
            color: 0xdfeaff,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      )
      glowSprite.scale.setScalar(def.size * 5)
      glowSprite.position.set(def.radius, 0, 0)
      trail.add(glowSprite)
      const bead = new THREE.Sprite(
        track(
          new THREE.SpriteMaterial({
            map: glow,
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      )
      bead.scale.setScalar(def.size)
      bead.position.set(def.radius, 0, 0)
      trail.add(bead)
      runners.push({ trail, bead, glow: glowSprite, angle: def.phase, speed: def.speed, size: def.size })
    }

    const cometPlane = new THREE.Group()
    cometPlane.rotation.set(0.94, -0.46, 0.18)
    rig.add(cometPlane)
    const comet: Runner = (() => {
      const radius = 1.72
      const trail = new THREE.Group()
      cometPlane.add(trail)
      trail.add(
        new THREE.Line(
          track(trailGeometry(radius, 0.62, 28, 0.7)),
          track(
            new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.85,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              toneMapped: false,
            }),
          ),
        ),
      )
      const glowSprite = new THREE.Sprite(
        track(
          new THREE.SpriteMaterial({
            map: glow,
            color: 0xe6eeff,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      )
      glowSprite.scale.setScalar(0.36)
      glowSprite.position.set(radius, 0, 0)
      trail.add(glowSprite)
      const bead = new THREE.Sprite(
        track(
          new THREE.SpriteMaterial({
            map: glow,
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      )
      bead.scale.setScalar(0.07)
      bead.position.set(radius, 0, 0)
      trail.add(bead)
      return { trail, bead, glow: glowSprite, angle: 2.1, speed: 0.14, size: 0.07 }
    })()

    const diskGlow = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glow,
          color: 0xcfe0ff,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ),
    )
    diskGlow.scale.setScalar(3.2)
    diskGlow.position.z = -0.02
    disk.add(diskGlow)

    const dust = new THREE.Points(
      track(dustField(240, 0.44, 1.7, 71)),
      track(
        new THREE.PointsMaterial({
          map: glow,
          color: 0xffffff,
          size: 0.03,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        }),
      ),
    )
    disk.add(dust)

    const shockMaterial = track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    const shock = new THREE.Mesh(track(new THREE.RingGeometry(0.97, 1, 180)), shockMaterial)
    shock.position.copy(rig.position)
    scene.add(shock)

    const shooters: Shooter[] = []
    for (let i = 0; i < 4; i += 1) {
      const geometry = track(new THREE.BufferGeometry())
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
      const material = track(
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      )
      const line = new THREE.Line(geometry, material)
      scene.add(line)
      shooters.push({
        line,
        material,
        active: false,
        age: 0,
        life: 1.2,
        from: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        length: 1,
      })
    }

    const streakCount = 120
    const streakPositions = new Float32Array(streakCount * 6)
    const streakSeeds: Array<{ angle: number; radius: number; speed: number; z: number }> = []
    const streakRand = mulberry32(97)
    for (let i = 0; i < streakCount; i += 1) {
      streakSeeds.push({
        angle: streakRand() * Math.PI * 2,
        radius: 0.4 + streakRand() * 2.2,
        speed: 0.5 + streakRand() * 1.5,
        z: (streakRand() - 0.5) * 2.4,
      })
    }
    const streakGeometry = track(new THREE.BufferGeometry())
    streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3))
    const streakMaterial = track(
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    )
    const streaks = new THREE.LineSegments(streakGeometry, streakMaterial)
    scene.add(streaks)

    let warp = 0
    let elapsed = 0
    let shockAge = Infinity
    let nextShoot = 1.5
    let previous = phaseRef.current
    const pointer = { x: 0, y: 0 }
    const look = { x: 0, y: 0 }
    const head = new THREE.Vector3()

    const onPointer = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      pointer.y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
    }
    root.addEventListener('pointermove', onPointer)

    const spawnShooter = (bright: boolean) => {
      const slot = shooters.find((item) => !item.active)
      if (!slot) return
      slot.from.set((Math.random() - 0.5) * 8.5, 1 + Math.random() * 1.6, -2.5)
      const angle = Math.PI * (1.16 + Math.random() * 0.2)
      slot.direction.set(Math.cos(angle), Math.sin(angle), 0)
      slot.length = (0.8 + Math.random() * 1.1) * (bright ? 1.6 : 1)
      slot.life = (1 + Math.random() * 0.45) * (bright ? 0.8 : 1)
      slot.age = 0
      slot.active = true
      slot.material.opacity = 0
    }

    const clock = new THREE.Clock()
    let frame = 0

    const draw = () => {
      frame = requestAnimationFrame(draw)
      const delta = Math.min(clock.getDelta(), 0.05)
      const live = phaseRef.current
      if (live === 'connecting' && previous !== 'connecting') {
        shockAge = 0
        spawnShooter(true)
        spawnShooter(true)
      }
      previous = live
      elapsed += delta * (reduce ? 0.55 : 1)
      const target = live === 'connecting' ? 1 : live === 'connected' ? 0.32 : live === 'error' ? 0.08 : 0
      warp += (target - warp) * Math.min(1, delta * (target > warp ? 1.4 : 1.1))
      shockAge += delta

      if (!reduce) {
        look.x += (pointer.x * 0.36 - look.x) * Math.min(1, delta * 1.8)
        look.y += (pointer.y * 0.24 - look.y) * Math.min(1, delta * 1.8)
      }

      sky.rotation.y = elapsed * (0.002 + warp * 0.008) + look.x * 0.04
      sky.rotation.x = look.y * 0.03
      veil.rotation.z = elapsed * 0.002
      rig.rotation.y = look.x * 0.14 + Math.sin(elapsed * 0.13) * 0.05
      rig.rotation.x = look.y * 0.1 + Math.cos(elapsed * 0.11) * 0.02
      disk.rotation.z = 0.05 + Math.sin(elapsed * 0.07) * 0.04

      const speed = (reduce ? 0.5 : 1) + warp * (reduce ? 2.4 : 4.2)
      for (const ring of rings) {
        ring.line.rotation.z += ring.speed * speed * delta
      }
      for (const runner of [...runners, comet]) {
        runner.angle += runner.speed * speed * delta
        runner.trail.rotation.z = runner.angle
        runner.bead.scale.setScalar(runner.size * (1 + warp * 0.16))
        runner.glow.scale.setScalar(runner.size * (5 + warp * 1.6))
        ;(runner.glow.material as THREE.SpriteMaterial).opacity = 0.38 + warp * 0.2
      }
      dust.rotation.z += delta * (0.03 + warp * 0.18)
      ;(dust.material as THREE.PointsMaterial).opacity = 0.42 + warp * 0.24
      ;(diskGlow.material as THREE.SpriteMaterial).opacity = 0.09 + warp * 0.16

      const pulse = 0.5 + Math.sin(elapsed * 0.8) * 0.5
      starHalo.scale.setScalar(2.5 + pulse * 0.05 + warp * 0.55)
      starCore.scale.setScalar(0.42 + pulse * 0.006 + warp * 0.05)
      ;(starHalo.material as THREE.SpriteMaterial).opacity = 0.24 + pulse * 0.04 + warp * 0.18
      flareMaterial.opacity = 0.06 + warp * 0.1
      flareH.scale.set(2.6 + warp * 1.2, 0.03 + warp * 0.008, 1)
      flareV.scale.set(0.03 + warp * 0.008, 1.9 + warp * 0.8, 1)

      for (const layer of layers) {
        layer.material.opacity = layer.base * (0.9 + 0.1 * Math.sin(elapsed * 0.8 + layer.shift))
        const drift = 0.14 + warp * 1.9
        const { positions, speeds, geometry } = layer
        for (let i = 0; i < speeds.length; i += 1) {
          const z = i * 3 + 2
          positions[z] += speeds[i] * drift * delta
          if (positions[z] > 6) {
            positions[i * 3] = (Math.random() - 0.5) * 22
            positions[i * 3 + 1] = (Math.random() - 0.5) * 15
            positions[z] = -22
          }
        }
        geometry.attributes.position.needsUpdate = true
      }

      if (shockAge < 1.6) {
        const t = shockAge / 1.6
        shock.scale.setScalar(0.5 + t * 4.6)
        shockMaterial.opacity = (1 - t) * (1 - t) * (0.18 + warp * 0.34)
      } else {
        shockMaterial.opacity = 0
      }

      if (elapsed > nextShoot) {
        spawnShooter(warp > 0.4)
        nextShoot = elapsed + (warp > 0.4 ? 1.6 + Math.random() * 2.2 : reduce ? 6 + Math.random() * 5 : 3.6 + Math.random() * 4.4)
      }
      for (const slot of shooters) {
        if (!slot.active) continue
        slot.age += delta
        const t = slot.age / slot.life
        if (t >= 1) {
          slot.active = false
          slot.material.opacity = 0
          continue
        }
        const positions = slot.line.geometry.attributes.position as THREE.BufferAttribute
        head.copy(slot.from).addScaledVector(slot.direction, t * 7)
        positions.setXYZ(0, head.x, head.y, head.z)
        positions.setXYZ(1, head.x - slot.direction.x * slot.length, head.y - slot.direction.y * slot.length, head.z)
        positions.needsUpdate = true
        slot.material.opacity = Math.pow(Math.sin(Math.PI * t), 0.7) * 0.75
      }

      const spread = 0.24 + warp * 1.8
      streakMaterial.opacity = warp * (reduce ? 0.12 : 0.22)
      if (warp > 0.01) {
        for (let i = 0; i < streakCount; i += 1) {
          const seed = streakSeeds[i]
          seed.radius += seed.speed * spread * delta
          if (seed.radius > 4.4) seed.radius = 0.3 + Math.random() * 0.35
          const r = seed.radius
          const length = 0.03 + warp * 0.3 * seed.speed
          const base = i * 6
          const cos = Math.cos(seed.angle)
          const sin = Math.sin(seed.angle)
          streakPositions[base] = cos * r
          streakPositions[base + 1] = sin * r * 0.9
          streakPositions[base + 2] = seed.z
          streakPositions[base + 3] = cos * (r - length)
          streakPositions[base + 4] = sin * (r - length) * 0.9
          streakPositions[base + 5] = seed.z
        }
        streakGeometry.attributes.position.needsUpdate = true
      }

      camera.position.x += (look.x * 0.24 - camera.position.x) * Math.min(1, delta * 1.5)
      camera.position.y += (-look.y * 0.14 - camera.position.y) * Math.min(1, delta * 1.5)
      camera.position.z = 6 - warp * 0.45
      camera.lookAt(0, 0.08, 0)

      renderer.render(scene, camera)
    }

    const resize = () => {
      const width = root.clientWidth || 1
      const height = root.clientHeight || 1
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      if (reduce) renderer.render(scene, camera)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(reveal)
      observer.disconnect()
      root.removeEventListener('pointermove', onPointer)
      for (const item of disposables) item.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  return <div className="sky-host" ref={host} />
}
