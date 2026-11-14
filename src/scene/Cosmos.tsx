import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Phase } from '../types'

const noise = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5; float f=0.0;
  for(int i=0;i<5;i++){ f+=a*snoise(p); p=p*2.02; a*=0.5; }
  return f;
}
`

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

function starField(count: number, seed: number, near: number, far: number) {
  const rand = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const radius = near + rand() * (far - near)
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(2 * rand() - 1)
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = radius * Math.cos(phi)
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    seeds[i] = rand()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geo.computeBoundingSphere()
  return geo
}

const starVert = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uLink;
uniform float uScale;
varying float vSeed;
void main(){
  vSeed=aSeed;
  vec4 mv=viewMatrix*modelMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mv;
  float tw=0.82+0.18*sin(uTime*(0.35+aSeed*1.6)+aSeed*30.0);
  gl_PointSize=uScale*(0.7+aSeed*2.8)*tw*(210.0/max(1.0,-mv.z))*(1.0+uLink*0.35);
}
`

const starFrag = /* glsl */ `
precision highp float;
uniform float uGain;
varying float vSeed;
void main(){
  vec2 p=gl_PointCoord-0.5;
  float d=length(p);
  if(d>0.5) discard;
  float glow=pow(smoothstep(0.5,0.0,d),1.45);
  float shade=mix(0.55,1.0,vSeed);
  gl_FragColor=vec4(vec3(shade),glow*uGain*(0.25+vSeed*0.75));
}
`

const bandVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`

const bandFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLink;
varying vec2 vUv;
${noise}
void main(){
  float n=fbm(vec3(vUv*vec2(1.4,3.2),uTime*0.008));
  float streak=smoothstep(0.15,0.72,n);
  float fade=smoothstep(0.0,0.18,vUv.y)*smoothstep(1.0,0.55,vUv.y);
  fade*=smoothstep(0.0,0.12,vUv.x)*smoothstep(1.0,0.2,vUv.x);
  float alpha=streak*fade*(0.07+uLink*0.05);
  gl_FragColor=vec4(vec3(0.85),alpha);
}
`

const moonVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  vObj=position;
  vec4 world=modelMatrix*vec4(position,1.0);
  vWorld=world.xyz;
  vNormalW=normalize(mat3(modelMatrix)*normal);
  gl_Position=projectionMatrix*viewMatrix*world;
}
`

const moonFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLink;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
${noise}
void main(){
  vec3 n=normalize(vNormalW);
  vec3 viewDir=normalize(cameraPosition-vWorld);
  vec3 light=normalize(vec3(-0.55,0.35,0.75));
  float ndl=clamp(dot(n,light),0.0,1.0);
  float fres=pow(1.0-clamp(dot(n,viewDir),0.0,1.0),2.4);
  float maria=smoothstep(0.15,0.85,fbm(vObj*2.4));
  float craters=smoothstep(0.55,0.92,fbm(vObj*7.5+2.0));
  float shade=mix(0.16,0.92,maria);
  shade=mix(shade,0.08,craters*0.55);
  shade*=0.08+0.92*pow(ndl,0.9);
  shade+=fres*(0.18+0.45*uLink);
  gl_FragColor=vec4(vec3(shade),1.0);
}
`

const haloFrag = /* glsl */ `
precision highp float;
uniform float uLink;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vec3 n=normalize(vNormalW);
  vec3 viewDir=normalize(cameraPosition-vWorld);
  float fres=pow(1.0-abs(dot(n,viewDir)),2.6);
  gl_FragColor=vec4(vec3(1.0),fres*(0.18+0.45*uLink));
}
`

const ringFrag = /* glsl */ `
precision highp float;
uniform float uLink;
varying float vRad;
void main(){
  float alpha=smoothstep(1.15,1.22,vRad)*smoothstep(1.42,1.3,vRad);
  alpha*=0.15+0.75*uLink;
  gl_FragColor=vec4(vec3(1.0),alpha);
}
`

const ringVert = /* glsl */ `
varying float vRad;
void main(){
  vRad=length(position.xy);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`

