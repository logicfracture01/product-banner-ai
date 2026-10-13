import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

interface BeforeAfterStageProps {
  productImage?: string | null;
  rotation?: "none" | "orbit" | "float";
  size?: number;
  showGround?: boolean;
  className?: string;
}

const KEY_LIGHT = new THREE.PointLight(0xfff4e6, 2.2, 20, 2);
const FILL_LIGHT = new THREE.DirectionalLight(0xc9d4ff, 0.55);
const BACK_LIGHT = new THREE.DirectionalLight(0xffffff, 0.35);

export default function BeforeAfterStage({
  productImage,
  rotation = "orbit",
  size = 220,
  showGround = true,
  className,
}: BeforeAfterStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cardRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const [ready, setReady] = useState(false);
  const pointerRef = useRef({ active: false, lastX: 0, lastY: 0, rx: 0, ry: 0 });

  useEffect(() => {
    if (!mountRef.current || sceneRef.current) return;

    const width = mountRef.current.clientWidth || size;
    const height = mountRef.current.clientHeight || size;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 40);
    camera.position.set(2.5, 1.9, 4.2);
    camera.lookAt(0, 0.15, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    if (showGround) {
      const groundGeo = new THREE.PlaneGeometry(10, 10);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x15181b,
        roughness: 0.7,
        metalness: 0.05,
        envMapIntensity: 0.6,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      ground.receiveShadow = true;
      scene.add(ground);

      const ringGeo = new THREE.RingGeometry(1.18, 1.42, 64);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x2a2f34,
        roughness: 0.85,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.055;
      scene.add(ring);
    }

    KEY_LIGHT.position.set(2.4, 3.4, 1.6);
    KEY_LIGHT.castShadow = true;
    KEY_LIGHT.shadow.mapSize.set(512, 512);
    KEY_LIGHT.shadow.camera.near = 0.5;
    KEY_LIGHT.shadow.camera.far = 10;
    KEY_LIGHT.shadow.bias = -0.0004;
    scene.add(KEY_LIGHT);

    FILL_LIGHT.position.set(-2.2, 0.6, 1.4);
    scene.add(FILL_LIGHT);

    BACK_LIGHT.position.set(-0.6, 1.2, -3.4);
    scene.add(BACK_LIGHT);

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const cardGeo = new THREE.BoxGeometry(1.4, 0.22, 0.9);
    const cardMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f34,
      roughness: 0.35,
      metalness: 0.15,
      envMapIntensity: 1.0,
    });
    const card = new THREE.Mesh(cardGeo, cardMat);
    card.position.y = 0.3;
    card.castShadow = true;
    card.receiveShadow = true;
    scene.add(card);
    cardRef.current = card;

    const topGeo = new THREE.CapsuleGeometry(0.52, 0.6, 8, 24);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xf2d9c4,
      roughness: 0.4,
      metalness: 0.05,
      envMapIntensity: 1.1,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(0, 0.58, 0);
    top.scale.set(1, 0.9, 1);
    top.castShadow = true;
    top.receiveShadow = true;
    scene.add(top);

    const stripeGeo = new THREE.TorusGeometry(0.52, 0.05, 8, 48);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf4b23e,
      roughness: 0.3,
      metalness: 0.2,
      envMapIntensity: 1.2,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.56, 0.46);
    stripe.rotation.x = Math.PI / 2;
    stripe.scale.set(1, 1, 0.32);
    stripe.castShadow = true;
    scene.add(stripe);

    const labelGeo = new THREE.PlaneGeometry(0.5, 0.16);
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d20,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, 0.34, 0.451);
    scene.add(label);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x25292d);
    const envTexture = pmrem.fromScene(envScene, 0, 0.1, 10).texture;
    scene.environment = envTexture;

    setReady(true);

    const el = mountRef.current;
    const onPointerDown = () => {
      pointerRef.current.active = true;
      pointerRef.current.lastX = 0;
      pointerRef.current.lastY = 0;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointerRef.current.active) return;
      const dx = e.clientX - pointerRef.current.lastX;
      const dy = e.clientY - pointerRef.current.lastY;
      pointerRef.current.lastX = e.clientX;
      pointerRef.current.lastY = e.clientY;
      pointerRef.current.ry += dx * 0.008;
      pointerRef.current.rx += dy * 0.005;
      pointerRef.current.rx = Math.max(-0.6, Math.min(0.6, pointerRef.current.rx));
    };
    const onPointerUp = () => {
      pointerRef.current.active = false;
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    let animId = 0;
    const tick = () => {
      animId = requestAnimationFrame(tick);
      if (!renderer || !scene || !camera) return;

      const t = performance.now() * 0.001;

      if (cardRef.current) {
        if (rotation === "orbit") {
          if (pointerRef.current.active) {
            cardRef.current.rotation.y = pointerRef.current.ry;
          } else {
            cardRef.current.rotation.y = t * 0.6;
          }
        } else if (rotation === "float") {
          const baseY = 0.3;
          const offsetY = Math.sin(t * 1.1) * 0.04;
          cardRef.current.position.y = baseY + offsetY;
          if (pointerRef.current.active) {
            cardRef.current.rotation.y = pointerRef.current.ry;
          } else {
            cardRef.current.rotation.y = Math.sin(t * 0.25) * 0.25;
          }
          cardRef.current.rotation.x = Math.sin(t * 0.35 + 0.6) * 0.04;
        } else {
          cardRef.current.rotation.y = pointerRef.current.ry;
          cardRef.current.rotation.x = pointerRef.current.rx;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(animId);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      cardRef.current = null;
    };
  }, [size, showGround, rotation]);

  useEffect(() => {
    if (!ready || !productImage || !mountRef.current) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = productImage;
    img.onload = () => {
      const renderer = rendererRef.current;
      const card = cardRef.current;
      if (!renderer || !card) return;

      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      textureRef.current = tex;

      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.35,
        metalness: 0.05,
        envMapIntensity: 1.1,
      });
      card.material = mat;
      tex.needsUpdate = true;
    };
  }, [ready, productImage]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el || !sceneRef.current || !cameraRef.current || !rendererRef.current) return;

    const resize = () => {
      const w = el.clientWidth || size;
      const h = el.clientHeight || size;
      cameraRef.current!.aspect = w / h;
      cameraRef.current!.updateProjectionMatrix();
      rendererRef.current!.setSize(w, h);
    };

    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, [size]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        borderRadius: "1rem",
        background: "radial-gradient(circle at 50% 40%, #1d2125, #0c0e10)",
      }}
    />
  );
}
