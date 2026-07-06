import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';

const DEFAULT_GRAPH_URL = '/data/graph.json';
const MAX_FORCE_LAYOUT_NODES = 900;
const FORCE_ITERATIONS = 260;

const els = {
  canvas: document.getElementById('threeCanvas'),
  viewer: document.getElementById('viewer'),
  loading: document.getElementById('loading'),
  toast: document.getElementById('toast'),
  fileInput: document.getElementById('fileInput'),
  fitBtn: document.getElementById('fitBtn'),
  shareBtn: document.getElementById('shareBtn'),
  status: document.getElementById('graphStatus'),
  source: document.getElementById('graphSource'),
  nodeCount: document.getElementById('nodeCount'),
  edgeCount: document.getElementById('edgeCount'),
  panel: document.getElementById('nodePanel'),
  closePanel: document.getElementById('closePanelBtn'),
  panelTitle: document.getElementById('panelTitle'),
  panelDetails: document.getElementById('panelDetails')
};

let scene;
let camera;
let renderer;
let controls;
let raycaster;
let pointer;
let nodesMesh = null;
let edgesLine = null;
let haloMesh = null;
let graph = { nodes: [], edges: [] };
let normalizedNodes = [];
let normalizedEdges = [];
let idToIndex = new Map();
let positions = [];
let activeGraphUrl = DEFAULT_GRAPH_URL;
let selectedIndex = -1;
let downPoint = null;

boot();

async function boot() {
  try {
    initScene();
    bindEvents();
    animate();
    const urlParam = new URLSearchParams(window.location.search).get('graph');
    activeGraphUrl = urlParam || DEFAULT_GRAPH_URL;
    await loadGraphFromUrl(activeGraphUrl);
  } catch (error) {
    showError(error);
  }
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050816);
  scene.fog = new THREE.FogExp2(0x050816, 0.0009);

  const { width, height } = viewportSize();
  camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 100000);
  camera.position.set(0, 0, 780);

  renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.72;
  controls.panSpeed = 0.65;
  controls.minDistance = 30;
  controls.maxDistance = 8000;

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  const ambient = new THREE.AmbientLight(0x9fc5ff, 1.15);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(240, 420, 540);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x7dd3fc, 1.1, 2400);
  fillLight.position.set(-420, -140, 500);
  scene.add(fillLight);
}

function bindEvents() {
  window.addEventListener('resize', resizeRenderer, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(resizeRenderer, 250), { passive: true });

  els.fitBtn.addEventListener('click', () => fitCamera(true));
  els.shareBtn.addEventListener('click', shareCurrentGraph);
  els.closePanel.addEventListener('click', closePanel);

  els.fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setLoading(`Loading ${file.name}…`);
      const text = await file.text();
      const parsed = JSON.parse(text);
      activeGraphUrl = '';
      renderGraph(parsed, file.name);
      toast(`Loaded ${file.name}`);
    } catch (error) {
      showError(error);
    } finally {
      event.target.value = '';
    }
  });

  els.canvas.addEventListener('pointerdown', (event) => {
    downPoint = { x: event.clientX, y: event.clientY, t: performance.now() };
  }, { passive: true });

  els.canvas.addEventListener('pointerup', (event) => {
    if (!downPoint) return;
    const dx = event.clientX - downPoint.x;
    const dy = event.clientY - downPoint.y;
    const distance = Math.hypot(dx, dy);
    const duration = performance.now() - downPoint.t;
    downPoint = null;
    if (distance <= 12 && duration < 700) pickNode(event);
  }, { passive: true });
}

