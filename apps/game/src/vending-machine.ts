import * as THREE from 'three';

export const VENDING_TRACK = Object.freeze({
  bpm: 126,
  bars: 18,
  stepsPerBar: 16,
  sixteenthSeconds: 60 / 126 / 4,
  coinSeconds: 0.85,
  musicSeconds: 18 * 16 * (60 / 126 / 4),
  durationSeconds: 0.85 + 18 * 16 * (60 / 126 / 4),
});

export type VendingPlaybackPhase = 'idle' | 'coin' | 'playing' | 'ended';

export interface VendingPlaybackSnapshot {
  phase: VendingPlaybackPhase;
  elapsedSeconds: number;
  songElapsedSeconds: number;
  coinProgress: number;
  coinVisible: boolean;
  step: number | null;
  bar: number | null;
  stepInBar: number | null;
  slotIntensities: number[];
  activeSlots: number[];
  buttonIntensities: number[];
  signIntensity: number;
  displayText: string;
  cabinetOffset: { x: number; y: number };
  lightIntensity: number;
  reducedMotion: boolean;
}

const SLOT_COUNT = 15;
const BUTTON_COUNT = 5;
const DARK_PANEL = new THREE.Color('#171a20');
const WARM_FLASH = new THREE.Color('#ffe9c4');
const BLUE_FLASH = new THREE.Color('#b9f0ff');
const PINK_FLASH = new THREE.Color('#ffd9ec');
const CAN_COLORS = [
  '#2f7fd6', '#e8e8e8', '#31b8c4', '#1450a0', '#9fd0ff',
  '#d0342c', '#f2b32a', '#8a4a2b', '#e86a2f', '#efe3c8',
  '#2e9e4f', '#9fd76a', '#1f6b4a', '#7a4dc9', '#37c48f',
] as const;
const MELODY_SCALE = [392, 440, 523.25, 587.33, 659.25, 783.99, 880] as const;
const MELODY_TO_SLOT = [10, 12, 6, 8, 2, 3, 0] as const;

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function emptySnapshot(reducedMotion: boolean): VendingPlaybackSnapshot {
  return {
    phase: 'idle',
    elapsedSeconds: 0,
    songElapsedSeconds: 0,
    coinProgress: 0,
    coinVisible: false,
    step: null,
    bar: null,
    stepInBar: null,
    slotIntensities: Array<number>(SLOT_COUNT).fill(0),
    activeSlots: [],
    buttonIntensities: Array<number>(BUTTON_COUNT).fill(0),
    signIntensity: 0.18,
    displayText: '- - -',
    cabinetOffset: { x: 0, y: 0 },
    lightIntensity: 0.35,
    reducedMotion,
  };
}

