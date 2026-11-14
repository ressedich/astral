import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Phase } from '../types'

function starTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.18, 'rgba(255,255,255,0.95)')
  glow.addColorStop(0.42, 'rgba(255,255,255,0.35)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function field(count: number, spread: number) {
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * spread
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.62
    positions[i * 3 + 2] = -Math.random() * 16
    speeds[i] = 0.45 + Math.random() * 1.6
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return { geometry, positions, speeds }
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    const canvas = renderer.domElement
    canvas.className = 'sky'
    root.appendChild(canvas)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40)
    camera.position.set(0, 0, 6)
    const group = new THREE.Group()
    scene.add(group)

    const texture = starTexture()
    const layers = [
      { count: 420, size: 0.045, spread: 14, opacity: 0.55 },
      { count: 140, size: 0.09, spread: 12, opacity: 0.8 },
      { count: 36, size: 0.16, spread: 10, opacity: 1 },
    ].map((item) => {
      const made = field(item.count, item.spread)
      const material = new THREE.PointsMaterial({
        map: texture,
        color: 0xffffff,
        size: item.size,
        transparent: true,
        opacity: item.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
      const points = new THREE.Points(made.geometry, material)
      group.add(points)
      return { ...made, material, points }
    })

    let drift = 0.22
    let yaw = 0
    const pointer = { x: 0, y: 0 }
    const onPointer = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1
    }
    root.addEventListener('pointermove', onPointer)

    const timer = new THREE.Timer()
    timer.connect(document)
    let frame = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      timer.update(now)
      const live = phaseRef.current
      const target = live === 'connecting' ? 2.4 : live === 'connected' ? 0.85 : 0.2
      drift += (target - drift) * (reduce ? 1 : 0.05)
      yaw += (pointer.x * 0.35 - yaw) * 0.04
      group.rotation.y = yaw
      group.rotation.x = pointer.y * -0.08
      if (!reduce) {
        for (const layer of layers) {
          const { positions, speeds, geometry } = layer
          for (let i = 0; i < speeds.length; i += 1) {
            const z = i * 3 + 2
            positions[z] += speeds[i] * drift * 0.03
            if (positions[z] > 5) {
              positions[i * 3] = (Math.random() - 0.5) * 14
              positions[i * 3 + 1] = (Math.random() - 0.5) * 8
              positions[z] = -14
            }
          }
          geometry.attributes.position.needsUpdate = true
        }
      }
      renderer.render(scene, camera)
    }

    const resize = () => {
      const width = root.clientWidth || 1
      const height = root.clientHeight || 1
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('pointermove', onPointer)
      timer.dispose()
      texture.dispose()
      for (const layer of layers) {
        layer.geometry.dispose()
        layer.material.dispose()
      }
      renderer.dispose()
      canvas.remove()
    }
  }, [])

  return <div className="sky-host" ref={host} />
}
