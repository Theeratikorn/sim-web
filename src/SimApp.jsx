import React, { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'

function RotatingCube(props) {
  // This reference will give us direct access to the THREE.Mesh object
  const meshRef = useRef()
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false)
  const [active, setActive] = useState(false)

  // Subscribe this component to the render-loop, rotate the mesh every frame
  useFrame((state, delta) => {
      if (meshRef.current) {
          meshRef.current.rotation.x += delta * 0.5
          meshRef.current.rotation.y += delta * 0.5
      }
  })

  return (
    <mesh
      {...props}
      ref={meshRef}
      scale={active ? 1.5 : 1}
      onClick={(event) => setActive(!active)}
      onPointerOver={(event) => setHover(true)}
      onPointerOut={(event) => setHover(false)}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? '#EC4899' : '#A855F7'} />
    </mesh>
  )
}

export default function SimApp() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
      {/* Lights */}
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />
      
      {/* 3D Object */}
      <RotatingCube position={[0, 0, 0]} />

      {/* Controls & Environment */}
      <OrbitControls makeDefault autoRotate autoRotateSpeed={1} />
      <ContactShadows position={[0, -1.5, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      <Environment preset="city" />
    </Canvas>
  )
}
