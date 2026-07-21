import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createLobbyProp,
  updateLobbyProp,
} from '/src/lobby-props/generated/anime-badminton-court.ts';

const canvas = document.querySelector('#scene');
const resetButton = document.querySelector('#reset-view');
const animationButton = document.querySelector('#toggle-animation');
const rotateButton = document.querySelector('#toggle-rotate');
const dimensionsLabel = document.querySelector('#dimensions');
const meshCountLabel = document.querySelector('#mesh-count');
const loading = document.querySelector('#loading');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#151a38', 0.018);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 5;
controls.maxDistance = 38;
controls.maxPolarAngle = Math.PI * 0.48;
controls.autoRotateSpeed = 0.7;

scene.add(new THREE.HemisphereLight('#c9faff', '#352558', 2.1));

const keyLight = new THREE.DirectionalLight('#fff7ed', 3.4);
keyLight.position.set(-7, 12, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 40;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight('#ff7cbd', 2.2);
rimLight.position.set(8, 5, -8);
scene.add(rimLight);

const fillLight = new THREE.PointLight('#68e8ef', 18, 28, 2);
fillLight.position.set(-7, 4, -2);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 96),
  new THREE.MeshStandardMaterial({
    color: '#171c3b',
    roughness: 0.88,
    metalness: 0.05,
    transparent: true,
    opacity: 0.94,
  }),
);
ground.name = 'PreviewGround';
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const rings = new THREE.Group();
for (const radius of [7.5, 11, 15]) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.018, 96),
    new THREE.MeshBasicMaterial({ color: '#6772a8', transparent: true, opacity: 0.17, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  rings.add(ring);
}
scene.add(rings);

const prop = createLobbyProp();
scene.add(prop);

const bounds = new THREE.Box3().setFromObject(prop);
const size = bounds.getSize(new THREE.Vector3());
const center = bounds.getCenter(new THREE.Vector3());
let meshCount = 0;
prop.traverse((child) => {
  if (child.isMesh) meshCount += 1;
});
dimensionsLabel.textContent = `${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} m`;
meshCountLabel.textContent = `${meshCount} 个 Mesh`;

function resetCamera() {
  const maximum = Math.max(size.x, size.y, size.z);
  const distance = maximum * 1.34;
  camera.position.copy(center).add(new THREE.Vector3(0.82, 0.68, 1).normalize().multiplyScalar(distance));
  camera.near = Math.max(0.02, maximum / 200);
  camera.far = maximum * 40;
  camera.updateProjectionMatrix();
  controls.target.copy(center).add(new THREE.Vector3(0, -0.22, 0));
  controls.update();
}

resetCamera();

let animationEnabled = true;
animationButton.addEventListener('click', () => {
  animationEnabled = !animationEnabled;
  animationButton.classList.toggle('active', animationEnabled);
  animationButton.setAttribute('aria-pressed', String(animationEnabled));
  animationButton.lastChild.textContent = animationEnabled ? '动画开启' : '动画暂停';
});

rotateButton.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  rotateButton.classList.toggle('active', controls.autoRotate);
  rotateButton.setAttribute('aria-pressed', String(controls.autoRotate));
});

resetButton.addEventListener('click', resetCamera);

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeRenderer, { passive: true });
resizeRenderer();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const elapsed = clock.getElapsedTime();
  if (animationEnabled) updateLobbyProp(prop, elapsed);
  rings.rotation.y = elapsed * 0.018;
  controls.update();
  renderer.render(scene, camera);
});

requestAnimationFrame(() => loading.classList.add('hidden'));
