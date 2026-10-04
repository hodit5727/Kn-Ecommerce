import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Product, Product3DConfig } from '../../types/product';
import { RotateCw, ZoomIn, ZoomOut, Sparkles, Layers } from 'lucide-react';

interface Product3DViewerProps {
  product: Product;
  className?: string;
  autoRotate?: boolean;
}

export const Product3DViewer: React.FC<Product3DViewerProps> = ({
  product,
  className = 'h-96 w-full',
  autoRotate = true,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const isRotatingRef = useRef<boolean>(autoRotate);
  const isDraggingRef = useRef<boolean>(false);
  const [isRotating, setIsRotating] = useState<boolean>(autoRotate);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const toggleRotation = () => {
    const next = !isRotating;
    setIsRotating(next);
    isRotatingRef.current = next;
  };

  const handle360Spin = () => {
    if (!meshGroupRef.current) return;
    const group = meshGroupRef.current;
    const startY = group.rotation.y;
    const targetY = startY + Math.PI * 2;
    const startTime = performance.now();
    const duration = 1200;

    const spinStep = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      group.rotation.y = startY + (targetY - startY) * ease;
      if (progress < 1) {
        requestAnimationFrame(spinStep);
      }
    };
    requestAnimationFrame(spinStep);
  };

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const width = currentMount.clientWidth;
    const height = currentMount.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 3.8);

    // 3. Renderer with high-DPI and soft shadows
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    currentMount.innerHTML = '';
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xfff9f2, 1.4);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 2.4);
    mainLight.position.set(5, 8, 5);
    scene.add(mainLight);

    const rimLight = new THREE.DirectionalLight(0xf3e6d5, 1.6);
    rimLight.position.set(-5, 4, -4);
    scene.add(rimLight);

    const warmAccent = new THREE.PointLight(0xd45060, 0.9, 10);
    warmAccent.position.set(0, -2, 2);
    scene.add(warmAccent);

    // 5. Construct 3D Geometry representation based on product config
    const group = new THREE.Group();
    meshGroupRef.current = group;
    scene.add(group);

    const config: Product3DConfig = product.threeDConfig || {
      geometryType: 'watch',
      primaryColor: '#800020',
      metalness: 0.8,
      roughness: 0.2,
      scale: 1,
    };

    const pColor = config.primaryColor || '#800020';

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(pColor),
      metalness: config.metalness ?? 0.7,
      roughness: config.roughness ?? 0.25,
    });

    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6b325,
      metalness: 0.9,
      roughness: 0.15,
    });

    const silverMaterial = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      metalness: 0.95,
      roughness: 0.1,
    });

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.88,
      opacity: 1,
      transparent: true,
      roughness: 0.05,
      ior: 1.5,
    });

    const nameLower = (product.name || '').toLowerCase();
    const catLower = (product.category || '').toLowerCase();

    const isBottle = nameLower.includes('bottle') || nameLower.includes('water') || nameLower.includes('flask');
    const isWatch = config.geometryType === 'watch' || catLower.includes('watch') || catLower.includes('timepiece') || nameLower.includes('watch');
    const isPhone = catLower.includes('mobile') || nameLower.includes('phone') || nameLower.includes('iphone');

    if (isBottle) {
      // Sleek Vacuum Flask / Water Bottle
      const bottleBody = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 48);
      const bottleMesh = new THREE.Mesh(bottleBody, bodyMaterial);
      group.add(bottleMesh);

      const neckGeom = new THREE.CylinderGeometry(0.4, 0.65, 0.4, 32);
      const neckMesh = new THREE.Mesh(neckGeom, bodyMaterial);
      neckMesh.position.y = 1.25;
      group.add(neckMesh);

      const capGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 32);
      const capMesh = new THREE.Mesh(capGeom, silverMaterial);
      capMesh.position.y = 1.55;
      group.add(capMesh);

      const bandGeom = new THREE.TorusGeometry(0.705, 0.02, 16, 48);
      const bandMesh = new THREE.Mesh(bandGeom, goldMaterial);
      bandMesh.rotation.x = Math.PI / 2;
      bandMesh.position.y = 0.5;
      group.add(bandMesh);
    } else if (isWatch) {
      // Luxury Tourbillon Watch Assembly
      // Case
      const caseGeom = new THREE.CylinderGeometry(1.2, 1.2, 0.35, 64);
      const caseMesh = new THREE.Mesh(caseGeom, bodyMaterial);
      caseMesh.rotation.x = Math.PI / 2;
      group.add(caseMesh);

      // Bezel
      const bezelGeom = new THREE.TorusGeometry(1.2, 0.08, 16, 64);
      const bezelMesh = new THREE.Mesh(bezelGeom, goldMaterial);
      group.add(bezelMesh);

      // Dial Face
      const dialGeom = new THREE.CircleGeometry(1.12, 64);
      const dialMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.4 });
      const dialMesh = new THREE.Mesh(dialGeom, dialMat);
      dialMesh.position.z = 0.18;
      group.add(dialMesh);

      // Hands
      const handGeom = new THREE.BoxGeometry(0.06, 0.8, 0.02);
      const handMesh = new THREE.Mesh(handGeom, goldMaterial);
      handMesh.position.set(0, 0.25, 0.2);
      group.add(handMesh);

      // Sapphire Crystal Dome
      const domeGeom = new THREE.SphereGeometry(1.18, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.25);
      const domeMesh = new THREE.Mesh(domeGeom, glassMaterial);
      domeMesh.position.z = 0.1;
      group.add(domeMesh);

      // Leather/Metal Strap
      const strapGeom = new THREE.BoxGeometry(0.85, 1.4, 0.12);
      const strapTop = new THREE.Mesh(strapGeom, bodyMaterial);
      strapTop.position.set(0, 1.5, -0.05);
      group.add(strapTop);

      const strapBottom = new THREE.Mesh(strapGeom, bodyMaterial);
      strapBottom.position.set(0, -1.5, -0.05);
      group.add(strapBottom);
    } else if (isPhone) {
      // Modern Glass & Titanium Smartphone
      const phoneGeom = new THREE.BoxGeometry(1.4, 2.7, 0.16);
      const phoneMesh = new THREE.Mesh(phoneGeom, bodyMaterial);
      group.add(phoneMesh);

      const screenGeom = new THREE.PlaneGeometry(1.3, 2.5);
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 });
      const screenMesh = new THREE.Mesh(screenGeom, screenMat);
      screenMesh.position.z = 0.09;
      group.add(screenMesh);

      const cameraBump = new THREE.BoxGeometry(0.5, 0.6, 0.06);
      const cameraMesh = new THREE.Mesh(cameraBump, silverMaterial);
      cameraMesh.position.set(-0.35, 0.95, -0.1);
      group.add(cameraMesh);
    } else if (config.geometryType === 'furniture') {
      // Architectural Lounge Chair
      const seatGeom = new THREE.BoxGeometry(1.6, 0.25, 1.4);
      const seatMesh = new THREE.Mesh(seatGeom, bodyMaterial);
      group.add(seatMesh);

      const backGeom = new THREE.BoxGeometry(1.6, 1.3, 0.25);
      const backMesh = new THREE.Mesh(backGeom, bodyMaterial);
      backMesh.position.set(0, 0.7, -0.6);
      backMesh.rotation.x = -0.15;
      group.add(backMesh);

      const legGeom = new THREE.CylinderGeometry(0.05, 0.03, 0.9, 16);
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.5 });
      const legPositions = [
        [-0.65, -0.45, 0.55],
        [0.65, -0.45, 0.55],
        [-0.65, -0.45, -0.55],
        [0.65, -0.45, -0.55],
      ];
      legPositions.forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeom, woodMat);
        leg.position.set(x, y, z);
        leg.rotation.z = x > 0 ? -0.1 : 0.1;
        group.add(leg);
      });
    } else {
      // Sculptural Artifact / Solitaire
      const gemGeom = new THREE.OctahedronGeometry(1.1, 2);
      const gemMesh = new THREE.Mesh(gemGeom, glassMaterial);
      group.add(gemMesh);

      const ringBase = new THREE.TorusGeometry(1.3, 0.12, 16, 64);
      const ringMesh = new THREE.Mesh(ringBase, goldMaterial);
      ringMesh.rotation.x = Math.PI / 2;
      group.add(ringMesh);
    }

    // 6. Interactive Mouse Orbit Controls
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      group.rotation.y += deltaX * 0.012;
      group.rotation.x = Math.max(-0.6, Math.min(0.6, group.rotation.x + deltaY * 0.01));

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(2.0, Math.min(6.5, camera.position.z + e.deltaY * 0.003));
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    // Touch support for mobile devices
    let touchStart = { x: 0, y: 0 };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDraggingRef.current = true;
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isDraggingRef.current) {
        const deltaX = e.touches[0].clientX - touchStart.x;
        const deltaY = e.touches[0].clientY - touchStart.y;
        group.rotation.y += deltaX * 0.012;
        group.rotation.x = Math.max(-0.6, Math.min(0.6, group.rotation.x + deltaY * 0.01));
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
    };
    dom.addEventListener('touchstart', onTouchStart);
    dom.addEventListener('touchmove', onTouchMove);
    dom.addEventListener('touchend', onTouchEnd);

    // 7. Continuous Smooth 3D Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (isRotatingRef.current && !isDraggingRef.current) {
        group.rotation.y += 0.01; // Smooth continuous 3D rotation
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!currentMount) return;
      const newWidth = currentMount.clientWidth;
      const newHeight = currentMount.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('touchstart', onTouchStart);
      dom.removeEventListener('touchmove', onTouchMove);
      dom.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', handleResize);
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [product]);

  return (
    <div className="relative group bg-radial from-stone-50 via-ivory to-cream-100/40 rounded-2xl border border-cream-200 overflow-hidden shadow-soft select-none">
      {/* 3D Canvas Mount */}
      <div ref={mountRef} className={`${className} cursor-grab active:cursor-grabbing`} />

      {/* Floating 3D Controls Airboard */}
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="airboard px-3 py-1.5 rounded-full pointer-events-auto flex items-center gap-2 text-xs font-medium text-stone-700">
          <RotateCw className="w-3.5 h-3.5 text-burgundy" />
          <span>Interactive 3D • Drag to inspect</span>
        </div>

        <div className="airboard px-2.5 py-1.5 rounded-full pointer-events-auto flex items-center gap-1.5 text-xs text-stone-700">
          <button
            type="button"
            onClick={handle360Spin}
            className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cream-100 hover:bg-cream-200 text-stone-800 transition-colors"
            title="Perform 360-degree rotation"
          >
            360° Spin
          </button>
          <button
            type="button"
            onClick={toggleRotation}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
              isRotating ? 'bg-burgundy text-white' : 'hover:bg-cream-100'
            }`}
          >
            {isRotating ? 'Pause' : 'Auto Rotate'}
          </button>
        </div>
      </div>
    </div>
  );
};