function Scene({ phase, reduce }: { phase: Phase; reduce: boolean }) {
  const far = useRef<THREE.ShaderMaterial>(null)
  const near = useRef<THREE.ShaderMaterial>(null)
  const bright = useRef<THREE.ShaderMaterial>(null)
  const band = useRef<THREE.ShaderMaterial>(null)
  const moon = useRef<THREE.ShaderMaterial>(null)
  const halo = useRef<THREE.ShaderMaterial>(null)
  const ring = useRef<THREE.ShaderMaterial>(null)
  const sky = useRef<THREE.Group>(null)
  const moonMesh = useRef<THREE.Mesh>(null)
  const ringGroup = useRef<THREE.Group>(null)
  const link = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const target = phase === 'connecting' || phase === 'connected' ? 1 : 0

  const geometry = useMemo(
    () => ({
      far: starField(2600, 4, 14, 40),
      near: starField(700, 19, 6, 16),
      bright: starField(80, 27, 5, 12),
    }),
    [],
  )

  const uniforms = useMemo(
    () => ({
      far: { uTime: { value: 0 }, uLink: { value: 0 }, uScale: { value: 1.15 }, uGain: { value: 0.55 } },
      near: { uTime: { value: 0 }, uLink: { value: 0 }, uScale: { value: 1.8 }, uGain: { value: 0.8 } },
      bright: { uTime: { value: 0 }, uLink: { value: 0 }, uScale: { value: 3.4 }, uGain: { value: 1 } },
      band: { uTime: { value: 0 }, uLink: { value: 0 } },
      moon: { uTime: { value: 0 }, uLink: { value: 0 } },
      halo: { uTime: { value: 0 }, uLink: { value: 0 } },
      ring: { uTime: { value: 0 }, uLink: { value: 0 } },
    }),
    [],
  )

  useEffect(() => {
    if (reduce) return
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduce])

  useFrame((state, delta) => {
    link.current = THREE.MathUtils.damp(link.current, target, reduce ? 8 : 1.4, delta)
    const time = reduce ? 8 : state.clock.elapsedTime
    const mats = [far, near, bright, band, moon, halo, ring]
    for (const ref of mats) {
      const mat = ref.current
      if (!mat) continue
      mat.uniforms.uTime.value = time
      mat.uniforms.uLink.value = link.current
    }
    if (!reduce && sky.current) sky.current.rotation.y = time * (0.012 + link.current * 0.03)
    if (!reduce && moonMesh.current) moonMesh.current.rotation.y = time * 0.04
    if (!reduce && ringGroup.current) ringGroup.current.rotation.z = time * (0.05 + link.current * 0.35)
    const camera = state.camera
    const px = reduce ? 0 : pointer.current.x
    const py = reduce ? 0 : pointer.current.y
    camera.position.x = THREE.MathUtils.damp(camera.position.x, px * 0.28, 1.8, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.04 - py * 0.16, 1.8, delta)
    camera.lookAt(0, 0.08, 0)
  })

  return (
    <>
      <color attach="background" args={['#000000']} />
      <group ref={sky}>
        <points geometry={geometry.far}>
          <shaderMaterial
            ref={far}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            uniforms={uniforms.far}
            vertexShader={starVert}
            fragmentShader={starFrag}
          />
        </points>
        <points geometry={geometry.near}>
          <shaderMaterial
            ref={near}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            uniforms={uniforms.near}
            vertexShader={starVert}
            fragmentShader={starFrag}
          />
        </points>
        <points geometry={geometry.bright}>
          <shaderMaterial
            ref={bright}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            uniforms={uniforms.bright}
            vertexShader={starVert}
            fragmentShader={starFrag}
          />
        </points>
      </group>
      <mesh position={[0.2, 0.35, -4]} rotation={[0.5, 0.2, -0.45]}>
        <planeGeometry args={[14, 3.2]} />
        <shaderMaterial
          ref={band}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          uniforms={uniforms.band}
          vertexShader={bandVert}
          fragmentShader={bandFrag}
        />
      </mesh>
      <group position={[0.15, 0.12, 0]}>
        <mesh ref={moonMesh}>
          <sphereGeometry args={[0.78, 80, 80]} />
          <shaderMaterial ref={moon} uniforms={uniforms.moon} vertexShader={moonVert} fragmentShader={moonFrag} />
        </mesh>
        <mesh scale={1.06}>
          <sphereGeometry args={[0.78, 48, 48]} />
          <shaderMaterial
            ref={halo}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
            toneMapped={false}
            uniforms={uniforms.halo}
            vertexShader={moonVert}
            fragmentShader={haloFrag}
          />
        </mesh>
        <group ref={ringGroup} rotation={[1.15, 0.15, 0.2]}>
          <mesh>
            <ringGeometry args={[1.18, 1.4, 160]} />
            <shaderMaterial
              ref={ring}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              uniforms={uniforms.ring}
              vertexShader={ringVert}
              fragmentShader={ringFrag}
            />
          </mesh>
        </group>
      </group>
    </>
  )
}

export function Cosmos({ phase, reduce }: { phase: Phase; reduce: boolean }) {
  return (
    <Canvas
      className="cosmos"
      camera={{ position: [0, 0.05, 6.2], fov: 38, near: 0.1, far: 80 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl, camera }) => {
        gl.setClearColor('#000000')
        gl.toneMapping = THREE.NoToneMapping
        camera.lookAt(0, 0.08, 0)
      }}
    >
      <Scene phase={phase} reduce={reduce} />
    </Canvas>
  )
}