async function loadGraphFromUrl(url) {
  try {
    setLoading(`Fetching ${shortSource(url)}…`);
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Graph fetch failed: HTTP ${response.status} for ${url}`);
    const data = await response.json();
    renderGraph(data, url);
  } catch (error) {
    throw new Error(`${error.message}. Check that the graph URL is reachable and returns valid JSON.`);
  }
}

function renderGraph(input, sourceLabel) {
  graph = normalizeGraph(input);
  normalizedNodes = graph.nodes;
  normalizedEdges = graph.edges;
  idToIndex = new Map(normalizedNodes.map((node, index) => [node.id, index]));
  positions = computePositions(normalizedNodes, normalizedEdges);

  clearGraphObjects();
  createNodeInstances();
  createEdges();
  createHalo();
  updateHud(sourceLabel);
  fitCamera(false);
  closePanel();
  els.loading.classList.add('hidden');
}

function normalizeGraph(input) {
  if (!input || typeof input !== 'object') throw new Error('Graph JSON must be an object.');
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input.edges) ? input.edges : Array.isArray(input.links) ? input.links : [];
  if (!rawNodes.length) throw new Error('Graph JSON must include a non-empty nodes array.');

  const seen = new Set();
  const nodes = rawNodes.map((node, index) => {
    const id = String(node.id ?? node.key ?? node.name ?? index);
    if (seen.has(id)) throw new Error(`Duplicate node id: ${id}`);
    seen.add(id);
    return {
      ...node,
      id,
      label: String(node.label ?? node.name ?? node.path ?? id),
      size: clampNumber(Number(node.size ?? node.value ?? node.weight ?? 18), 8, 60),
      color: safeColor(node.color, index)
    };
  });

  const validIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges.map((edge) => {
    const source = endpointToId(edge.source ?? edge.from);
    const target = endpointToId(edge.target ?? edge.to);
    return { ...edge, source, target };
  }).filter((edge) => validIds.has(edge.source) && validIds.has(edge.target) && edge.source !== edge.target);

  return { nodes, edges };
}

function endpointToId(value) {
  if (value && typeof value === 'object') return String(value.id ?? value.key ?? value.name ?? '');
  return String(value ?? '');
}

function computePositions(nodes, edges) {
  const everyNodeHas3D = nodes.every((node) => finite(node.x) && finite(node.y) && finite(node.z));
  if (everyNodeHas3D) return nodes.map((node) => new THREE.Vector3(Number(node.x), Number(node.y), Number(node.z)));

  if (nodes.length > MAX_FORCE_LAYOUT_NODES) return sphericalFallback(nodes.length);

  return forceLayout(nodes, edges);
}

function forceLayout(nodes, edges) {
  const count = nodes.length;
  const vectors = [];
  const velocities = [];
  const radius = Math.max(160, Math.sqrt(count) * 72);

  for (let i = 0; i < count; i += 1) {
    const seed = hashString(nodes[i].id);
    const theta = (seed % 6283) / 1000;
    const phi = (((seed >> 8) % 3141) / 3141) * Math.PI;
    const r = radius * (0.45 + ((seed >> 16) % 1000) / 1650);
    vectors.push(new THREE.Vector3(
      Math.cos(theta) * Math.sin(phi) * r,
      Math.sin(theta) * Math.sin(phi) * r,
      Math.cos(phi) * r
    ));
    velocities.push(new THREE.Vector3());
  }

  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const indexedEdges = edges.map((edge) => [indexById.get(edge.source), indexById.get(edge.target)])
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b));

  for (let iteration = 0; iteration < FORCE_ITERATIONS; iteration += 1) {
    const cooling = 1 - iteration / FORCE_ITERATIONS;
    const repulsion = 4600 * cooling;
    const attraction = 0.006 + 0.012 * cooling;

    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const delta = vectors[i].clone().sub(vectors[j]);
        let distSq = Math.max(delta.lengthSq(), 80);
        const force = repulsion / distSq;
        delta.normalize().multiplyScalar(force);
        velocities[i].add(delta);
        velocities[j].sub(delta);
      }
    }

    for (const [a, b] of indexedEdges) {
      const delta = vectors[b].clone().sub(vectors[a]);
      const distance = Math.max(delta.length(), 1);
      const desired = 135;
      const force = (distance - desired) * attraction;
      delta.normalize().multiplyScalar(force);
      velocities[a].add(delta);
      velocities[b].sub(delta);
    }

    for (let i = 0; i < count; i += 1) {
      const centerPull = vectors[i].clone().multiplyScalar(-0.0025);
      velocities[i].add(centerPull);
      velocities[i].multiplyScalar(0.78);
      vectors[i].add(velocities[i]);
    }
  }

  return vectors;
}

function sphericalFallback(count) {
  const vectors = [];
  const radius = Math.max(380, Math.sqrt(count) * 32);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    vectors.push(new THREE.Vector3(Math.cos(theta) * radial * radius, y * radius, Math.sin(theta) * radial * radius));
  }
  return vectors;
}

function createNodeInstances() {
  const geometry = new THREE.SphereGeometry(1, 18, 12);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.18,
    vertexColors: true
  });

  nodesMesh = new THREE.InstancedMesh(geometry, material, normalizedNodes.length);
  nodesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  normalizedNodes.forEach((node, index) => {
    dummy.position.copy(positions[index]);
    const scale = node.size;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    nodesMesh.setMatrixAt(index, dummy.matrix);
    color.set(node.color);
    nodesMesh.setColorAt(index, color);
  });

  nodesMesh.userData.type = 'nodes';
  scene.add(nodesMesh);
}

function createEdges() {
  if (!normalizedEdges.length) return;
  const coords = new Float32Array(normalizedEdges.length * 2 * 3);
  let cursor = 0;
  for (const edge of normalizedEdges) {
    const sourceIndex = idToIndex.get(edge.source);
    const targetIndex = idToIndex.get(edge.target);
    const source = positions[sourceIndex];
    const target = positions[targetIndex];
    coords[cursor++] = source.x;
    coords[cursor++] = source.y;
    coords[cursor++] = source.z;
    coords[cursor++] = target.x;
    coords[cursor++] = target.y;
    coords[cursor++] = target.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(coords, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x8fb7ff, transparent: true, opacity: 0.34 });
  edgesLine = new THREE.LineSegments(geometry, material);
  scene.add(edgesLine);
}

function createHalo() {
  const geometry = new THREE.RingGeometry(1, 1.3, 48);
  const material = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  haloMesh = new THREE.Mesh(geometry, material);
  haloMesh.visible = false;
  scene.add(haloMesh);
}

function pickNode(event) {
  if (!nodesMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(nodesMesh, false)[0];
  if (!hit || hit.instanceId == null) return;
  selectNode(hit.instanceId);
}

function selectNode(index) {
  selectedIndex = index;
  const node = normalizedNodes[index];
  const position = positions[index];
  els.panelTitle.textContent = node.label;
  els.panelDetails.innerHTML = '';

  const details = {
    id: node.id,
    type: node.type,
    path: node.path,
    size: node.size,
    degree: degreeFor(node.id),
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z)
  };

  const extraKeys = Object.keys(node).filter((key) => !['id', 'label', 'name', 'size', 'color', 'x', 'y', 'z', 'type', 'path'].includes(key));
  for (const key of extraKeys.slice(0, 12)) details[key] = stringifyValue(node[key]);

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === '') continue;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = String(value);
    els.panelDetails.append(dt, dd);
  }

  haloMesh.visible = true;
  haloMesh.position.copy(position);
  haloMesh.scale.setScalar(Math.max(node.size * 1.65, 22));
  haloMesh.lookAt(camera.position);
  els.panel.classList.remove('hidden');
}

function degreeFor(id) {
  return normalizedEdges.reduce((total, edge) => total + (edge.source === id || edge.target === id ? 1 : 0), 0);
}

function clearGraphObjects() {
  for (const object of [nodesMesh, edgesLine, haloMesh]) {
    if (!object) continue;
    scene.remove(object);
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  }
  nodesMesh = null;
  edgesLine = null;
  haloMesh = null;
  selectedIndex = -1;
}

function fitCamera(announce = false) {
  if (!positions.length) return;
  const box = new THREE.Box3();
  for (const point of positions) box.expandByPoint(point);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 80);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.48));

  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1) direction.set(0, 0, 1);
  direction.normalize();

  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(direction.multiplyScalar(distance * 1.18));
  camera.near = Math.max(0.1, distance / 1000);
  camera.far = Math.max(5000, distance * 8);
  camera.updateProjectionMatrix();
  controls.update();
  if (announce) toast('View fitted');
}

async function shareCurrentGraph() {
  let url;
  if (activeGraphUrl && activeGraphUrl !== DEFAULT_GRAPH_URL) {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('graph', activeGraphUrl);
    url = shareUrl.toString();
  } else {
    url = `${window.location.origin}${window.location.pathname}`;
  }

  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied');
  } catch {
    window.prompt('Copy this graph link:', url);
  }
}

function updateHud(sourceLabel) {
  els.nodeCount.textContent = String(normalizedNodes.length);
  els.edgeCount.textContent = String(normalizedEdges.length);
  els.source.textContent = shortSource(sourceLabel || DEFAULT_GRAPH_URL);
  els.status.textContent = `${normalizedNodes.length} nodes · ${normalizedEdges.length} edges`;
}

function setLoading(message) {
  els.loading.textContent = message;
  els.loading.classList.remove('hidden');
  els.status.textContent = message;
}

function toast(message, timeout = 1700) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => els.toast.classList.add('hidden'), timeout);
}

function showError(error) {
  console.error(error);
  els.loading.textContent = error.message || 'Something failed while loading the graph.';
  els.loading.classList.remove('hidden');
  els.status.textContent = 'Graph load failed';
  toast('Graph load failed', 2600);
}

function closePanel() {
  els.panel.classList.add('hidden');
  selectedIndex = -1;
  if (haloMesh) haloMesh.visible = false;
}

function resizeRenderer() {
  const { width, height } = viewportSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (haloMesh?.visible) haloMesh.lookAt(camera.position);
  renderer.render(scene, camera);
}

function viewportSize() {
  const width = Math.max(1, els.viewer.clientWidth || window.innerWidth);
  const height = Math.max(1, els.viewer.clientHeight || window.innerHeight);
  return { width, height };
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function safeColor(value, index) {
  if (typeof value === 'string') {
    const color = new THREE.Color();
    try {
      color.set(value);
      return value;
    } catch {
      // fall through to palette
    }
  }
  const palette = ['#7dd3fc', '#a78bfa', '#22c55e', '#f59e0b', '#ec4899', '#facc15', '#38bdf8', '#fb7185'];
  return palette[index % palette.length];
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stringifyValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shortSource(value) {
  if (!value) return 'Local file';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname;
    return url.hostname + url.pathname;
  } catch {
    return String(value);
  }
}