export function vendingPlaybackSnapshot(
  startedAt: number | null,
  simulationTime: number,
  reducedMotion = false,
): VendingPlaybackSnapshot {
  if (startedAt === null || !Number.isFinite(startedAt)) return emptySnapshot(reducedMotion);
  const elapsedSeconds = Math.max(0, simulationTime - startedAt);
  if (elapsedSeconds < VENDING_TRACK.coinSeconds) {
    const progress = clamp01(elapsedSeconds / VENDING_TRACK.coinSeconds);
    return {
      ...emptySnapshot(reducedMotion),
      phase: 'coin',
      elapsedSeconds,
      coinProgress: progress,
      coinVisible: true,
      signIntensity: reducedMotion ? 0.36 : 0.25 + progress * 0.45,
      displayText: progress > 0.68 ? '¥100' : 'INSERT',
      lightIntensity: reducedMotion ? 0.46 : 0.4 + progress * 0.55,
    };
  }

  const songElapsedSeconds = elapsedSeconds - VENDING_TRACK.coinSeconds;
  if (songElapsedSeconds >= VENDING_TRACK.musicSeconds) {
    return {
      ...emptySnapshot(reducedMotion),
      phase: 'ended',
      elapsedSeconds,
      songElapsedSeconds: VENDING_TRACK.musicSeconds,
      signIntensity: 0.28,
      displayText: 'ありがとう',
      lightIntensity: 0.3,
    };
  }

  const exactStep = songElapsedSeconds / VENDING_TRACK.sixteenthSeconds;
  const step = Math.min(VENDING_TRACK.bars * VENDING_TRACK.stepsPerBar - 1, Math.floor(exactStep));
  const stepFraction = exactStep - step;
  const bar = Math.floor(step / VENDING_TRACK.stepsPerBar);
  const stepInBar = step % VENDING_TRACK.stepsPerBar;
  const beat = Math.floor(stepInBar / 4);
  const beatPulse = Math.exp(-stepFraction * 5.5);
  const slotIntensities = Array<number>(SLOT_COUNT).fill(0.035);
  const buttonIntensities = Array<number>(BUTTON_COUNT).fill(0);
  let displayText = 'ヨウコソ';

  if (bar < 4) {
    const primary = (bar * 7 + stepInBar * 4 + 2) % SLOT_COUNT;
    slotIntensities[primary] = 0.46 + beatPulse * 0.44;
    slotIntensities[(primary + 5) % SLOT_COUNT] = 0.18;
    displayText = bar % 2 === 0 ? 'ヨウコソ' : '♪ 126';
  } else if (bar < 8) {
    const column = ((bar - 4) * 4 + beat) % 5;
    for (let row = 0; row < 3; row += 1) slotIntensities[row * 5 + column] = 0.45 + beatPulse * 0.55;
    buttonIntensities[column] = 0.35 + beatPulse * 0.65;
    displayText = 'RHYTHM';
  } else if (bar < 12) {
    const melodyIndex = (bar * 3 + beat + Math.floor(stepInBar / 2)) % MELODY_TO_SLOT.length;
    const primary = MELODY_TO_SLOT[melodyIndex]!;
    slotIntensities[primary] = 0.6 + beatPulse * 0.4;
    slotIntensities[(primary + 1) % SLOT_COUNT] = 0.24;
    slotIntensities[((bar - 8) % 3) * 5 + beat] = Math.max(0.38, beatPulse * 0.62);
    displayText = 'SING';
  } else if (bar < 16) {
    const parity = (beat + bar) % 2;
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const row = Math.floor(index / 5);
      const column = index % 5;
      slotIntensities[index] = (row + column) % 2 === parity ? 0.45 + beatPulse * 0.48 : 0.06;
    }
    buttonIntensities[beat % BUTTON_COUNT] = 0.38 + beatPulse * 0.55;
    displayText = bar % 2 === 0 ? 'LUCKY' : '♪ ♪';
  } else if (bar === 16) {
    const row = Math.min(2, Math.floor(stepInBar / 5));
    for (let column = 0; column < 5; column += 1) slotIntensities[row * 5 + column] = 0.38 + beatPulse * 0.42;
    displayText = '88:88';
  } else {
    const primary = stepInBar < 6 ? 7 : stepInBar < 12 ? 2 : 12;
    slotIntensities[primary] = 0.34 + beatPulse * 0.48;
    displayText = stepInBar >= 12 ? 'ありがとう' : 'THANK U';
  }

  if (reducedMotion) {
    for (let index = 0; index < slotIntensities.length; index += 1) {
      slotIntensities[index] = Math.min(0.58, slotIntensities[index]! * 0.72);
    }
    for (let index = 0; index < buttonIntensities.length; index += 1) {
      buttonIntensities[index] = Math.min(0.5, buttonIntensities[index]! * 0.68);
    }
  }

  const kick = stepInBar % 4 === 0 ? beatPulse : beatPulse * 0.12;
  const signIntensity = reducedMotion ? 0.42 : 0.3 + kick * 0.7;
  const activeSlots = slotIntensities
    .map((intensity, index) => ({ intensity, index }))
    .filter(({ intensity }) => intensity > 0.14)
    .map(({ index }) => index);
  const cabinetOffset = reducedMotion
    ? { x: 0, y: 0 }
    : {
        x: Math.sin(songElapsedSeconds * 95) * 0.012 * kick,
        y: Math.sin(songElapsedSeconds * 130) * 0.005 * kick,
      };

  return {
    phase: 'playing',
    elapsedSeconds,
    songElapsedSeconds,
    coinProgress: 1,
    coinVisible: false,
    step,
    bar,
    stepInBar,
    slotIntensities,
    activeSlots,
    buttonIntensities,
    signIntensity,
    displayText,
    cabinetOffset,
    lightIntensity: reducedMotion ? 0.52 : 0.5 + kick * 0.85,
    reducedMotion,
  };
}

