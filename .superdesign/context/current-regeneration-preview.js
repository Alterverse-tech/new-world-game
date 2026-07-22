import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const list = document.getElementById("list");
const stage = document.getElementById("stage");
const statusNode = document.getElementById("status");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x131720);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(3.2, 2.3, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);

scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x443735, 2.2));
const key = new THREE.DirectionalLight(0xffefd2, 3);
key.position.set(4, 7, 5);
key.castShadow = true;
scene.add(key);
scene.add(new THREE.GridHelper(8, 16, 0x66707d, 0x303743));

const root = new THREE.Group();
scene.add(root);
const loader = new GLTFLoader();
const clock = new THREE.Clock();
let mixer;
let current;
let activeUrl = "";
let activeKey = "";
let lastSignature = "";
let loadRequest = 0;

resize();
window.addEventListener("resize", resize);
requestAnimationFrame(tick);
poll();
setInterval(poll, 2000);

async function poll() {
  try {
    const response = await fetch(`./regeneration-status.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    renderStatus(await response.json());
  } catch (error) {
    if (!activeUrl) statusNode.textContent = `等待状态文件：${error.message}`;
  }
}

function renderStatus(data) {
  if (!activeUrl) statusNode.innerHTML = `<b>${escapeHtml(data.status || "unknown")}</b><br>${escapeHtml(data.message || "")}`;
  const items = Array.isArray(data.items) ? data.items : [];
  const signature = JSON.stringify([
    data.runId,
    data.updatedAt,
    items.map((item) => [
      item.id,
      item.status,
      item.progress,
      item.runtimeUrl,
      item.error,
      (item.clips || []).map((clip) => [clip.name, clip.status, clip.progress, clip.runtimeUrl, clip.error])
    ])
  ]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  list.innerHTML = "";
  for (const item of items) {
    list.appendChild(createPreviewButton({
      key: `${item.id}:base`,
      name: item.name || item.id,
      kindLabel: "基础模型 GLB",
      status: item.status,
      progress: item.progress,
      runtimeUrl: item.runtimeUrl,
      error: item.error,
      onClick: () => loadPreview(item, undefined, data.updatedAt)
    }));
    for (const clip of item.clips || []) {
      list.appendChild(createPreviewButton({
        key: `${item.id}:${clip.name}`,
        name: actionLabel(clip.name),
        kindLabel: "动作模型 GLB",
        status: clip.status,
        progress: clip.progress,
        runtimeUrl: clip.runtimeUrl,
        error: clip.error,
        isClip: true,
        onClick: () => loadPreview(item, clip, data.updatedAt)
      }));
    }
  }
  const firstReady = items.find((item) => item.runtimeUrl);
  if (!activeUrl && firstReady) {
    const firstReadyClip = (firstReady.clips || []).find((clip) => clip.runtimeUrl);
    loadPreview(firstReady, firstReadyClip, data.updatedAt);
  }
}

function createPreviewButton({ key: previewKey, name, kindLabel, status, progress, runtimeUrl, error, isClip = false, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.previewKey = previewKey;
  button.className = `item${isClip ? " clip-item" : ""}${runtimeUrl ? " ready" : ""}${previewKey === activeKey ? " active" : ""}${status === "failed" ? " failed" : ""}`;
  const detail = error || (runtimeUrl ? fileNameFromUrl(runtimeUrl) : "等待 GLB 文件");
  button.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(kindLabel)} · ${escapeHtml(status || "pending")} · ${Math.round(progress || 0)}%</span><code>${escapeHtml(detail)}</code><progress max="100" value="${Number(progress || 0)}"></progress>`;
  button.disabled = !runtimeUrl;
  button.addEventListener("click", onClick);
  return button;
}

function loadPreview(item, clip, version) {
  if (!item.runtimeUrl || (clip && !clip.runtimeUrl)) return;
  const request = ++loadRequest;
  const label = clip ? `${item.name || item.id} · ${actionLabel(clip.name)}` : item.name || item.id;
  activeUrl = clip?.runtimeUrl || item.runtimeUrl;
  activeKey = `${item.id}:${clip?.name || "base"}`;
  updateActiveButtons();
  clearCurrent();
  statusNode.innerHTML = `<b>${escapeHtml(label)}</b><br>${escapeHtml(activeUrl)}`;
  loader.load(
    versionedUrl(item.runtimeUrl, version),
    (gltf) => {
      if (request !== loadRequest) return;
      current = gltf.scene;
      prepareScene(current);
      normalize(current);
      root.add(current);
      if (clip) loadActionClip(clip, current, request, label, version);
      else if (gltf.animations.length) playClip(current, gltf.animations[0]);
    },
    undefined,
    (error) => {
      if (request === loadRequest) statusNode.innerHTML = `基础模型加载失败：${escapeHtml(error.message || String(error))}`;
    }
  );
}

function loadActionClip(clip, mainRoot, request, label, version) {
  loader.load(
    versionedUrl(clip.runtimeUrl, version),
    (actionGltf) => {
      if (request !== loadRequest || mainRoot !== current) return;
      const animation = actionGltf.animations[0];
      if (!animation) {
        statusNode.innerHTML = `<b>${escapeHtml(label)}</b><br>动作 GLB 中没有可播放的 AnimationClip`;
        return;
      }
      if (!clipCanBind(animation, mainRoot)) {
        showActionSceneFallback(actionGltf, animation, request, label);
        return;
      }
      playClip(mainRoot, animation);
      statusNode.innerHTML = `<b>${escapeHtml(label)}</b><br>动作 GLB 已绑定基础模型 · ${animation.duration.toFixed(2)} 秒循环`;
    },
    undefined,
    (error) => {
      if (request === loadRequest) statusNode.innerHTML = `动作模型加载失败：${escapeHtml(error.message || String(error))}`;
    }
  );
}

function clipCanBind(animation, target) {
  if (!animation.tracks.length) return false;
  return animation.tracks.some((track) => {
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      return !parsed.nodeName || Boolean(THREE.PropertyBinding.findNode(target, parsed.nodeName));
    } catch {
      return false;
    }
  });
}

function showActionSceneFallback(actionGltf, animation, request, label) {
  if (request !== loadRequest) return;
  clearCurrent();
  current = actionGltf.scene;
  prepareScene(current);
  normalize(current);
  root.add(current);
  playClip(current, animation);
  statusNode.innerHTML = `<b>${escapeHtml(label)}</b><br>动作骨架未绑定基础模型，正在直接显示动作 GLB 场景`;
}

function playClip(target, animation) {
  mixer?.stopAllAction?.();
  mixer = new THREE.AnimationMixer(target);
  mixer.clipAction(animation, target).reset().play();
}

function prepareScene(object) {
  object.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function updateActiveButtons() {
  for (const button of list.querySelectorAll("[data-preview-key]")) button.classList.toggle("active", button.dataset.previewKey === activeKey);
}

function actionLabel(name) {
  return ({ idle: "待机 Idle", walk: "行走 Walk", run: "奔跑 Run", jump: "跳跃 Jump" })[String(name).toLowerCase()] || name;
}

function fileNameFromUrl(url) {
  return String(url).split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1) || url;
}

function versionedUrl(url, version) {
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function clearCurrent() {
  mixer?.stopAllAction?.();
  mixer = undefined;
  if (!current) return;
  root.remove(current);
  current.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (Array.isArray(obj.material)) obj.material.forEach((material) => material.dispose?.());
    else obj.material?.dispose?.();
  });
  current = undefined;
}

function normalize(object) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  object.scale.setScalar(2.6 / Math.max(size.x, size.y, size.z, 0.001));
  object.updateWorldMatrix(true, true);
  const nextBox = new THREE.Box3().setFromObject(object);
  const center = nextBox.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= nextBox.min.y;
  root.rotation.y = 0;
  controls.target.set(0, 1.2, 0);
  controls.update();
}

function resize() {
  const box = stage.getBoundingClientRect();
  renderer.setSize(box.width, box.height, false);
  camera.aspect = box.width / Math.max(1, box.height);
  camera.updateProjectionMatrix();
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  mixer?.update(dt);
  if (current) root.rotation.y += dt * 0.28;
  controls.update();
  renderer.render(scene, camera);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
