/**
 * Trúc in three dimensions.
 *
 * The flat `Panda` is the identity; this is the same character with a body that
 * can react. He breathes, he blinks, he turns his head toward the pointer, and
 * when the guided tour hands him a `DOMRect` he walks across the viewport and
 * looks at the thing the sentence is talking about. That last behaviour is the
 * whole reason this file exists: a coach-mark card that says "the queue depth
 * is here" is a caption, and a character standing next to the number looking at
 * it is a direction.
 *
 * **He is never on `/review`.** Not in the gauge, not in a tour, not in a
 * transition. Nothing cartoon goes next to footage somebody is paid or not paid
 * on, and that rule is enforced here rather than trusted to every caller —
 * `DESIGN.md`, "Identity". The check is the first thing the component does.
 *
 * **Three ways out, in this order.** No WebGL at all, or the operator has asked
 * for reduced motion and the machine cannot draw a still frame: the flat SVG.
 * WebGL but the model has not arrived, or its fetch failed: a panda built from
 * spheres and capsules, which needs no network. The model: `public/truc.glb`,
 * one mesh, one material, about 22k vertices, loaded lazily inside this chunk.
 * The primitive panda is not a placeholder rectangle — it is the same character
 * with the same silhouette, so a slow LAN at an upload centre degrades to a
 * different fidelity rather than to a hole in the page.
 *
 * **Cost.** DPR is capped at 1.5, the loop stops dead when the tab is hidden,
 * and under `prefers-reduced-motion` the scene renders one frame and then never
 * again (`frameloop="demand"`) — a static pose, not a slowed-down animation.
 * Everything the loader allocated is disposed on unmount; R3F only owns what it
 * created itself, and the glTF scene is not that.
 *
 * This module is loaded through `React.lazy` and must never be imported from a
 * module `/review` reaches, or three.js lands in that route's bundle.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FILL, Panda } from './Panda.tsx';

/**
 * What he is doing, which is a property of the screen and not of him.
 *
 * `pointing` is the tour's mood and is the only one that reads an `anchor`.
 * `thinking` is for a screen that is waiting on the server. `happy` is the
 * queue reaching zero, and it is the only squash-and-stretch in the console.
 */
export type PandaMood = 'idle' | 'happy' | 'thinking' | 'pointing';

/*
 * The primitive build takes its colours from the flat panda rather than
 * repeating them. `Panda.tsx` is the one file in the console allowed to write a
 * hex literal — it is artwork that also ships to React Native, where `var()`
 * does not exist — and a second copy here is how the two drawings of one
 * character start being two characters.
 */

const MODEL_URL = '/truc.glb';

/**
 * `/review` again, checked at the component rather than at the call site.
 *
 * Read from `window.location` and not from the router so that this module has
 * no router import: it is lazy-loaded, and a route table in the same chunk
 * would pull the whole router graph in behind it. Every caller re-renders on
 * navigation, so the read is fresh.
 */
function onReviewRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/review');
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') ?? canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/** Everything the loader allocated. R3F disposes what it made, not this. */
function disposeScene(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of [mesh.material].flat()) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

/**
 * The model, centred on its own feet and scaled into a two-unit box.
 *
 * A glTF arrives in whatever units and at whatever origin it was authored at,
 * and the primitive panda below is built to a fixed size; normalising here is
 * what lets the two swap behind the same camera without the shot changing.
 * A failed fetch resolves to `null` and the primitive stays — an upload centre
 * with the link down still gets a panda.
 */
function useTruc(): THREE.Group | null {
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: THREE.Group | null = null;

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const group = gltf.scene;
        if (!live) {
          disposeScene(group);
          return;
        }
        const box = new THREE.Box3().setFromObject(group);
        const span = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const k = 2 / Math.max(span.x, span.y, span.z, 1e-6);
        group.scale.setScalar(k);
        group.position.set(-centre.x * k, -box.min.y * k - 1, -centre.z * k);
        group.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) mesh.frustumCulled = false;
        });
        loaded = group;
        setScene(group);
      },
      undefined,
      () => {
        /* No model: the primitive panda is already on screen and stays. */
      },
    );

    return () => {
      live = false;
      if (loaded) disposeScene(loaded);
    };
  }, []);

  return scene;
}

