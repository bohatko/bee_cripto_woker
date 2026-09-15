import * as THREE from 'three';

const VERTEX_SHADER = `
attribute float aSize;
attribute float aRand;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uPointer;
uniform float uPointerStrength;
uniform float uBurst;

varying vec3 vColor;
varying float vGlow;

void main() {
  vec3 pos = position;

  float breathe = sin(uTime * 1.5 + aRand * 6.2831853) * 0.5 + 0.5;
  pos += normalize(position + vec3(0.0001)) * breathe * 0.03;
  pos *= 1.0 + uBurst * 0.22 * (0.35 + aRand);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float dist = distance(pos.xy, uPointer.xy);
  vGlow = smoothstep(1.45, 0.0, dist) * uPointerStrength;

  float size = aSize * uPixelRatio * (1.0 + vGlow * 2.0) * (6.0 / max(-mvPosition.z, 0.001));
  gl_PointSize = clamp(size, 1.0, 24.0);

  vColor = mix(aColor, vec3(1.0, 0.87, 0.56), vGlow * 0.85);
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vGlow;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  float alpha = smoothstep(0.5, 0.10, dist);
  if (alpha <= 0.02) discard;
  vec3 color = vColor + vGlow * 0.55;
  gl_FragColor = vec4(color, alpha);
}
`;

const HONEY = new THREE.Color('#F59E0B');
const HONEY_LIGHT = new THREE.Color('#FBBF24');
const HONEY_DEEP = new THREE.Color('#D97706');
const STRIPE_DARK = new THREE.Color('#2B2013');
const WING_COLOR = new THREE.Color('#BFE3FF');
const WING_EDGE = new THREE.Color('#EAF7FF');
const EYE_COLOR = new THREE.Color('#FFF3C4');
const HAZE_COLOR = new THREE.Color('#F59E0B');

const BODY_RADII = { x: 1.05, y: 0.8, z: 0.8 };

const COINS: Array<{ label: string; color: string }> = [
  { label: 'BTC', color: '#F7931A' },
  { label: 'ETH', color: '#7C8CF8' },
  { label: 'XRP', color: '#3FB6EA' },
  { label: 'SOL', color: '#19FB9B' },
  { label: 'BNB', color: '#F3BA2F' },
  { label: 'USDT', color: '#26A17B' },
];

export type BeeSceneOptions = {
  reducedMotion?: boolean;
  onInteract?: () => void;
};

type Coin = {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
  scale: number;
};

function randomUnitVector(target: THREE.Vector3) {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return target.set(s * Math.cos(theta), u, s * Math.sin(theta));
}

function ellipsoidPositions(
  count: number,
  rx: number,
  ry: number,
  rz: number,
  center: THREE.Vector3,
  jitter: number
) {
  const positions = new Float32Array(count * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    randomUnitVector(dir);
    const spread = 1 + (Math.random() - 0.5) * jitter;
    positions[i * 3] = center.x + dir.x * rx * spread;
    positions[i * 3 + 1] = center.y + dir.y * ry * spread;
    positions[i * 3 + 2] = center.z + dir.z * rz * spread;
  }
  return positions;
}

function randomBodyPoint(target: THREE.Vector3) {
  const dir = randomUnitVector(new THREE.Vector3());
  return target.set(dir.x * BODY_RADII.x, dir.y * BODY_RADII.y, dir.z * BODY_RADII.z);
}

