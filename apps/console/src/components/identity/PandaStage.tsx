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
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FILL, Panda } from './Panda.tsx';
import { cn } from '../../lib/cn.ts';

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

/**
 * WebGL **2**, and nothing less.
 *
 * three dropped the WebGL1 renderer at r163 and this project is on 0.185, so a
 * machine that can only do WebGL1 — an old upload-centre PC on a stale driver is
 * exactly that machine — would pass a `webgl` probe and then fail inside the
 * renderer. The probe context is released immediately: browsers cap live WebGL
 * contexts (Chromium at 16) and a probe that keeps one costs the page a real
 * one.
 */
/** The options the stage's real renderer is built with; the probe uses the same. */
const GL_OPTIONS = { alpha: true, antialias: true, powerPreference: 'high-performance' } as const;

/**
 * The quarter turn that puts the model's face toward the camera. See `useTruc`.
 */
const FRONT_Y = -Math.PI / 2;

/** How long a greeting runs, in seconds of the render clock. */
const GREET = 0.9;

/**
 * Where the cursor is, tracked on `window` rather than on the canvas.
 *
 * R3F's own `pointer` only moves when the canvas receives a pointer event, and
 * this canvas never does: it is `pointer-events: none` everywhere, because the
 * tour's layer covers the whole viewport and must never take a click away from
 * the button under it. So the head-follow this component was written around was
 * dead on every screen — measured, `pointer` stayed at (0, 0) and the head
 * never turned once.
 *
 * A `window` listener fixes it and is the better behaviour anyway: he follows
 * the cursor across the whole page instead of only while it is inside his own
 * 240px box. Nothing here captures an event; it only observes one, so what is
 * underneath still gets the click.
 *
 * One listener however many stages are mounted, refcounted, and `passive` so it
 * can never delay a scroll.
 */
const cursor = { ndcX: 0, ndcY: 0, clientX: -1, clientY: -1, seen: false };
let watchers = 0;

function readCursor(event: PointerEvent): void {
  cursor.clientX = event.clientX;
  cursor.clientY = event.clientY;
  cursor.ndcX = (event.clientX / window.innerWidth) * 2 - 1;
  cursor.ndcY = -((event.clientY / window.innerHeight) * 2 - 1);
  cursor.seen = true;
}

function trackCursor(): () => void {
  if (watchers === 0) window.addEventListener('pointermove', readCursor, { passive: true });
  watchers += 1;
  return () => {
    watchers -= 1;
    if (watchers === 0) window.removeEventListener('pointermove', readCursor);
  };
}