/**
 * The panda out of spheres and capsules.
 *
 * Toon material rather than standard: three bands of light and no specular is
 * how the turnaround sheet is lit, and it also means the fallback and the
 * model do not read as two different rendering styles when one replaces the
 * other mid-session.
 *
 * `eyes` is a ref on the pair of eye meshes because the model cannot blink —
 * it has no morph targets — and the fallback can.
 */
function PrimitivePanda({ eyes }: { eyes: React.RefObject<THREE.Group | null> }) {
  const ink = useMemo(() => new THREE.MeshToonMaterial({ color: FILL.ink }), []);
  const fur = useMemo(() => new THREE.MeshToonMaterial({ color: FILL.fur }), []);
  const light = useMemo(() => new THREE.MeshToonMaterial({ color: FILL.light }), []);
  const stalk = useMemo(() => new THREE.MeshToonMaterial({ color: FILL.stalk }), []);
  const leaf = useMemo(() => new THREE.MeshToonMaterial({ color: FILL.leaf }), []);

  useEffect(
    () => () => {
      for (const m of [ink, fur, light, stalk, leaf]) m.dispose();
    },
    [ink, fur, light, stalk, leaf],
  );

  return (
    <group position={[0, -0.9, 0]}>
      {/* Legs, then the body, then the head — largest last, nearest the camera. */}
      <mesh material={ink} position={[-0.3, 0.18, 0.05]}>
        <capsuleGeometry args={[0.19, 0.16, 4, 12]} />
      </mesh>
      <mesh material={ink} position={[0.3, 0.18, 0.05]}>
        <capsuleGeometry args={[0.19, 0.16, 4, 12]} />
      </mesh>

      <mesh material={ink} position={[-0.68, 0.62, 0.05]} rotation={[0, 0, 0.24]}>
        <capsuleGeometry args={[0.16, 0.4, 4, 12]} />
      </mesh>
      <mesh material={ink} position={[0.68, 0.62, 0.05]} rotation={[0, 0, -0.24]}>
        <capsuleGeometry args={[0.16, 0.4, 4, 12]} />
      </mesh>

      <mesh material={ink} position={[0, 0.66, 0]} scale={[1, 0.94, 0.9]}>
        <sphereGeometry args={[0.62, 28, 20]} />
      </mesh>
      <mesh material={light} position={[0, 0.62, 0.24]} scale={[1, 0.96, 0.7]}>
        <sphereGeometry args={[0.44, 24, 18]} />
      </mesh>

      {/* The head is wider than the body. That proportion is the character. */}
      <group position={[0, 1.72, 0]}>
        <mesh material={ink} position={[-0.55, 0.52, -0.08]}>
          <sphereGeometry args={[0.26, 20, 16]} />
        </mesh>
        <mesh material={ink} position={[0.55, 0.52, -0.08]}>
          <sphereGeometry args={[0.26, 20, 16]} />
        </mesh>
        <mesh material={fur} scale={[1, 0.92, 0.94]}>
          <sphereGeometry args={[0.8, 32, 24]} />
        </mesh>

        <group ref={eyes}>
          <mesh material={ink} position={[-0.3, 0.08, 0.62]} rotation={[0, 0, 0.3]} scale={[0.7, 1, 0.4]}>
            <sphereGeometry args={[0.3, 20, 16]} />
          </mesh>
          <mesh material={ink} position={[0.3, 0.08, 0.62]} rotation={[0, 0, -0.3]} scale={[0.7, 1, 0.4]}>
            <sphereGeometry args={[0.3, 20, 16]} />
          </mesh>
          <mesh material={light} position={[-0.28, 0.08, 0.73]}>
            <sphereGeometry args={[0.1, 14, 12]} />
          </mesh>
          <mesh material={light} position={[0.28, 0.08, 0.73]}>
            <sphereGeometry args={[0.1, 14, 12]} />
          </mesh>
        </group>

        <mesh material={light} position={[0, -0.28, 0.6]} scale={[1.2, 0.8, 0.7]}>
          <sphereGeometry args={[0.28, 20, 16]} />
        </mesh>
        <mesh material={ink} position={[0, -0.19, 0.78]} scale={[1.3, 0.8, 0.7]}>
          <sphereGeometry args={[0.08, 14, 12]} />
        </mesh>
      </group>

      {/* The bamboo, held in the right paw. */}
      <mesh material={stalk} position={[0.82, 0.95, 0.24]} rotation={[0, 0, -0.06]}>
        <cylinderGeometry args={[0.075, 0.075, 1.7, 12]} />
      </mesh>
      <mesh material={leaf} position={[1.12, 1.76, 0.24]} rotation={[0, 0, -0.9]} scale={[1, 0.28, 0.5]}>
        <sphereGeometry args={[0.24, 14, 10]} />
      </mesh>
      <mesh material={leaf} position={[0.52, 1.82, 0.24]} rotation={[0, 0, 0.9]} scale={[1, 0.28, 0.5]}>
        <sphereGeometry args={[0.2, 14, 10]} />
      </mesh>
    </group>
  );
}

