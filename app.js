// 3D Graph Viewer (plain Three.js, mobile-optimized)
import * as THREE from 'https://unpkg.com/three@0.153.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.153.0/examples/jsm/controls/OrbitControls.js';

const canvas = document.getElementById('three-canvas');
const loadingEl = document.getElementById('loading');
const fileInput = document.getElementById('fileInput');
const fitBtn = document.getElementById('fitBtn');
const shareBtn = document.getElementById('shareBtn');
const panel = document.getElementById('panel');
const closePanel = document.getElementById('closePanel');
const nodeInfo = document.getElementById('nodeInfo');
const toast = document.getElementById('toast');

let scene, camera, renderer, controls;
let nodeMesh = null; // InstancedMesh
let edgeLines = null;
let raycaster, pointer;
let graph = null;
let nodeIdToIndex = new Map();
let nodeObjects = []; // store positions for camera fit

function showToast(msg, timeout=1500){
  toast.textContent = msg; toast.classList.remove('hidden');
  setTimeout(()=>toast.classList.add('hidden'), timeout);
}

function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
  renderer.setPixelRatio(dpr);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x03040a);

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 1, 100000);
  camera.position.set(0, 0, 800);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x080820, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(100, 200, 100);
  scene.add(dir);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.4;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.8;
  controls.minDistance = 20;

  // Touch-friendly settings
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function onResize(){
  if (!renderer) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function onPointerDown(ev){
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  if (nodeMesh){
    const intersects = raycaster.intersectObject(nodeMesh);
    if (intersects.length){
      const inst = intersects[0].instanceId;
      if (inst !== undefined && inst !== null) onNodeSelect(inst);
    }
  }
}

function buildSceneFromGraph(g){
  // If nodes don't have coordinates, compute client-side layout
  if (g && Array.isArray(g.nodes) && g.nodes.length){
    const needsCoords = g.nodes.some(n => typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.z !== 'number');
    if (needsCoords){
      // For very large graphs, skip heavy layout and fallback to random + recommend server-side export
      const MAX_LAYOUT = 1500;
      if (g.nodes.length <= MAX_LAYOUT){
        computeForceLayout3D(g, {iterations: 900, width: 800, height: 800, depth: 800});
      } else {
        // fallback random positions
        for (let i=0;i<g.nodes.length;i++){
          g.nodes[i].x = (Math.random()-0.5)*1200;
          g.nodes[i].y = (Math.random()-0.5)*1200;
          g.nodes[i].z = (Math.random()-0.5)*1200;
        }
        showToast('Large graph: using random positions. Consider server-side layout for best results.');
      }
    }
  }

  // Clear previous
  while(scene.children.length>0){
    scene.remove(scene.children[0]);
  }
  // add lights again
  scene.add(new THREE.HemisphereLight(0xffffff, 0x080820, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(100,200,100);
  scene.add(dir);

  nodeIdToIndex.clear(); nodeObjects = [];

  const nodes = g.nodes || [];
  const edges = g.edges || [];

  // Build instanced mesh for nodes
  const sphereGeom = new THREE.SphereGeometry(1, 12, 12);
  const maxNodes = Math.max(1, nodes.length);
  const instMesh = new THREE.InstancedMesh(sphereGeom, new THREE.MeshStandardMaterial({color:0x66b2ff}), maxNodes);
  instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Per-instance color attribute
  const colorAttr = new Float32Array(maxNodes * 3);

  for (let i=0;i<nodes.length;i++){
    const n = nodes[i];
    const id = n.id ?? i;
    nodeIdToIndex.set(String(id), i);

    // position now should exist
    const x = (typeof n.x === 'number') ? n.x : (Math.random()-0.5)*600;
    const y = (typeof n.y === 'number') ? n.y : (Math.random()-0.5)*600;
    const z = (typeof n.z === 'number') ? n.z : (Math.random()-0.5)*600;

    const size = Math.max(6, (n.size ?? 20) / 2);

    const mat = new THREE.Matrix4();
    mat.compose(new THREE.Vector3(x,y,z), new THREE.Quaternion(), new THREE.Vector3(size,size,size));
    instMesh.setMatrixAt(i, mat);

    const col = new THREE.Color(n.color ?? '#60a5fa');
    colorAttr[i*3+0] = col.r; colorAttr[i*3+1] = col.g; colorAttr[i*3+2] = col.b;

    nodeObjects.push({id, x,y,z,meta:n});
  }

  // Attach color attribute to geometry for later shader use (not applied by default material)
  try{
    instMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorAttr,3));
  }catch(e){/* ignore if not supported */}

  scene.add(instMesh);
  nodeMesh = instMesh;

  // Build edges as LineSegments
  if (edges.length){
    const positions = new Float32Array(edges.length * 6);
    let idx = 0;
    for (let i=0;i<edges.length;i++){
      const e = edges[i];
      const s = nodeObjects.find(n=>String(n.id) === String(e.source));
      const t = nodeObjects.find(n=>String(n.id) === String(e.target));
      if (!s || !t) continue;
      positions[idx++] = s.x; positions[idx++] = s.y; positions[idx++] = s.z;
      positions[idx++] = t.x; positions[idx++] = t.y; positions[idx++] = t.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({color:0x3f88a6});
    const lines = new THREE.LineSegments(geo, mat);
    scene.add(lines);
    edgeLines = lines;
  }

  // Add simple labels as sprites (only for small graphs)
  if (nodes.length <= 200){
    for (let i=0;i<nodes.length;i++){
      const n = nodes[i];
      const text = (n.name || n.label || String(n.id)).toString();
      const sprite = makeTextSprite(text, {fontsize: 18});
      sprite.position.set(nodeObjects[i].x, nodeObjects[i].y + (n.size? n.size/2 : 12), nodeObjects[i].z);
      scene.add(sprite);
    }
  }

  // store graph for interactions
  graph = g;

  // hide loading overlay
  loadingEl.style.display = 'none';

  // fit camera
  fitToNodes();
}

function makeTextSprite(message, parameters = {}){
  const fontface = parameters.hasOwnProperty('fontface') ? parameters['fontface'] : 'Arial';
  const fontsize = parameters.hasOwnProperty('fontsize') ? parameters['fontsize'] : 24;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${fontsize}px ${fontface}`;
  const metrics = context.measureText(message);
  const textWidth = metrics.width;
  canvas.width = Math.min(600, Math.ceil(textWidth) + 20);
  canvas.height = fontsize + 20;
  context.font = `${fontsize}px ${fontface}`;
  context.fillStyle = 'rgba(230,238,246,1)';
  context.fillText(message, 10, fontsize + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMaterial = new THREE.SpriteMaterial({map: texture, depthTest: false});
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(canvas.width * 0.5, canvas.height * 0.5, 1);
  return sprite;
}

function onNodeSelect(instanceIndex){
  const info = nodeObjects[instanceIndex];
  if (!info) return;
  nodeInfo.textContent = JSON.stringify(info.meta || info, null, 2);
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden','false');
  const target = new THREE.Vector3(info.x, info.y, info.z);
  flyTo(target);
}

function flyTo(target){
  const startPos = camera.position.clone();
  const startLook = controls.target.clone();
  const endPos = target.clone().add(new THREE.Vector3(0,0,Math.max(120, 0.6*controls.getDistance())));
  const endLook = target.clone();
  const duration = 400;
  const t0 = performance.now();
  function step(now){
    const t = Math.min(1, (now - t0) / duration);
    camera.position.lerpVectors(startPos, endPos, easeOutCubic(t));
    controls.target.lerpVectors(startLook, endLook, easeOutCubic(t));
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function easeOutCubic(t){return 1 - Math.pow(1 - t, 3)}

function fitToNodes(){
  if (!nodeObjects.length) return;
  const box = new THREE.Box3();
  for (const n of nodeObjects) box.expandByPoint(new THREE.Vector3(n.x,n.y,n.z));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0,0, Math.max(200, size*1.2)));
  controls.update();
}

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Simple 3D force-directed layout (Barnes-Hut not implemented — O(n^2) repulsion)
function computeForceLayout3D(g, opts = {}){
  const nodes = g.nodes;
  const edges = g.edges || [];
  const N = nodes.length;
  const iterations = opts.iterations || 600;
  const width = opts.width || 800;
  const height = opts.height || 800;
  const depth = opts.depth || 800;

  // Initialize positions randomly in cube
  for (let i=0;i<N;i++){
    nodes[i].x = (Math.random()-0.5) * width;
    nodes[i].y = (Math.random()-0.5) * height;
    nodes[i].z = (Math.random()-0.5) * depth;
    nodes[i].vx = 0; nodes[i].vy = 0; nodes[i].vz = 0;
  }

  // Build edge lookup for springs
  const springs = new Set();
  for (const e of edges){
    const a = String(e.source); const b = String(e.target);
    springs.add(a + '|' + b);
    springs.add(b + '|' + a);
  }

  // Parameters
  const k = Math.cbrt((width*height*depth) / N) || 30; // ideal distance
  const repulsion = (k*k);
  const stiffness = 0.06; // spring constant
  let t = Math.max(width, height, depth)/10; // temperature
  const cooling = 0.95;

  for (let iter=0; iter<iterations; iter++){
    // repulsive forces (O(n^2)) - OK for N up to ~1500
    for (let i=0;i<N;i++){
      let fx=0, fy=0, fz=0;
      const ni = nodes[i];
      for (let j=0;j<N;j++){
        if (i===j) continue;
        const nj = nodes[j];
        let dx = ni.x - nj.x; let dy = ni.y - nj.y; let dz = ni.z - nj.z;
        let dist2 = dx*dx + dy*dy + dz*dz + 0.01;
        let dist = Math.sqrt(dist2);
        // repulsive force
        const F = repulsion / dist2;
        fx += (dx/dist) * F;
        fy += (dy/dist) * F;
        fz += (dz/dist) * F;
      }
      ni.vx = (ni.vx + fx) * 0.6;
      ni.vy = (ni.vy + fy) * 0.6;
      ni.vz = (ni.vz + fz) * 0.6;
    }

    // attractive spring forces
    for (const e of edges){
      const si = nodes.findIndex(n => String(n.id) === String(e.source));
      const ti = nodes.findIndex(n => String(n.id) === String(e.target));
      if (si<0 || ti<0) continue;
      const a = nodes[si]; const b = nodes[ti];
      let dx = b.x - a.x; let dy = b.y - a.y; let dz = b.z - a.z;
      let dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.01;
      const force = stiffness * (dist - k);
      const ux = (dx/dist) * force; const uy = (dy/dist) * force; const uz = (dz/dist) * force;
      a.vx += ux; a.vy += uy; a.vz += uz;
      b.vx -= ux; b.vy -= uy; b.vz -= uz;
    }

    // integrate + temperature clamp
    for (let i=0;i<N;i++){
      const n = nodes[i];
      n.x += Math.max(-t, Math.min(t, n.vx));
      n.y += Math.max(-t, Math.min(t, n.vy));
      n.z += Math.max(-t, Math.min(t, n.vz));
      // damp velocities
      n.vx *= 0.7; n.vy *= 0.7; n.vz *= 0.7;
    }

    t *= cooling;
    // occasional abort for mobile responsiveness
    if (iter % 100 === 0){
      // yield to UI
    }
  }
}

// Load graph by URL or fallback to embedded data
async function loadGraphFromURL(url){
  loadingEl.style.display = 'block';
  try{
    const res = await fetch(url, {cache: 'no-cache'});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    buildSceneFromGraph(json);
    showToast('Graph loaded');
  }catch(err){
    loadingEl.style.display = 'none';
    console.error('Load graph failed', err);
    showToast('Failed to load graph');
  }
}

function loadEmbeddedGraph(){
  return loadGraphFromURL('/data/graph.json');
}

fileInput.addEventListener('change', async (ev)=>{
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const text = await f.text();
  try{
    const json = JSON.parse(text);
    buildSceneFromGraph(json);
  }catch(err){
    alert('Invalid JSON: ' + err.message);
  }
});

fitBtn.addEventListener('click', ()=>{fitToNodes(); showToast('Fitted');});
closePanel.addEventListener('click', ()=>{panel.classList.add('hidden'); panel.setAttribute('aria-hidden','true');});

shareBtn.addEventListener('click', ()=>{
  const base = location.origin + location.pathname;
  const params = new URLSearchParams(location.search);
  const graphParam = params.get('graph') || '/data/graph.json';
  const url = base + '?graph=' + encodeURIComponent(graphParam);
  navigator.clipboard?.writeText(url).then(()=> showToast('Link copied'), ()=> showToast('Copy failed'));
});

function getGraphParam(){
  const params = new URLSearchParams(location.search);
  return params.get('graph');
}

async function start(){
  initThree();
  animate();
  const external = getGraphParam();
  if (external){
    await loadGraphFromURL(external);
  } else {
    await loadEmbeddedGraph();
  }
}

start();

// small utility to compute approximate camera distance
OrbitControls.prototype.getDistance = function(){
  return camera.position.distanceTo(this.target);
}