type CanvasDraw = (context: CanvasRenderingContext2D, width: number, height: number) => void;

export class MusicVendingMachine {
  public readonly root = new THREE.Group();
  public readonly localCollider = new THREE.Box3(
    new THREE.Vector3(-1.21, 0, -0.63),
    new THREE.Vector3(1.21, 3.95, 0.63),
  );

  private readonly cabinet = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly slotBackMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly canMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly canBaseColors: THREE.Color[] = [];
  private readonly buttonMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly signMaterial: THREE.MeshStandardMaterial;
  private readonly displayMaterial: THREE.MeshBasicMaterial;
  private readonly displayCanvas: HTMLCanvasElement | null;
  private readonly displayContext: CanvasRenderingContext2D | null;
  private readonly coin: THREE.Mesh;
  private readonly performanceLight: THREE.PointLight;
  private startedAt: number | null = null;
  private reducedMotion = false;
  private lastDisplayText = '';
  private disposed = false;

  public constructor() {
    this.root.name = 'MusicVendingMachine';
    this.cabinet.name = 'MusicVendingMachineCabinet';
    this.root.add(this.cabinet);

    const shell = this.standardMaterial({ color: '#f2f3f5', roughness: 0.6, metalness: 0.03 });
    const trim = this.standardMaterial({ color: '#1450a0', roughness: 0.42, metalness: 0.18 });
    const metal = this.standardMaterial({ color: '#c4c9d0', roughness: 0.38, metalness: 0.48 });
    const dark = this.standardMaterial({ color: '#171a20', roughness: 0.68, metalness: 0.18 });
    const black = this.basicMaterial({ color: '#0e1116' });

    this.addBox(2.3, 3.7, 1.14, shell, 0, 2.01, 0);
    this.addBox(2.42, 0.09, 1.26, metal, 0, 3.9, 0);
    this.addBox(2.16, 0.16, 1.02, dark, 0, 0.08, 0);
    this.addBox(0.035, 3.3, 0.92, trim, -1.16, 2, 0);
    this.addPlane(1.98, 1.55, black, 0, 2.62, 0.575);
    this.addBox(2.06, 0.05, 0.03, metal, 0, 3.415, 0.7);
    this.addBox(2.06, 0.05, 0.03, metal, 0, 1.825, 0.7);
    this.addBox(0.05, 1.64, 0.03, metal, -1.005, 2.62, 0.7);
    this.addBox(0.05, 1.64, 0.03, metal, 1.005, 2.62, 0.7);

    const glass = this.standardMaterial({
      color: '#dcecff', transparent: true, opacity: 0.085, roughness: 0.08, metalness: 0.02,
      depthWrite: false,
    });
    this.addPlane(1.98, 1.55, glass, 0, 2.62, 0.708);
    const streak = this.addPlane(0.38, 1.88, glass, 0.5, 2.62, 0.711);
    streak.rotation.z = 0.45;

    const rows = [3.1, 2.64, 2.18];
    const priceTexture = this.canvasTexture(512, 44, (context, width, height) => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      const prices = ['¥120', '¥130', '¥110', '¥120', '¥150'];
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#16407c';
      context.font = 'bold 21px monospace';
      prices.forEach((price, index) => context.fillText(price, index * (width / 5) + width / 10, height / 2));
    });
    const priceMaterial = this.basicMaterial({ color: '#ffffff', ...(priceTexture ? { map: priceTexture } : {}) });