/** Where a `DOMRect` in page coordinates lands on the plane the panda stands on. */
function anchorToWorld(rect: DOMRect, camera: THREE.Camera, out: THREE.Vector3) {
  const ndcX = ((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1;
  const ndcY = -((rect.top + rect.height / 2) / window.innerHeight) * 2 + 1;
  out.set(ndcX, ndcY, 0.5).unproject(camera);
  const dir = out.sub(camera.position).normalize();
  const distance = -camera.position.z / dir.z;
  out.copy(camera.position).add(dir.multiplyScalar(distance));
}

/**
 * Everything that moves.
 *
 * One `useFrame`, because a second one is a second place where a behaviour can
 * be added without anyone noticing what it costs. Under reduced motion this
 * component is not mounted at all — the still pose is a single rendered frame
 * with no loop behind it.
 */
function Truc({ mood, anchor }: { mood: PandaMood; anchor?: DOMRect }) {
  const root = useRef<THREE.Group>(null);
  const breath = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const model = useTruc();
  const { camera, pointer } = useThree();

  /** Next blink, in seconds from the clock the loop reads. 3–6s, never regular. */
  const nextBlink = useRef(3 + Math.random() * 3);
  const target = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const g = root.current;
    if (!g) return;

    /* Where he should be. With no anchor he stands where he was placed. */
    if (anchor) {
      anchorToWorld(anchor, camera, look);
      /* Beside the target and a little below it, never on top of it. */
      target.set(look.x - 1.5, look.y - 1.1, 0);
    } else {
      target.set(0, 0, 0);
      look.set(pointer.x * 3, pointer.y * 2, 4);
    }
    g.position.lerp(target, 1 - Math.exp(-6 * delta));

    /* And which way he faces: at the anchor, or at the pointer. */
    const yaw = Math.atan2(look.x - g.position.x, Math.max(look.z - g.position.z, 1.5));
    const pitch = anchor ? 0 : -pointer.y * 0.18;
    const h = head.current;
    if (h) {
      h.rotation.y += (THREE.MathUtils.clamp(yaw, -0.9, 0.9) - h.rotation.y) * (1 - Math.exp(-5 * delta));
      h.rotation.x += (pitch - h.rotation.x) * (1 - Math.exp(-5 * delta));
      if (mood === 'thinking') h.rotation.z = Math.sin(t * 0.9) * 0.06 + 0.1;
      else h.rotation.z += (0 - h.rotation.z) * (1 - Math.exp(-5 * delta));
    }

    /* Breathing, and the one squash-and-stretch in the console. */
    const b = breath.current;
    if (b) {
      const air = Math.sin(t * 1.7) * 0.018;
      if (mood === 'happy') {
        const bounce = Math.abs(Math.sin(t * 4.2));
        b.scale.set(1 + 0.09 * (1 - bounce), 1 + 0.12 * bounce, 1 + 0.09 * (1 - bounce));
        b.position.y = bounce * 0.18;
      } else {
        b.scale.set(1 - air * 0.5, 1 + air, 1 - air * 0.5);
        b.position.y += (0 - b.position.y) * (1 - Math.exp(-6 * delta));
      }
      if (mood === 'pointing') b.rotation.z = Math.sin(t * 2.4) * 0.03;
    }

    /*
     * The blink.
     *
     * ponytail: the glTF is a single mesh with no morph targets, so with the
     * model on screen a blink is a fast squash of the head instead of a lid
     * closing — the same beat, a cruder instrument. Re-export `truc.glb` with a
     * `blink` morph target and this becomes one `morphTargetInfluences` write.
     */
    nextBlink.current -= delta;
    const closing = nextBlink.current < 0 && nextBlink.current > -0.14;
    if (nextBlink.current < -0.14) nextBlink.current = 3 + Math.random() * 3;
    const shut = closing ? 0.12 : 1;
    if (eyes.current) eyes.current.scale.y = shut;
    else if (h) h.scale.y = 1 - (1 - shut) * 0.06;
  });

  return (
    <group ref={root}>
      <group ref={breath}>
        {model ? (
          <group ref={head}>
            <primitive object={model} />
          </group>
        ) : (
          <group ref={head}>
            <PrimitivePanda eyes={eyes} />
          </group>
        )}
      </group>
    </group>
  );
}