function createCoinTexture(label: string, color: string) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const radius = size * 0.46;
  const gradient = ctx.createLinearGradient(size * 0.16, size * 0.1, size * 0.86, size * 0.92);
  gradient.addColorStop(0, '#FFFFFF');
  gradient.addColorStop(0.3, color);
  gradient.addColorStop(1, '#0B0E14');

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius * 0.78, 0, Math.PI * 2);
  ctx.lineWidth = size * 0.018;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();

  ctx.fillStyle = 'rgba(7,9,14,0.94)';
  ctx.font = `700 ${label.length > 3 ? size * 0.23 : size * 0.31}px ui-monospace, "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + size * 0.01);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createBeeScene(container: HTMLElement, options: BeeSceneOptions = {}) {
  const reducedMotion = options.reducedMotion ?? false;
  let disposed = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
  camera.position.set(0, 0.2, 6.4);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    throw new Error('webgl-unavailable');
  }

  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.pointerEvents = 'none';
  container.appendChild(renderer.domElement);

  const bee = new THREE.Group();
  scene.add(bee);

  const beeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uPointer: { value: new THREE.Vector3(99, 99, 0) },
      uPointerStrength: { value: 0 },
      uBurst: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [beeMaterial];

  function makePointCloud(
    positions: Float32Array,
    colorPicker: (index: number, x: number, y: number, z: number) => THREE.Color,
    sizeRange: [number, number],
    parent: THREE.Object3D
  ) {
    const count = positions.length / 3;
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const scratch = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      scratch.copy(colorPicker(i, x, y, z));
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
      sizes[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const rand = new Float32Array(count);
    for (let i = 0; i < count; i += 1) rand[i] = Math.random();
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));

    geometries.push(geometry);
    const points = new THREE.Points(geometry, beeMaterial);
    points.frustumCulled = false;
    parent.add(points);
    return points;
  }

  // Body with honey stripes
  makePointCloud(
    ellipsoidPositions(9000, BODY_RADII.x, BODY_RADII.y, BODY_RADII.z, new THREE.Vector3(), 0.1),
    (_i, x) => {
      const normalized = (x / BODY_RADII.x + 1) / 2;
      const band = Math.floor(normalized * 4.6);
      if (band % 2 === 1) return STRIPE_DARK;
      return Math.random() > 0.45 ? HONEY : HONEY_LIGHT;
    },
    [1.9, 3.6],
    bee
  );

  // Head
  makePointCloud(
    ellipsoidPositions(2400, 0.5, 0.5, 0.5, new THREE.Vector3(1.28, 0.04, 0), 0.09),
    () => (Math.random() > 0.55 ? HONEY_DEEP : HONEY),
    [1.8, 3.2],
    bee
  );

  // Eyes
  for (const side of [-1, 1]) {
    makePointCloud(
      ellipsoidPositions(260, 0.13, 0.16, 0.13, new THREE.Vector3(1.58, 0.22, side * 0.24), 0.05),
      () => EYE_COLOR,
      [1.6, 2.6],
      bee
    );
  }

  // Antennae
  for (const side of [-1, 1]) {
    const pointCount = 140;
    const positions = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i += 1) {
      const t = i / (pointCount - 1);
      positions[i * 3] = 1.5 + t * 0.3 + Math.sin(t * Math.PI) * 0.14;
      positions[i * 3 + 1] = 0.44 + t * 0.78;
      positions[i * 3 + 2] = side * (0.16 + t * 0.26 + Math.sin(t * 2.2) * 0.05);
    }
    makePointCloud(positions, () => HONEY_LIGHT, [1.4, 2.4], bee);
  }

  // Stinger
  {
    const pointCount = 160;
    const positions = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i += 1) {
      const t = i / (pointCount - 1);
      positions[i * 3] = -1.0 - t * 0.42;
      positions[i * 3 + 1] = -0.08 - t * 0.06;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.08 * (1 - t);
    }
    makePointCloud(positions, () => STRIPE_DARK, [1.4, 2.4], bee);
  }

  // Wings
  const wingLeft = new THREE.Group();
  wingLeft.position.set(0.18, 0.82, 0);
  const wingRight = new THREE.Group();
  wingRight.position.set(0.18, 0.82, 0);
  bee.add(wingLeft, wingRight);

  const wingPicker = () => (Math.random() > 0.75 ? WING_EDGE : WING_COLOR);
  makePointCloud(
    ellipsoidPositions(2600, 0.62, 0.045, 0.44, new THREE.Vector3(0, 0, -0.42), 0.06),
    wingPicker,
    [1.3, 2.5],
    wingLeft
  );
  makePointCloud(
    ellipsoidPositions(2600, 0.62, 0.045, 0.44, new THREE.Vector3(0, 0, 0.42), 0.06),
    wingPicker,
    [1.3, 2.5],
    wingRight
  );

  // Ambient haze
  const hazeCount = 1400;
  const hazePositions = new Float32Array(hazeCount * 3);
  const hazeDir = new THREE.Vector3();
  for (let i = 0; i < hazeCount; i += 1) {
    randomUnitVector(hazeDir);
    const radius = 2.6 + Math.random() * 2.6;
    hazePositions[i * 3] = hazeDir.x * radius;
    hazePositions[i * 3 + 1] = hazeDir.y * radius * 0.7;
    hazePositions[i * 3 + 2] = hazeDir.z * radius;
  }
  const hazeGeometry = new THREE.BufferGeometry();
  hazeGeometry.setAttribute('position', new THREE.BufferAttribute(hazePositions, 3));
  const hazeMaterial = new THREE.PointsMaterial({
    color: HAZE_COLOR,
    size: 0.035,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  geometries.push(hazeGeometry);
  materials.push(hazeMaterial);
  const haze = new THREE.Points(hazeGeometry, hazeMaterial);
  haze.frustumCulled = false;
  scene.add(haze);

  // Coin sprites
  const coinTextures = COINS.map((coin) => createCoinTexture(coin.label, coin.color)).filter(
    (texture): texture is THREE.CanvasTexture => texture !== null
  );

  const coins: Coin[] = [];
  const coinCount = reducedMotion ? 0 : 26;
  for (let i = 0; i < coinCount && coinTextures.length > 0; i += 1) {
    const texture = coinTextures[i % coinTextures.length];
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.frustumCulled = false;
    scene.add(sprite);
    materials.push(material);
    coins.push({
      sprite,
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 0,
      spin: 0,
      scale: 0.3,
    });
  }

  const spawnTarget = new THREE.Vector3();
  function spawnCoin() {
    if (coins.length === 0) return;
    const coin = coins.find((entry) => entry.life >= entry.maxLife);
    if (!coin) return;

    randomBodyPoint(spawnTarget);
    bee.updateMatrixWorld(true);
    const world = bee.localToWorld(spawnTarget.clone());
    const center = bee.localToWorld(new THREE.Vector3());
    const direction = world.clone().sub(center);
    if (direction.lengthSq() < 0.0001) direction.set(0, 1, 0);
    direction.normalize();

    coin.sprite.position.copy(world);
    coin.velocity.copy(direction).multiplyScalar(0.55 + Math.random() * 0.75);
    coin.velocity.y += 0.55 + Math.random() * 0.7;
    coin.life = 0;
    coin.maxLife = 2.1 + Math.random() * 1.5;
    coin.spin = (Math.random() - 0.5) * 3.2;
    coin.scale = 0.24 + Math.random() * 0.2;
    coin.sprite.material.rotation = Math.random() * Math.PI * 2;
    coin.sprite.visible = true;
  }

  // Pointer interaction
  const pointerNdc = new THREE.Vector2(0, 0);
  const pointerTarget = new THREE.Vector3(99, 99, 0);
  const raycaster = new THREE.Raycaster();
  const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let pointerActive = false;
  let pointerHit: THREE.Vector3 | null = null;
  let burst = 0;
  let interacted = false;

  function markInteracted() {
    if (interacted) return;
    interacted = true;
    options.onInteract?.();
  }

  function insideRect(clientX: number, clientY: number) {
    const rect = container.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  }

  function handlePointerMove(event: PointerEvent) {
    pointerActive = insideRect(event.clientX, event.clientY);
    if (!pointerActive) return;
    const rect = container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    pointerNdc.set(x, y);
    markInteracted();
  }

  function handlePointerLeave() {
    pointerActive = false;
  }

  function handleClick(event: MouseEvent) {
    if (!insideRect(event.clientX, event.clientY)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, input, select, textarea, label')) return;
    markInteracted();
    burst = 1;
    for (let i = 0; i < 9; i += 1) spawnCoin();
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('pointerdown', handlePointerMove, { passive: true });
  document.addEventListener('pointerleave', handlePointerLeave);
  window.addEventListener('click', handleClick);

  // Layout
  let baseY = 0;
  function layout() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;

    const wide = width >= 1024;
    if (wide) {
      bee.position.x = 1.55;
      bee.scale.setScalar(1);
    } else if (width >= 640) {
      bee.position.x = 0;
      bee.scale.setScalar(0.9);
    } else {
      bee.position.x = 0;
      bee.scale.setScalar(0.72);
    }
    baseY = wide ? 0.05 : 0.62;
    bee.position.y = baseY;
    camera.position.z = wide ? 6.4 : 7.2;
    camera.updateProjectionMatrix();
    haze.scale.setScalar(wide ? 1 : 1.15);
  }

  const resizeObserver = new ResizeObserver(() => {
    layout();
    renderFrame();
  });
  resizeObserver.observe(container);

  // Animation loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  let spawnTimer = 0;
  let running = document.visibilityState === 'visible';
  let visible = true;

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    },
    { threshold: 0.05 }
  );
  intersectionObserver.observe(container);

  function handleVisibility() {
    running = document.visibilityState === 'visible';
  }
  document.addEventListener('visibilitychange', handleVisibility);

  function renderFrame() {
    if (disposed) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    if (!reducedMotion) elapsed += delta;

    beeMaterial.uniforms.uTime.value = elapsed;
    beeMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();

    bee.rotation.z = Math.sin(elapsed * 0.6) * 0.05;
    bee.position.y = baseY + Math.sin(elapsed * 0.9) * 0.07;

    const flap = 0.24 + Math.sin(elapsed * 13) * 0.38;
    wingLeft.rotation.x = flap;
    wingRight.rotation.x = -flap;

    haze.rotation.y = elapsed * 0.06;
    haze.rotation.x = Math.sin(elapsed * 0.18) * 0.08;

    if (pointerActive) {
      raycaster.setFromCamera(pointerNdc, camera);
      if (!pointerHit) pointerHit = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(pointerPlane, pointerHit);
      if (hit) {
        bee.updateMatrixWorld(true);
        const local = bee.worldToLocal(hit.clone());
        pointerTarget.set(local.x, local.y, 0);
      }
    }
    const pointerUniform = beeMaterial.uniforms.uPointer.value as THREE.Vector3;
    pointerUniform.lerp(pointerTarget, 0.18);
    const strengthTarget = pointerActive ? 1 : 0;
    beeMaterial.uniforms.uPointerStrength.value +=
      (strengthTarget - beeMaterial.uniforms.uPointerStrength.value) * 0.12;

    burst = Math.max(0, burst - delta * 1.5);
    beeMaterial.uniforms.uBurst.value = burst;

    const rotYTarget = pointerActive ? pointerNdc.x * 0.42 : 0;
    const rotXTarget = pointerActive ? -pointerNdc.y * 0.24 : 0;
    bee.rotation.y += (rotYTarget - bee.rotation.y) * 0.05;
    bee.rotation.x += (rotXTarget - bee.rotation.x) * 0.05;
    camera.position.x += (pointerNdc.x * 0.35 - camera.position.x) * 0.04;
    camera.position.y += (0.2 + pointerNdc.y * 0.2 - camera.position.y) * 0.04;

    if (!reducedMotion) {
      spawnTimer += delta;
      if (spawnTimer > 0.6) {
        spawnTimer = 0;
        spawnCoin();
      }
      for (const coin of coins) {
        if (coin.life >= coin.maxLife) {
          coin.sprite.visible = false;
          continue;
        }
        coin.life += delta;
        coin.velocity.y -= 0.32 * delta;
        coin.sprite.position.addScaledVector(coin.velocity, delta);
        coin.sprite.material.rotation += coin.spin * delta;
        const progress = coin.life / coin.maxLife;
        const fade = progress < 0.16 ? progress / 0.16 : 1 - (progress - 0.16) / 0.84;
        coin.sprite.material.opacity = Math.max(0, fade) * 0.95;
        const scale = coin.scale * (0.78 + 0.28 * Math.sin(coin.life * 6));
        coin.sprite.scale.set(scale, scale, 1);
      }
    }

    renderer.render(scene, camera);
  }

  let frameId = 0;
  function loop() {
    frameId = requestAnimationFrame(loop);
    if (!running || !visible) return;
    renderFrame();
  }

  layout();
  renderFrame();
  if (!reducedMotion) {
    frameId = requestAnimationFrame(loop);
  }

  return () => {
    disposed = true;
    if (frameId) cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerdown', handlePointerMove);
    document.removeEventListener('pointerleave', handlePointerLeave);
    window.removeEventListener('click', handleClick);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of coinTextures) texture.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };
}