    for (let row = 0; row < 3; row += 1) {
      const y = rows[row]!;
      this.addBox(1.94, 0.035, 0.16, metal, 0, y - 0.17, 0.6);
      this.addPlane(1.94, 0.075, priceMaterial, 0, y - 0.185, 0.685);
      for (let column = 0; column < 5; column += 1) {
        const index = row * 5 + column;
        const x = -0.8 + column * 0.4;
        const back = this.standardMaterial({ color: DARK_PANEL, emissive: '#000000', roughness: 0.66 });
        this.slotBackMaterials.push(back);
        this.addPlane(0.33, 0.42, back, x, y + 0.02, 0.58);

        const baseColor = new THREE.Color(CAN_COLORS[index]!);
        const canMaterial = this.standardMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 0 });
        this.canMaterials.push(canMaterial);
        this.canBaseColors.push(baseColor);
        const can = this.mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.27, 20), canMaterial);
        can.position.set(x, y, 0.64);
        this.cabinet.add(can);
        const cap = this.mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.028, 20), metal);
        cap.position.set(x, y + 0.148, 0.64);
        this.cabinet.add(cap);

        const labelMaterial = this.standardMaterial({
          color: index % 2 === 0 ? '#f5f8fb' : '#182534',
          emissive: baseColor,
          emissiveIntensity: 0,
          roughness: 0.48,
        });
        const label = this.addPlane(0.105, 0.12, labelMaterial, x, y, 0.727);
        label.renderOrder = 2;
      }
    }

    this.addBox(2.3, 0.045, 0.02, metal, 0, 1.79, 0.578);
    for (let column = 0; column < 5; column += 1) {
      const material = this.standardMaterial({ color: DARK_PANEL, emissive: '#ffe9c4', emissiveIntensity: 0 });
      this.buttonMaterials.push(material);
      const button = this.mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 20), material);
      button.rotation.x = Math.PI / 2;
      button.position.set(-0.8 + column * 0.4, 1.685, 0.6);
      this.cabinet.add(button);
    }

    this.addBox(0.58, 0.26, 0.02, dark, 0.62, 1.34, 0.572);
    const display = this.makeDisplaySurface();
    this.displayCanvas = display.canvas;
    this.displayContext = display.context;
    this.displayMaterial = this.basicMaterial({ color: '#63ff9d', ...(display.texture ? { map: display.texture } : {}) });
    this.addPlane(0.52, 0.2, this.displayMaterial, 0.62, 1.34, 0.585);
    this.addBox(0.2, 0.34, 0.015, metal, 0.62, 0.99, 0.574);
    this.addBox(0.028, 0.13, 0.03, this.basicMaterial({ color: '#050608' }), 0.62, 1.03, 0.592);
    const knob = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 18), dark);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.92, 0.99, 0.595);
    this.cabinet.add(knob);

    const brandTexture = this.canvasTexture(512, 192, (context, width, height) => {
      context.fillStyle = '#eef0f4';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#7d8794';
      context.font = 'bold 36px sans-serif';
      context.fillText('MELODY VEND', 26, 66);
      context.fillStyle = '#9aa4af';
      context.font = '20px monospace';
      context.fillText('terminus mm-08 · est.2086', 26, 111);
    });
    this.addPlane(1.05, 0.4, this.basicMaterial({ color: '#eef0f4', ...(brandTexture ? { map: brandTexture } : {}) }), -0.5, 1.28, 0.578);
    this.addBox(1.4, 0.5, 0.03, dark, 0, 0.62, 0.575);
    this.addPlane(1.16, 0.34, this.basicMaterial({ color: '#2a2e36' }), 0, 0.62, 0.595);

    const pushTexture = this.canvasTexture(256, 64, (context, width, height) => {
      context.fillStyle = '#2a2e36';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#c9ced6';
      context.font = 'bold 30px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('P U S H', width / 2, height / 2);
    });
    this.addPlane(0.5, 0.125, this.basicMaterial({ color: '#2a2e36', ...(pushTexture ? { map: pushTexture } : {}) }), 0, 0.62, 0.608);

    const signTexture = this.canvasTexture(512, 128, (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#e8edf4');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#c9cfd8';
      context.lineWidth = 4;
      context.strokeRect(2, 2, width - 4, height - 4);
      context.fillStyle = '#1450a0';
      context.font = '900 62px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('D R I N K', width / 2, height * 0.42);
      context.fillStyle = '#d0342c';
      context.font = 'bold 21px sans-serif';
      context.fillText('●  つ め た 〜 い  ·  C O L D  ●', width / 2, height * 0.8);
    });
    this.signMaterial = this.standardMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: 0.2,
      roughness: 0.5,
      ...(signTexture ? { map: signTexture, emissiveMap: signTexture } : {}),
    });
    this.addPlane(2.14, 0.4, this.signMaterial, 0, 3.62, 0.578);

    const shadowMaterial = this.basicMaterial({ color: '#64686d', transparent: true, opacity: 0.18, depthWrite: false });
    const shadow = this.mesh(new THREE.CircleGeometry(1.9, 48), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1, 0.7, 1);
    shadow.position.y = 0.012;
    shadow.receiveShadow = false;
    this.root.add(shadow);

    const coinMaterial = this.standardMaterial({ color: '#d9b24a', metalness: 0.85, roughness: 0.34 });
    this.coin = this.mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.022, 24), coinMaterial);
    this.coin.rotation.x = Math.PI / 2;
    this.coin.visible = false;
    this.root.add(this.coin);

    this.performanceLight = new THREE.PointLight('#9fdfff', 0.35, 7, 2);
    this.performanceLight.position.set(0, 2.5, 1.25);
    this.cabinet.add(this.performanceLight);
    this.drawDisplay('- - -');
  }

  public start(simulationTime: number): void {
    if (this.disposed) return;
    this.startedAt = Number.isFinite(simulationTime) ? simulationTime : 0;
    this.update(simulationTime);
  }

  public stop(): void {
    this.startedAt = null;
    if (!this.disposed) this.update(0);
  }

  public setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
  }

  public snapshot(simulationTime: number): VendingPlaybackSnapshot {
    return vendingPlaybackSnapshot(this.startedAt, simulationTime, this.reducedMotion);
  }

  public update(simulationTime: number): void {
    if (this.disposed) return;
    const state = this.snapshot(simulationTime);
    this.cabinet.position.set(state.cabinetOffset.x, state.cabinetOffset.y, 0);
    this.performanceLight.intensity = state.lightIntensity;
    this.signMaterial.emissiveIntensity = 0.18 + state.signIntensity * 0.72;

    const sectionColor = state.bar !== null && state.bar >= 12
      ? PINK_FLASH
      : state.bar !== null && state.bar >= 8
        ? BLUE_FLASH
        : WARM_FLASH;
    this.slotBackMaterials.forEach((material, index) => {
      const intensity = state.slotIntensities[index] ?? 0;
      material.color.copy(DARK_PANEL).lerp(sectionColor, intensity * 0.72);
      material.emissive.copy(sectionColor);
      material.emissiveIntensity = intensity * 0.38;
      const canMaterial = this.canMaterials[index];
      if (canMaterial) {
        canMaterial.emissive.copy(this.canBaseColors[index]!);
        canMaterial.emissiveIntensity = intensity * 0.72;
      }
    });
    this.buttonMaterials.forEach((material, index) => {
      const intensity = state.buttonIntensities[index] ?? 0;
      material.color.copy(DARK_PANEL).lerp(WARM_FLASH, intensity);
      material.emissiveIntensity = intensity * 0.8;
    });

    if (state.displayText !== this.lastDisplayText) this.drawDisplay(state.displayText);
    this.coin.visible = state.coinVisible;
    if (state.coinVisible) {
      const t = state.coinProgress;
      const inverse = 1 - t;
      const start = new THREE.Vector3(0.1, 1.55, 2.2);
      const control = new THREE.Vector3(0.95, 1.9, 1.25);
      const target = new THREE.Vector3(0.62, 1.03, 0.66);
      this.coin.position.set(
        inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * target.x,
        inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * target.y,
        inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * target.z,
      );
      this.coin.rotation.z = t * Math.PI * 7;
      this.coin.rotation.y = t * Math.PI * 3;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.root.clear();
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.add(geometry);
    this.materials.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private addBox(
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = this.mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    this.cabinet.add(mesh);
    return mesh;
  }

  private addPlane(
    width: number,
    height: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = this.mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z);
    this.cabinet.add(mesh);
    return mesh;
  }

  private standardMaterial(parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters);
    this.materials.add(material);
    return material;
  }

  private basicMaterial(parameters: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial(parameters);
    this.materials.add(material);
    return material;
  }

  private canvasTexture(width: number, height: number, draw: CanvasDraw): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    draw(context, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.add(texture);
    return texture;
  }

  private makeDisplaySurface(): {
    canvas: HTMLCanvasElement | null;
    context: CanvasRenderingContext2D | null;
    texture: THREE.CanvasTexture | null;
  } {
    if (typeof document === 'undefined') return { canvas: null, context: null, texture: null };
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) return { canvas: null, context: null, texture: null };
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.add(texture);
    return { canvas, context, texture };
  }

  private drawDisplay(text: string): void {
    this.lastDisplayText = text;
    if (!this.displayCanvas || !this.displayContext) return;
    const context = this.displayContext;
    context.shadowBlur = 0;
    context.fillStyle = '#03130a';
    context.fillRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
    context.shadowColor = '#46ff8f';
    context.shadowBlur = 14;
    context.fillStyle = '#63ff9d';
    const fontSize = text.length <= 4 ? 46 : text.length <= 6 ? 34 : 24;
    context.font = `bold ${fontSize}px "Courier New", monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 51);
    const texture = this.displayMaterial?.map;
    if (texture) texture.needsUpdate = true;
  }
}

export class VendingMachineSynth {
  private context: AudioContext | null = null;
  private trackGain: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private generation = 0;
  private isActive = false;

  public get active(): boolean {
    return this.isActive;
  }

  public start(context: AudioContext, destination: AudioNode): void {
    this.stop();
    this.context = context;
    this.isActive = true;
    const generation = ++this.generation;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);

    const trackGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 5;
    trackGain.gain.value = 0.62;
    trackGain.connect(compressor);
    compressor.connect(destination);
    this.trackGain = trackGain;

    const now = context.currentTime + 0.025;
    this.scheduleClick(now, 2793, 0.72);
    this.scheduleClick(now + 0.03, 2093, 0.54);
    this.scheduleClick(now + 0.08, 5200, 0.16);
    const songStart = now + VENDING_TRACK.coinSeconds;

    for (let step = 0; step < VENDING_TRACK.bars * VENDING_TRACK.stepsPerBar; step += 1) {
      const time = songStart + step * VENDING_TRACK.sixteenthSeconds;
      const bar = Math.floor(step / 16);
      const stepInBar = step % 16;
      if (stepInBar === 0) {
        this.scheduleSub(time, bar < 4 ? 55 : bar < 12 ? 55 : 41.2, VENDING_TRACK.sixteenthSeconds * 8);
      }
      if (bar < 4) {
        if ([0, 3, 6, 10, 14].includes(stepInBar)) this.scheduleClick(time, 1800 + ((step * 719) % 2600), 0.2);
      } else if (bar < 8) {
        if (stepInBar % 4 === 0) this.scheduleKick(time, 0.62);
        if (stepInBar % 4 === 2) this.scheduleHat(time, 0.18);
      } else if (bar < 12) {
        if (stepInBar % 4 === 0) this.scheduleKick(time, 0.5);
        if (stepInBar % 4 === 2) this.scheduleHat(time, 0.14);
        if (stepInBar % 4 === 0 || stepInBar === 6 || stepInBar === 14) {
          const scaleIndex = (bar * 3 + Math.floor(stepInBar / 2)) % MELODY_SCALE.length;
          this.scheduleVoice(time, MELODY_SCALE[scaleIndex]!, VENDING_TRACK.sixteenthSeconds * 2.4, 0.38);
        }
      } else if (bar < 16) {
        if (stepInBar % 4 === 0) this.scheduleKick(time, 0.66);
        if (stepInBar % 2 === 1) this.scheduleHat(time, 0.13);
        if (stepInBar % 4 === 0) {
          const scaleIndex = (bar + stepInBar) % MELODY_SCALE.length;
          this.scheduleVoice(time, MELODY_SCALE[scaleIndex]!, VENDING_TRACK.sixteenthSeconds * 1.6, 0.24);
        }
      } else if (bar === 16 && stepInBar === 0) {
        this.scheduleGlide(time, 880, 440, VENDING_TRACK.sixteenthSeconds * 14, 0.38);
      } else if (bar === 17 && [0, 6, 12].includes(stepInBar)) {
        this.scheduleClick(time, stepInBar === 12 ? 1318.5 : 2400, 0.26);
      }
    }

    const endTime = songStart + VENDING_TRACK.musicSeconds;
    trackGain.gain.setValueAtTime(0.62, Math.max(now, endTime - 1.2));
    trackGain.gain.exponentialRampToValueAtTime(0.0001, endTime + 0.45);
    const endMarker = this.scheduleClick(endTime + 0.44, 880, 0.0002);
    endMarker.onended = () => {
      if (this.generation !== generation) return;
      this.isActive = false;
      this.sources = [];
      this.trackGain?.disconnect();
      this.trackGain = null;
      this.context = null;
    };
  }

  public stop(): void {
    this.generation += 1;
    const now = this.context?.currentTime ?? 0;
    if (this.trackGain && this.context) {
      try {
        this.trackGain.gain.cancelScheduledValues(now);
        this.trackGain.gain.setValueAtTime(Math.max(0.0001, this.trackGain.gain.value), now);
        this.trackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
      } catch {
        // A partially constructed AudioContext must never block level entry.
      }
    }
    this.sources.forEach((source) => {
      try { source.stop(now + 0.03); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    });
    try { this.trackGain?.disconnect(); } catch { /* already disconnected */ }
    this.sources = [];
    this.trackGain = null;
    this.context = null;
    this.isActive = false;
  }

  private envelope(time: number, attack: number, decay: number, peak: number): GainNode {
    const context = this.context!;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    gain.connect(this.trackGain!);
    return gain;
  }

  private register<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.push(source);
    return source;
  }

  private scheduleKick(time: number, volume: number): OscillatorNode {
    const oscillator = this.register(this.context!.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    oscillator.connect(this.envelope(time, 0.002, 0.24, 0.72 * volume));
    oscillator.start(time);
    oscillator.stop(time + 0.32);
    return oscillator;
  }

  private scheduleClick(time: number, frequency: number, volume: number): OscillatorNode {
    const oscillator = this.register(this.context!.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(this.envelope(time, 0.0008, 0.035, 0.42 * volume));
    oscillator.start(time);
    oscillator.stop(time + 0.055);
    return oscillator;
  }

  private scheduleHat(time: number, volume: number): AudioBufferSourceNode {
    const context = this.context!;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.08), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = Math.max(1, Math.floor(time * 10_000));
    for (let index = 0; index < data.length; index += 1) {
      seed = (seed * 16807) % 2147483647;
      data[index] = (seed / 2147483647) * 2 - 1;
    }
    const source = this.register(context.createBufferSource());
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 9000;
    filter.Q.value = 1.2;
    source.connect(filter);
    filter.connect(this.envelope(time, 0.0008, 0.04, volume));
    source.start(time);
    source.stop(time + 0.06);
    return source;
  }

  private scheduleSub(time: number, frequency: number, length: number): OscillatorNode {
    const oscillator = this.register(this.context!.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(this.envelope(time, 0.012, length, 0.22));
    oscillator.start(time);
    oscillator.stop(time + length + 0.15);
    return oscillator;
  }

  private scheduleVoice(time: number, frequency: number, length: number, volume: number): OscillatorNode {
    const context = this.context!;
    const oscillator = this.register(context.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    oscillator.connect(filter);
    filter.connect(this.envelope(time, 0.025, length, volume));
    oscillator.start(time);
    oscillator.stop(time + length + 0.2);
    return oscillator;
  }

  private scheduleGlide(time: number, from: number, to: number, length: number, volume: number): OscillatorNode {
    const oscillator = this.register(this.context!.createOscillator());
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.linearRampToValueAtTime(to, time + length * 0.8);
    oscillator.connect(this.envelope(time, 0.05, length, volume));
    oscillator.start(time);
    oscillator.stop(time + length + 0.2);
    return oscillator;
  }
}