/**
 * The stage.
 *
 * Two shapes, chosen by whether an `anchor` was given. Without one it is an
 * inline box of `size` pixels — the middle of the shift gauge, the sign-in
 * panel. With one it is a fixed, transparent, pointer-transparent layer over
 * the whole viewport, which is the only way a character can stand next to an
 * arbitrary element on an arbitrary screen without the layout knowing about it.
 */
export function PandaStage({
  mood = 'idle',
  size = 180,
  anchor,
  className,
  label,
}: {
  mood?: PandaMood;
  /** Ignored when `anchor` is set; the layer is the viewport then. */
  size?: number;
  /** The element the guided tour is talking about, in page coordinates. */
  anchor?: DOMRect;
  className?: string;
  /** Sets `role="img"`; without it the canvas is decoration and is hidden. */
  label?: string;
}) {
  const [reduced, setReduced] = useState(false);
  const [running, setRunning] = useState(true);
  const [webgl] = useState(webglAvailable);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const readMotion = () => setReduced(motion.matches);
    readMotion();
    motion.addEventListener('change', readMotion);

    /* A tab in the background must not hold a GPU or a rAF. */
    const visibility = () => setRunning(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);

    return () => {
      motion.removeEventListener('change', readMotion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  /* DESIGN.md, "Identity": nothing cartoon goes anywhere near the footage. */
  if (onReviewRoute()) return null;

  if (!webgl) {
    return <Panda size={anchor ? 120 : size} className={className} label={label} />;
  }

  /*
   * `demand` and not an unmount: the scene still builds, the model still
   * arrives, and R3F draws exactly one frame for each of those. What stops is
   * the loop, so `useFrame` never runs and the pose never changes — a still
   * panda rather than a slowed-down one, and no rAF while the tab is hidden.
   */
  const still = reduced || !running;

  return (
    <div
      className={className}
      style={
        anchor
          ? { position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }
          : { width: size, height: size, pointerEvents: 'none' }
      }
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Canvas
        dpr={[1, 1.5]}
        frameloop={still ? 'demand' : 'always'}
        camera={{ position: [0, 0.2, 6.4], fov: 34 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[3, 5, 4]} intensity={2.1} />
        <directionalLight position={[-4, 1, -2]} intensity={0.5} />
        <Truc mood={mood} anchor={anchor} />
      </Canvas>
    </div>
  );
}

export default PandaStage;