function webglAvailable(): boolean {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', GL_OPTIONS) as WebGL2RenderingContext | null;
    if (!gl) return false;
    /*
     * A context is not a renderer. A blocklisted GPU hands out a WebGL2 context
     * and then refuses `WebGLRenderer` construction. Build one here, with the
     * stage's own options, where a throw is ours to catch.
     */
    new THREE.WebGLRenderer({ canvas, context: gl, ...GL_OPTIONS }).dispose();
    return true;
  } catch {
    return false;
  } finally {
    /* Released whether or not construction threw: browsers cap live contexts. */
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * The real renderer, built where its failure can be caught.
 *
 * R3F constructs `gl` inside an async `run()` that no error boundary sees. So
 * the stage hands it a factory: on success it is the renderer R3F would have
 * made; on failure it reports up (the stage switches to the SVG panda and
 * unmounts the canvas) and returns a promise that never settles, so R3F has
 * nothing to reject with and the console stays clean.
 */
function makeRenderer(onFail: () => void) {
  /* R3F's `gl` accepts `(defaultProps) => Promise<Renderer>`; one promise-returning shape for both outcomes. */
  return (props: THREE.WebGLRendererParameters): Promise<THREE.WebGLRenderer> => {
    try {
      return Promise.resolve(new THREE.WebGLRenderer({ ...props, ...GL_OPTIONS }));
    } catch {
      onFail();
      return new Promise<THREE.WebGLRenderer>(() => {});
    }
  };
}

/**
 * And if it throws anyway, the flat panda.
 *
 * A probe answers "can this browser", not "will this driver". Renderer
 * construction still fails on a blocklisted GPU, and an unhandled throw inside
 * a lazy chunk takes the whole guided tour down with it. Three lines of class
 * component, because a boundary cannot be a hook.
 */
class StageBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
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
        /*
         * The model is authored facing +X, so it needs a quarter turn, not a
         * half one. Measured, not assumed: the glTF was rendered at 0°, 90°,
         * 180° and 270° against this same camera and read off the four images.
         * 0° and 180° are profiles, 90° is his back, and 270° is the face the
         * turnaround sheet calls the front. A half turn shipped first and put
         * the coach mark's back to the reader on every screen it appeared on.
         */
        group.rotation.y = FRONT_Y;
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

/**
 * Where a `DOMRect` in page coordinates lands on the plane the panda stands on.
 *
 * `ray` is a module-level scratch vector and is deliberately NOT `out`. The
 * first version reused one vector for the unprojected point and the ray, and
 * `out.copy(camera.position)` then overwrote the direction it was about to be
 * scaled by — the panda ended up in the top-left corner of the viewport
 * whatever it had been asked to stand beside.
 */
const ray = new THREE.Vector3();

function anchorToWorld(rect: DOMRect, camera: THREE.Camera, out: THREE.Vector3) {
  const ndcX = ((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1;
  const ndcY = -((rect.top + rect.height / 2) / window.innerHeight) * 2 + 1;
  out.set(ndcX, ndcY, 0.5).unproject(camera);
  ray.copy(out).sub(camera.position).normalize();
  out.copy(camera.position).addScaledVector(ray, -camera.position.z / ray.z);
}

/**
 * Everything that moves.
 *
 * One `useFrame`, because a second one is a second place where a behaviour can
 * be added without anyone noticing what it costs. Under reduced motion this
 * component is not mounted at all — the still pose is a single rendered frame
 * with no loop behind it.
 */
function Truc({
  mood,
  anchor,
  still,
  greet,
  near,
}: {
  mood: PandaMood;
  anchor?: DOMRect;
  still: boolean;
  /** Set to `-1` by a tap on him; the loop stamps it with its own clock. */
  greet: { current: number };
  /** Whether the cursor is over his box. Drives the lean, not a click. */
  near: { current: boolean };
}) {
  /*
   * Anchored, he is a coach mark standing beside a chip in a toolbar, so he is
   * a third the height he is in the shift gauge. At full size a 2-unit
   * character fills half a 900px viewport, which is a mascot taking the screen
   * away from the sentence it is supposed to be supporting.
   */
  const scale = anchor ? 0.34 : 1;
  const root = useRef<THREE.Group>(null);
  const breath = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const model = useTruc();
  const { camera } = useThree();
  const greetFrom = useRef(-1);
  useEffect(trackCursor, []);

  /** Next blink, in seconds from the clock the loop reads. 3–6s, never regular. */
  const nextBlink = useRef(3 + Math.random() * 3);
  const target = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const g = root.current;
    if (!g) return;

    /*
     * `frameloop="demand"` stops the loop but not the callback: a resize or the
     * model arriving invalidates once, and the animation would advance a frame
     * each time — a panda that twitches whenever the window moves, for the
     * operator who asked for no motion. Under `still` the pose is set once and
     * nothing else runs.
     */
    /*
     * Where he should be. With no anchor he stands where he was placed; with
     * one he stands beside the target and a little below it, never on top of
     * it, and never past the edge of the frame — a chip in the top-right corner
     * has no room to its right, and a panda half off screen points at nothing.
     */
    if (anchor) {
      anchorToWorld(anchor, camera, look);
      const halfHeight = Math.tan((camera as THREE.PerspectiveCamera).fov * (Math.PI / 360)) * 6.4;
      const halfWidth = halfHeight * state.viewport.aspect;
      target.set(
        THREE.MathUtils.clamp(look.x - 0.8, -halfWidth + 0.5, halfWidth - 0.5),
        THREE.MathUtils.clamp(look.y - 0.55, -halfHeight + 0.4, halfHeight - 0.4),
        0,
      );
    } else {
      target.set(0, 0, 0);
      /*
       * He watches the cursor wherever it is on the page. Before it has moved
       * once he looks straight out, rather than snapping to a corner.
       */
      look.set(cursor.seen ? cursor.ndcX * 3 : 0, cursor.seen ? cursor.ndcY * 2 : 0, 4);
    }

    if (still) {
      /*
       * The still pose is the same place, reached at once instead of by
       * interpolation — a guide panda under reduced motion still stands beside
       * the thing the step is about, and faces it. Nothing else runs.
       */
      g.position.copy(target);
      if (head.current) {
        const yaw = Math.atan2(look.x - g.position.x, Math.max(look.z - g.position.z, 1.5));
        head.current.rotation.set(0, anchor ? THREE.MathUtils.clamp(yaw, -0.9, 0.9) : 0, 0);
      }
      if (breath.current) {
        breath.current.scale.set(1, 1, 1);
        breath.current.position.y = 0;
      }
      if (eyes.current) eyes.current.scale.y = 1;
      return;
    }

    g.position.lerp(target, 1 - Math.exp(-6 * delta));

    /*
     * A tap on him. The flag is set by a listener that only *watches* the
     * event, so the control underneath still receives it; the loop stamps the
     * start against its own clock and the burst decays on its own.
     */
    if (greet.current === -1) {
      greetFrom.current = t;
      greet.current = 0;
    }
    const greeting = greetFrom.current >= 0 ? (t - greetFrom.current) / GREET : 2;
    const hello = greeting < 1 ? Math.sin(greeting * Math.PI) : 0;

    /* And which way he faces: at the anchor, or at the cursor. */
    const yaw = Math.atan2(look.x - g.position.x, Math.max(look.z - g.position.z, 1.5));
    const pitch = anchor ? 0 : -(cursor.seen ? cursor.ndcY : 0) * 0.18;
    const h = head.current;
    if (h) {
      /* Nearer the cursor, he turns further: the lean that says he noticed. */
      const reach = near.current ? 1.25 : 1;
      h.rotation.y +=
        (THREE.MathUtils.clamp(yaw * reach, -0.9, 0.9) - h.rotation.y) * (1 - Math.exp(-5 * delta));
      h.rotation.x += (pitch - h.rotation.x) * (1 - Math.exp(-5 * delta));
      if (hello > 0) h.rotation.z = Math.sin(greeting * Math.PI * 3) * 0.14;
      else if (mood === 'thinking') h.rotation.z = Math.sin(t * 0.9) * 0.06 + 0.1;
      else h.rotation.z += (0 - h.rotation.z) * (1 - Math.exp(-5 * delta));
    }

    /* Breathing, and the one squash-and-stretch in the console. */
    const b = breath.current;
    if (b) {
      const air = Math.sin(t * 1.7) * 0.018;
      if (hello > 0) {
        /* The greeting outranks the mood: one hop, and he settles again. */
        b.scale.set(1 + 0.1 * (1 - hello), 1 + 0.14 * hello, 1 + 0.1 * (1 - hello));
        b.position.y = hello * 0.22;
      } else if (mood === 'happy') {
        const bounce = Math.abs(Math.sin(t * 4.2));
        b.scale.set(1 + 0.09 * (1 - bounce), 1 + 0.12 * bounce, 1 + 0.09 * (1 - bounce));
        b.position.y = bounce * 0.18;
      } else {
        const lean = near.current ? 0.03 : 0;
        b.scale.set(1 - air * 0.5, 1 + air + lean, 1 - air * 0.5);
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
    <group ref={root} scale={scale}>
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
  onPress,
}: {
  mood?: PandaMood;
  /** Ignored when `anchor` is set; the layer is the viewport then. */
  size?: number;
  /** The element the guided tour is talking about, in page coordinates. */
  anchor?: DOMRect;
  className?: string;
  /** Sets `role="img"`; without it the canvas is decoration and is hidden. */
  label?: string;
  /**
   * Makes him a control rather than a mascot, and changes what he is.
   *
   * With this set the wrapper is a real `<button>`: it takes focus, answers
   * Enter and Space, carries `label` as its accessible name and calls this on
   * a press — as well as running the same greeting a tap has always run. The
   * canvas inside stays inert, so the click lands on the button and not on a
   * WebGL surface.
   *
   * Without it he is what he has always been: decoration that reacts and never
   * takes an event, watched from `window` so the field behind him keeps its
   * click. Both shapes exist because both are true somewhere — the shift gauge
   * and the coach mark have nothing to open.
   */
  onPress?: () => void;
}) {
  const [reduced, setReduced] = useState(false);
  const [running, setRunning] = useState(true);
  const [webgl, setWebgl] = useState(webglAvailable);
  const host = useRef<HTMLDivElement>(null);
  const greet = useRef(0);
  const near = useRef(false);

  /**
   * Watching for a tap on him, without ever taking one.
   *
   * He is a mascot and not a control, and on the sign-in screen he stands over
   * the seam with half of himself above the form. So this listens on `window`
   * and compares the point against his own box: the reaction is ours and the
   * click still belongs to whatever is underneath. Making the canvas itself
   * clickable is what put a transparent layer over the tour's Next button.
   *
   * The tour's panda is excluded. There he is a coach mark standing beside the
   * thing being explained, and every press in that moment belongs to the card.
   */
  useEffect(() => {
    if (anchor || onPress) return;
    const box = () => host.current?.getBoundingClientRect() ?? null;
    const inside = (r: DOMRect | null, x: number, y: number) =>
      r !== null && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

    const move = (event: PointerEvent) => {
      near.current = inside(box(), event.clientX, event.clientY);
    };
    const press = (event: PointerEvent) => {
      if (!inside(box(), event.clientX, event.clientY)) return;
      /*
       * On the sign-in screen he overhangs the form by half his width, so a
       * press inside his box can really be a press on a field. If a control is
       * the thing on top at that point, the press was not for him.
       */
      const on = document.elementFromPoint(event.clientX, event.clientY);
      if (on?.closest('a, button, input, select, textarea, label, [role="button"], [tabindex]')) return;
      greet.current = -1;
    };
    const leave = () => {
      near.current = false;
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointercancel', leave, { passive: true });
    document.addEventListener('pointerleave', leave, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointercancel', leave);
      document.removeEventListener('pointerleave', leave);
    };
  }, [anchor, onPress]);

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


  /*
   * `demand` and not an unmount: the scene still builds, the model still
   * arrives, and R3F draws exactly one frame for each of those. No rAF is
   * scheduled, and `Truc` reads the same flag so the one frame it does draw is
   * the static pose rather than a step of the animation.
   */
  const still = reduced || !running;

  /* The same drawing the boundary and the no-WebGL branch both fall back to. */
  const flat = (
    <div
      style={
        anchor ? { position: 'absolute', left: anchor.left - 130, top: anchor.bottom + 8 } : undefined
      }
    >
      <Panda size={anchor ? 118 : size} />
    </div>
  );

  const Host = onPress ? 'button' : 'div';

  return (
    <Host
      ref={host as React.Ref<HTMLDivElement & HTMLButtonElement>}
      {...(onPress
        ? {
            type: 'button' as const,
            onClick: () => {
              /* The same hop a tap has always produced, then the thing it opens. */
              greet.current = -1;
              onPress();
            },
            onPointerEnter: () => {
              near.current = true;
            },
            onPointerLeave: () => {
              near.current = false;
            },
          }
        : {})}
      /*
       * `pointer-events: none` on the wrapper is not enough: R3F renders two
       * container divs of its own inside it and re-enables pointer events on
       * both, so the full-viewport canvas of an anchored panda sat over the
       * guide's Next button and ate every click (measured with
       * elementFromPoint → CANVAS). Every descendant is inert, the canvas too.
       *
       * He is still interactive; he just never takes the event. The effect
       * above watches `window` and compares the point against this box, so a
       * tap on him makes him hop and the field behind him still gets its click.
       */
      className={cn(
        '[&_*]:pointer-events-none',
        onPress &&
          cn(
            'rounded-[var(--radius-pill)] transition-transform duration-150 ease-[var(--ease)]',
            'hover:scale-105 active:scale-95',
            'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
          ),
        className,
      )}
      style={
        anchor
          ? { position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }
          : { width: size, height: size, pointerEvents: onPress ? 'auto' : 'none' }
      }
      role={!onPress && label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/*
        No WebGL 2: the flat panda, inside the same layer, so the fallback
        stands where the model would have stood instead of falling into the
        document flow behind the scrim. The boundary catches the other half —
        a driver that refuses the renderer after the probe said yes.
      */}
      {!webgl ? (
        flat
      ) : (
        <StageBoundary fallback={flat}>
      <Canvas
        dpr={[1, 1.5]}
        frameloop={still ? 'demand' : 'always'}
        camera={{ position: [0, 0.2, 6.4], fov: 34 }}
        gl={makeRenderer(() => setWebgl(false))}
        style={{ background: 'transparent', pointerEvents: 'none' }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[3, 5, 4]} intensity={2.1} />
        <directionalLight position={[-4, 1, -2]} intensity={0.5} />
        <Truc mood={mood} anchor={anchor} still={still} greet={greet} near={near} />
      </Canvas>
        </StageBoundary>
      )}
    </Host>
  );
}

export default PandaStage;
