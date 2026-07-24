import * as THREE from 'three';
import type { AccountPlayerProfile, AccountTextState } from './account-controller';
import { AVATAR_PRESETS, avatarPresetById, DEFAULT_AVATAR_ID, isBuiltInAvatarId } from './avatar-presets';
import {
  avatarNameFromFileName,
  AvatarUploadError,
  listAccountAvatars,
  uploadAccountAvatar,
  validateAvatarUploadFile,
  type AccountAvatarRecord,
  type AvatarUploadPhase,
} from './avatar-upload';
import { CREATIVE_CAMERA_CONTROLS, LobbyCreativeCamera, shouldHandleCreativeCameraKey } from './creative-camera';
import {
  cameraRelativeMovement,
  chooseLevel,
  clamp,
  difficultyStars,
  formatTime,
  movementFacingYaw,
  resolveAvatarAnimationMode,
  resolveHubInfiniteGround,
} from './game-utils';
import {
  LobbyEditor,
  type LobbyLocalPropInteractionUse,
  type LobbyPropInteractionUse,
  type LobbyPortalUse,
  type LobbyVehicleHandle,
  type LobbyVehicleRuntimePose,
} from './lobby-editor';
import { lobbyPropPlayerColliderBoxes } from './lobby-props/player-colliders';
import { LobbyPropPreviewGallery, type LobbyPropPreviewRegistration } from './lobby-prop-preview';
import {
  lobbyChannelFromSearch,
  normalizePublicLobbyChannel,
  persistentSpaceChannel,
  type PersistentSpaceChannel,
  type PersistentSpaceId,
  withLobbyChannel,
} from './lobby-channel';
import { LOBBY_WORLD_LIMIT } from './lobby-neighborhood';
import {
  interpolateYaw,
  LobbyMultiplayer,
  lobbyPlayerEyePosition,
  normalizeAvatarId,
  normalizeThirdPersonCameraDistance,
  sanitizeNickname,
  THIRD_PERSON_AVATAR_CENTER_HEIGHT,
  THIRD_PERSON_CAMERA_DISTANCE,
  THIRD_PERSON_MAX_CAMERA_DISTANCE,
  THIRD_PERSON_MIN_CAMERA_DISTANCE,
  thirdPersonCameraTarget,
  vehicleErrorRequiresRecovery,
  resolveThirdPersonCameraPosition,
  resolveLobbyVehicleThirdPersonCameraDistance,
  type LobbyVehicleEvent,
  type LobbyVehicleRecoveryReason,
  type LobbyVehicleReleaseReason,
  type LobbyVehicleSnapshot,
  type LobbyPartyInvite,
  type LobbyPartyLaunch,
  type LobbyPartyState,
} from './lobby-multiplayer';
import {
  beginLobbyVehicleEnter,
  beginLobbyVehicleExit,
  createLobbyVehicleState,
  lobbyRotorcraftAutolandInput,
  lobbyRotorcraftReleaseRequiresAutoland,
  lobbyRotorcraftYawInput,
  lobbyVehicleVisualState,
  LobbyVehicleSimulation,
  resolveLobbyVehicleExit,
  resolveLobbyRotorcraftLandingTarget,
  type LobbyVehicleEnvironment,
  type LobbyVehicleInput,
  type LobbyRotorcraftLandingTarget,
  type LobbyVehicleState as LobbyVehiclePhysicsState,
} from './lobby-vehicle';
import { LEVELS } from './levels';
import { InfernalPianoAudio } from './infernal-piano-audio';
import {
  createPersistentPortalSpace,
  isPersistentPortalSpaceId,
  type PersistentPortalSpaceScene,
} from './portal-realms';
import { MusicVendingMachine, VendingMachineSynth } from './vending-machine';
import {
  createUGCLevelSdk,
  manifestToLevel,
  parseApprovedRegistry,
  registryEntryToLevel,
  reviewLevelBasePath,
  validateLevelManifest,
  type UGCLevelHandle,
  type UGCLevelHost,
  type UGCRuntime,
} from './ugc-runtime';
import type {
  Collider,
  Collectible,
  GameTextState,
  GoalZone,
  Interactable,
  LevelDefinition,
  SaveData,
  Settings,
  ShellState,
} from './types';

const FIXED_STEP = 1 / 60;
const SAVE_KEY = 'wr.save.v1';
const PLAYER_RADIUS = 0.35;
const PLAYER_HEIGHT = 1.7;
const EYE_HEIGHT = 1.62;
const VEHICLE_STATE_INTERVAL = 0.1;

type VehicleSafeExitMode = 'none' | 'autoland' | 'awaiting-recovery' | 'server-autoland' | 'released-autoland' | 'awaiting-release';

interface ActiveLobbyVehicle {
  handle: LobbyVehicleHandle;
  simulation: LobbyVehicleSimulation;
  leaseId: string;
  networkSeq: number;
  lastStateSentAt: number;
  releaseSent: boolean;
  safeExitMode: VehicleSafeExitMode;
  recoveryReason: LobbyVehicleRecoveryReason | null;
  autolandTarget: LobbyRotorcraftLandingTarget | null;
  autolandStartedAt: number;
  autolandFallback: boolean;
}

interface UiElements {
  boot: HTMLElement;
  lobbyChannelForm: HTMLFormElement;
  lobbyChannelInput: HTMLInputElement;
  lobbyChannelStatus: HTMLElement;
  startButton: HTMLButtonElement;
  hud: HTMLElement;
  objectiveCard: HTMLElement;
  objectiveText: HTMLElement;
  progressText: HTMLElement;
  timerCard: HTMLElement;
  timerText: HTMLElement;
  prompt: HTMLElement;
  crosshair: HTMLElement;
  toast: HTMLElement;
  saveIndicator: HTMLElement;
  resetMeter: HTMLElement;
  resetFill: HTMLElement;
  terminal: HTMLElement;
  indexedCount: HTMLElement;
  worldName: HTMLElement;
  worldMeta: HTMLElement;
  worldDescription: HTMLElement;
  worldSwatch: HTMLElement;
  worldGlyph: HTMLElement;
  partyDive: HTMLButtonElement;
  partyPanel: HTMLElement;
  partyKicker: HTMLElement;
  partyTitle: HTMLElement;
  partyDetail: HTMLElement;
  partyMembers: HTMLElement;
  partyAccept: HTMLButtonElement;
  partyDecline: HTMLButtonElement;
  partyCancel: HTMLButtonElement;
  intro: HTMLElement;
  introType: HTMLElement;
  introName: HTMLElement;
  introObjective: HTMLElement;
  door: HTMLElement;
  resultName: HTMLElement;
  resultAuthor: HTMLElement;
  resultTime: HTMLElement;
  resultProgress: HTMLElement;
  pause: HTMLElement;
  pauseCard: HTMLElement;
  settingsPanel: HTMLElement;
  fade: HTMLElement;
  clickHint: HTMLElement;
  creativeCameraHelp: HTMLElement;
  avatarWardrobeEntry: HTMLButtonElement;
  avatarWardrobeDialog: HTMLDialogElement;
  avatarWardrobeClose: HTMLButtonElement;
  avatarWardrobeCurrent: HTMLElement;
  avatarWardrobeShell: HTMLElement;
  settingsAvatarOpen: HTMLButtonElement;
  settingsAvatarCurrent: HTMLElement;
  sensitivityInput: HTMLInputElement;
  sensitivityValue: HTMLOutputElement;
  fovInput: HTMLInputElement;
  fovValue: HTMLOutputElement;
  volumeInput: HTMLInputElement;
  volumeValue: HTMLOutputElement;
  headbobInput: HTMLInputElement;
  motionInput: HTMLInputElement;
  nicknameInput: HTMLInputElement;
  avatarInput: HTMLInputElement;
  avatarPresetList: HTMLElement;
  avatarAccountLibrary: HTMLElement;
  avatarAccountList: HTMLElement;
  avatarUploadPanel: HTMLElement;
  avatarUploadInput: HTMLInputElement;
  avatarUploadNameInput: HTMLInputElement;
  avatarUploadFileLabel: HTMLElement;
  avatarUploadSubmit: HTMLButtonElement;
  avatarUploadLogin: HTMLButtonElement;
  avatarUploadStatus: HTMLElement;
  avatarUploadLocalPreview: HTMLElement;
  profileApplyButton: HTMLButtonElement;
  profileStatus: HTMLElement;
}

interface TransitionTarget {
  kind: 'hub' | 'level' | 'persistent-space';
  levelId?: string;
  spaceId?: PersistentSpaceId;
  spaceLabel?: string;
  stateChannel?: PersistentSpaceChannel;
  reset?: boolean;
  readyAt: number;
}

interface ActivePersistentSpace {
  id: PersistentSpaceId;
  label: string;
  stateChannel: PersistentSpaceChannel;
  returnChannel: string;
}

const TRUMP_TOWER_RESIDENCES = [
  { label: '35F 高级公寓', localPosition: [0, 0.02, 0.18] as const },
  { label: '52F 高级公寓', localPosition: [0, 2.72, 0.65] as const },
  { label: 'PH 顶层公寓', localPosition: [0, 5.32, 0.65] as const },
  { label: 'Lobby 大堂', localPosition: [0, 0.02, 1.5] as const },
] as const;

export function trumpTowerResidenceForSequence(sequence: number): (typeof TRUMP_TOWER_RESIDENCES)[number] | null {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return null;
  return TRUMP_TOWER_RESIDENCES[(sequence - 1) % TRUMP_TOWER_RESIDENCES.length]!;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}

export function quitWhiteRoomGame(actions: {
  exitPointerLock(): void;
  reload(): void;
}): void {
  try {
    actions.exitPointerLock();
  } finally {
    actions.reload();
  }
}

interface AccountProfileStore {
  getPlayerProfile(): AccountPlayerProfile | null;
  savePlayerProfile(nickname: string, avatarId: string): Promise<void>;
  getTextState?(): AccountTextState;
}

export class WhiteRoomGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly accountProfileStore: AccountProfileStore | null;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
  private readonly ui: UiElements;
  private readonly lobbyEditor: LobbyEditor;
  private readonly lobbyMultiplayer: LobbyMultiplayer;
  private readonly avatarPreviews: LobbyPropPreviewGallery;
  private readonly creativeCamera = new LobbyCreativeCamera();
  private readonly lobbyColliders = new Map<string, Collider[]>();

  private state: ShellState = 'BOOT';
  private pausedFrom: ShellState | null = null;
  private save: SaveData;
  private lobbyChannel: string | null = null;
  private joiningLobby = false;
  private lobbyChannelPhase: 'required' | 'joining' | 'ready' | 'error' = 'required';
  private selectedLevel: LevelDefinition;
  private currentLevel: LevelDefinition | null = null;
  private activePersistentSpace: ActivePersistentSpace | null = null;
  private persistentPortalScene: PersistentPortalSpaceScene | null = null;
  private persistentSpaceReturnPosition: THREE.Vector3 | null = null;
  private infernalPianoAudio: InfernalPianoAudio | null = null;
  private infernalPianoInteractionSequence = 0;
  private transition: TransitionTarget | null = null;
  private levelPool: LevelDefinition[] = [...LEVELS];
  private readonly failedDynamicLevels = new Set<string>();
  private registryLoaded = false;
  private registryError: string | null = null;
  private dynamicRuntime: UGCRuntime | null = null;
  private dynamicHandle: UGCLevelHandle | null = null;
  private dynamicTargetsTotal = 0;
  private dynamicTargetsDown = 0;
  private dynamicObjective: string | null = null;
  private dynamicProgress: string | null = null;
  private surviveElapsed = 0;
  private loadingDynamicLevel = false;
  private dynamicPendingWin = false;
  private dynamicPendingFail: { reason: string; reset: boolean } | null = null;
  private readonly reviewLevelId = (() => {
    const value = new URLSearchParams(window.location.search).get('reviewLevel');
    return value && /^[a-z0-9][a-z0-9-]{1,79}$/.test(value) ? value : null;
  })();
  private readonly devLevelId = (() => {
    const value = new URLSearchParams(window.location.search).get('devLevel');
    return value && /^[a-z0-9][a-z0-9-]{1,79}$/.test(value) ? value : null;
  })();

  private worldRoot: THREE.Group | null = null;
  private vendingMachine: MusicVendingMachine | null = null;
  private readonly vendingMachineSynth = new VendingMachineSynth();
  private readonly terminalPosition = new THREE.Vector3(0, 1.65, -6.72);

  private readonly playerPosition = new THREE.Vector3(0, 0.02, 4);
  private readonly playerVelocity = new THREE.Vector3();
  private readonly checkpoint = new THREE.Vector3(0, 0.02, 4);
  private yaw = 0;
  private pitch = 0;
  private playerFacingYaw = 0;
  private movementInputActive = false;
  private readonly creativePlayerAnchor = new THREE.Vector3();
  private creativePlayerYawAnchor = 0;
  private creativePlayerPitchAnchor = 0;
  private creativeReturnView: 'first' | 'third' = 'first';
  private creativeLookPointerId: number | null = null;
  private grounded = false;
  private coyoteTime = 0;
  private jumpBuffer = 0;
  private bobTime = 0;

  private readonly keys = new Set<string>();
  private readonly colliders: Collider[] = [];
  private readonly collectibles: Collectible[] = [];
  private readonly interactables: Interactable[] = [];
  private goalZone: GoalZone | null = null;
  private interactionTarget: Interactable | 'terminal' | 'gate' | 'persistent-space-return' | null = null;

  private levelElapsed = 0;
  private levelDeaths = 0;
  private collectedCount = 0;
  private readonly puzzleFlags = new Set<string>();
  private puzzleExpectedIndex = 0;
  private readonly puzzleHeads: THREE.Mesh[] = [];
  private checkpointReached = false;
  private resetHold = 0;

  private gateGroup: THREE.Group | null = null;
  private gatePosition: THREE.Vector3 | null = null;
  private gateSpawnTime = 0;
  private doorAvailable = false;
  private completionRecorded = false;

  private simulationTime = 0;
  private introEndsAt = 0;
  private failEndsAt = 0;
  private failNeedsReset = false;
  private toastEndsAt = 0;
  private fadeEndsAt = 0;
  private accumulator = 0;
  private previousFrameTime = 0;
  private frameRequest = 0;
  private manualClock = false;

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private wardrobeReturnPointerLock = false;
  private wardrobeOpener: HTMLElement | null = null;
  private profileApplyRequest = 0;
  private profileApplyController: AbortController | null = null;
  private profileApplying = false;
  private accountAvatars: AccountAvatarRecord[] = [];
  private avatarListRequest = 0;
  private avatarUploadFile: File | null = null;
  private avatarUploadObjectUrl: string | null = null;
  private avatarUploadController: AbortController | null = null;
  private avatarUploadPhase: AvatarUploadPhase = 'idle';
  private avatarUploadErrorCode: string | null = null;
  private uploadedAvatarId: string | null = null;
  private cameraZoomPersistTimer = 0;
  private partyInvite: LobbyPartyInvite | null = null;
  private partyState: LobbyPartyState | null = null;
  private activeVehicle: ActiveLobbyVehicle | null = null;
  private pendingVehicleObjectId: string | null = null;
  private readonly vehicleSnapshots = new Map<string, LobbyVehicleSnapshot>();
  private readonly pendingVehicleSnapshotIds = new Set<string>();

  public constructor(canvas: HTMLCanvasElement, accountProfileStore: AccountProfileStore | null = null) {
    this.canvas = canvas;
    this.accountProfileStore = accountProfileStore;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.ui = this.collectUi();
    this.avatarPreviews = new LobbyPropPreviewGallery(this.ui.avatarWardrobeShell, {
      canvasParent: this.ui.avatarWardrobeDialog,
      canvasClassName: 'lobby-prop-preview-layer avatar-preview-layer',
      releaseOnDeactivate: true,
      allowBlobUrls: true,
    });
    this.ui.lobbyChannelInput.value = lobbyChannelFromSearch(window.location.search);
    this.save = this.loadSave();
    const accountProfile = this.accountProfileStore?.getPlayerProfile();
    if (accountProfile) {
      this.save.settings.nickname = sanitizeNickname(accountProfile.gameNickname, '访客');
      this.save.settings.avatarId = normalizeAvatarId(accountProfile.avatarId) || DEFAULT_AVATAR_ID;
    }
    this.selectedLevel = chooseLevel(this.levelPool, this.save.recent);
    this.lobbyEditor = new LobbyEditor({
      canvas: this.canvas,
      camera: this.camera,
      onExit: () => this.exitLobbyEditor(),
      onColliderChanged: (id, object, collidable) => this.updateLobbyCollider(id, object, collidable),
      onToast: (text, durationMs) => this.showToast(text, durationMs),
      getNickname: () => this.save.settings.nickname,
      onPortalUse: (portal) => this.useLobbyPortal(portal),
      onPropInteraction: (interaction) => this.handleLobbyPropInteraction(interaction),
      onLocalPropInteraction: (interaction) => this.handleLocalLobbyPropInteraction(interaction),
      isAccountSignedIn: () => this.accountTextState()?.mode === 'email',
      onAccountRequired: () => document.getElementById('account-login-open-btn')?.click(),
      onVehicleUse: (vehicle) => this.requestVehicleEnter(vehicle),
    });
    this.lobbyMultiplayer = new LobbyMultiplayer({
      profile: { name: this.save.settings.nickname, avatarId: this.save.settings.avatarId },
      view: this.save.settings.lobbyView,
      cameraDistance: this.save.settings.thirdPersonCameraDistance,
      reducedMotion: this.save.settings.reducedMotion,
      lobbyChannel: this.ui.lobbyChannelInput.value,
      onViewChanged: (view) => {
        this.save.settings.lobbyView = view;
        this.persistSave();
        this.showToast(view === 'third' ? '第三人称 · 滚轮缩放' : '已切换到第一人称', 1200);
      },
      onPartyInvite: (invite) => this.handlePartyInvite(invite),
      onPartyState: (party) => this.handlePartyState(party),
      onPartyLaunch: (launch) => this.handlePartyLaunch(launch),
      onPartyNotice: (code) => this.handlePartyNotice(code),
      onVehicleEvent: (event) => this.handleVehicleEvent(event),
    });
    this.bindUi();
    this.bindInput();
    this.renderAccountAvatarCards();
    this.updateAvatarPreviewItems();
    this.applySettingsToUi();
    this.updateAvatarUploadUi();
    this.buildHubScene();
    this.resize();
    void this.loadRegistry();
    void this.applyAvatarFromUrl();
  }

  public start(): void {
    if (this.frameRequest) return;
    this.previousFrameTime = performance.now();
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  public advanceTime(ms: number): void {
    if (!this.manualClock) {
      this.manualClock = true;
      if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
      this.accumulator = 0;
    }
    const steps = Math.max(1, Math.round(Math.max(0, ms) / (FIXED_STEP * 1000)));
    for (let index = 0; index < steps; index += 1) this.update(FIXED_STEP);
    this.render();
  }

  public renderGameToText(): string {
    const payload = this.createTextState();
    return JSON.stringify(payload);
  }

  private readonly frame = (time: number): void => {
    const delta = Math.min(0.1, Math.max(0, (time - this.previousFrameTime) / 1000));
    this.previousFrameTime = time;
    this.accumulator += delta;
    while (this.accumulator >= FIXED_STEP) {
      this.update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.render();
    if (!this.manualClock) this.frameRequest = requestAnimationFrame(this.frame);
    else this.frameRequest = 0;
  };

  private collectUi(): UiElements {
    return {
      boot: byId('boot-overlay'),
      lobbyChannelForm: byId<HTMLFormElement>('lobby-channel-form'),
      lobbyChannelInput: byId<HTMLInputElement>('lobby-channel-input'),
      lobbyChannelStatus: byId('lobby-channel-status'),
      startButton: byId<HTMLButtonElement>('start-btn'),
      hud: byId('hud'),
      objectiveCard: byId('objective-card'),
      objectiveText: byId('objective-text'),
      progressText: byId('progress-text'),
      timerCard: byId('timer-card'),
      timerText: byId('timer-text'),
      prompt: byId('interaction-prompt'),
      crosshair: byId('crosshair'),
      toast: byId('toast'),
      saveIndicator: byId('save-indicator'),
      resetMeter: byId('reset-meter'),
      resetFill: byId('reset-meter').querySelector<HTMLElement>('span')!,
      terminal: byId('terminal-overlay'),
      indexedCount: byId('indexed-count'),
      worldName: byId('world-name'),
      worldMeta: byId('world-meta'),
      worldDescription: byId('world-description'),
      worldSwatch: byId('world-swatch'),
      worldGlyph: byId('world-glyph'),
      partyDive: byId<HTMLButtonElement>('party-dive-btn'),
      partyPanel: byId('party-panel'),
      partyKicker: byId('party-kicker'),
      partyTitle: byId('party-title'),
      partyDetail: byId('party-detail'),
      partyMembers: byId('party-members'),
      partyAccept: byId<HTMLButtonElement>('party-accept-btn'),
      partyDecline: byId<HTMLButtonElement>('party-decline-btn'),
      partyCancel: byId<HTMLButtonElement>('party-cancel-btn'),
      intro: byId('intro-overlay'),
      introType: byId('intro-type'),
      introName: byId('intro-name'),
      introObjective: byId('intro-objective'),
      door: byId('door-overlay'),
      resultName: byId('result-name'),
      resultAuthor: byId('result-author'),
      resultTime: byId('result-time'),
      resultProgress: byId('result-progress'),
      pause: byId('pause-overlay'),
      pauseCard: document.querySelector<HTMLElement>('.pause-card')!,
      settingsPanel: byId('settings-panel'),
      fade: byId('screen-fade'),
      clickHint: byId('first-click-hint'),
      creativeCameraHelp: byId('creative-camera-help'),
      avatarWardrobeEntry: byId<HTMLButtonElement>('avatar-wardrobe-entry'),
      avatarWardrobeDialog: byId<HTMLDialogElement>('avatar-wardrobe-dialog'),
      avatarWardrobeClose: byId<HTMLButtonElement>('avatar-wardrobe-close'),
      avatarWardrobeCurrent: byId('avatar-wardrobe-current'),
      avatarWardrobeShell: byId('avatar-wardrobe-shell'),
      settingsAvatarOpen: byId<HTMLButtonElement>('settings-avatar-open'),
      settingsAvatarCurrent: byId('settings-avatar-current'),
      sensitivityInput: byId<HTMLInputElement>('sensitivity-input'),
      sensitivityValue: byId<HTMLOutputElement>('sensitivity-value'),
      fovInput: byId<HTMLInputElement>('fov-input'),
      fovValue: byId<HTMLOutputElement>('fov-value'),
      volumeInput: byId<HTMLInputElement>('volume-input'),
      volumeValue: byId<HTMLOutputElement>('volume-value'),
      headbobInput: byId<HTMLInputElement>('headbob-input'),
      motionInput: byId<HTMLInputElement>('motion-input'),
      nicknameInput: byId<HTMLInputElement>('nickname-input'),
      avatarInput: byId<HTMLInputElement>('avatar-input'),
      avatarPresetList: byId('avatar-preset-list'),
      avatarAccountLibrary: byId('avatar-account-library'),
      avatarAccountList: byId('avatar-account-list'),
      avatarUploadPanel: byId('avatar-upload-panel'),
      avatarUploadInput: byId<HTMLInputElement>('avatar-upload-input'),
      avatarUploadNameInput: byId<HTMLInputElement>('avatar-upload-name-input'),
      avatarUploadFileLabel: byId('avatar-upload-file-label'),
      avatarUploadSubmit: byId<HTMLButtonElement>('avatar-upload-submit'),
      avatarUploadLogin: byId<HTMLButtonElement>('avatar-upload-login'),
      avatarUploadStatus: byId('avatar-upload-status'),
      avatarUploadLocalPreview: byId('avatar-upload-local-preview'),
      profileApplyButton: byId<HTMLButtonElement>('profile-apply-btn'),
      profileStatus: byId('profile-status'),
    };
  }

  private bindUi(): void {
    this.ui.lobbyChannelForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.beginGame();
    });
    this.ui.startButton.addEventListener('click', () => void this.beginGame());
    this.ui.lobbyChannelInput.addEventListener('input', () => {
      const digits = this.ui.lobbyChannelInput.value.replace(/\D/g, '').slice(0, 12);
      if (digits !== this.ui.lobbyChannelInput.value) this.ui.lobbyChannelInput.value = digits;
      this.ui.lobbyChannelInput.removeAttribute('aria-invalid');
      this.lobbyChannelPhase = 'required';
      delete this.ui.lobbyChannelStatus.dataset.state;
      this.ui.lobbyChannelStatus.textContent = digits.length >= 4
        ? `将进入频道 ${digits}`
        : '4–12 位数字 · 原共享大厅保留在 0000';
    });
    byId<HTMLButtonElement>('dive-btn').addEventListener('click', () => this.diveSelectedLevel());
    this.ui.partyDive.addEventListener('click', () => this.invitePartyToSelectedLevel());
    this.ui.partyAccept.addEventListener('click', () => this.respondToPartyInvite(true));
    this.ui.partyDecline.addEventListener('click', () => this.respondToPartyInvite(false));
    this.ui.partyCancel.addEventListener('click', () => this.lobbyMultiplayer.cancelParty());
    byId<HTMLButtonElement>('reroll-btn').addEventListener('click', () => this.rerollLevel());
    byId<HTMLButtonElement>('replay-vending-music-btn').addEventListener('click', () => this.replayVendingMusic());
    byId<HTMLButtonElement>('leave-terminal-btn').addEventListener('click', () => this.closeTerminal());
    byId<HTMLButtonElement>('return-btn').addEventListener('click', () => this.transitionToHub());
    byId<HTMLButtonElement>('continue-btn').addEventListener('click', () => this.continueRoaming());
    byId<HTMLButtonElement>('close-door-btn').addEventListener('click', () => this.closeDoorChoice());
    byId<HTMLButtonElement>('resume-btn').addEventListener('click', () => this.resumeGame());
    byId<HTMLButtonElement>('reset-btn').addEventListener('click', () => this.softResetLevel());
    byId<HTMLButtonElement>('settings-btn').addEventListener('click', () => this.openSettings());
    byId<HTMLButtonElement>('quit-game-btn').addEventListener('click', () => {
      quitWhiteRoomGame({
        exitPointerLock: () => document.exitPointerLock?.(),
        reload: () => window.location.reload(),
      });
    });
    byId<HTMLButtonElement>('settings-back-btn').addEventListener('click', () => this.closeSettings());
    byId<HTMLButtonElement>('unplug-btn').addEventListener('click', () => this.transitionToHub());
    byId<HTMLButtonElement>('lobby-editor-entry').addEventListener('click', () => this.enterLobbyEditor());
    byId<HTMLButtonElement>('decorate-btn').addEventListener('click', () => this.enterLobbyEditorFromPause());
    this.ui.avatarWardrobeEntry.addEventListener('click', () => this.openAvatarWardrobe(this.ui.avatarWardrobeEntry));
    this.ui.settingsAvatarOpen.addEventListener('click', () => this.openAvatarWardrobe(this.ui.settingsAvatarOpen));
    this.ui.avatarWardrobeClose.addEventListener('click', () => this.closeAvatarWardrobe());
    this.ui.avatarWardrobeDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeAvatarWardrobe();
    });
    this.ui.profileApplyButton.addEventListener('click', () => void this.applyProfileSettings());
    const selectAvatarCard = (event: Event): void => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.avatar-preset-card') : null;
      if (!target) return;
      const avatarId = normalizeAvatarId(target.dataset.avatarId) || DEFAULT_AVATAR_ID;
      this.ui.avatarInput.value = avatarId;
      this.syncAvatarPresetSelection(avatarId);
      void this.verifyAndApplyProfile(sanitizeNickname(this.ui.nicknameInput.value), avatarId, true);
    };
    this.ui.avatarPresetList.addEventListener('click', selectAvatarCard);
    this.ui.avatarAccountList.addEventListener('click', selectAvatarCard);
    this.ui.avatarUploadInput.addEventListener('change', () => void this.selectAvatarUploadFile());
    this.ui.avatarUploadSubmit.addEventListener('click', () => void this.uploadSelectedAvatar());
    this.ui.avatarUploadLogin.addEventListener('click', () => {
      this.closeAvatarWardrobe(false);
      document.getElementById('account-login-open-btn')?.click();
    });
    const updateSettings = (): void => {
      this.save.settings.sensitivity = Number(this.ui.sensitivityInput.value);
      this.save.settings.fov = Number(this.ui.fovInput.value);
      this.save.settings.volume = Number(this.ui.volumeInput.value);
      this.save.settings.headBob = this.ui.headbobInput.checked;
      this.save.settings.reducedMotion = this.ui.motionInput.checked;
      this.applySettingsToUi();
      this.persistSave();
    };
    this.ui.sensitivityInput.addEventListener('input', updateSettings);
    this.ui.fovInput.addEventListener('input', updateSettings);
    this.ui.volumeInput.addEventListener('input', updateSettings);
    this.ui.headbobInput.addEventListener('change', updateSettings);
    this.ui.motionInput.addEventListener('change', updateSettings);
  }

  private bindInput(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.endCreativeLook();
      this.lobbyEditor.finishPointerInteraction();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.keys.clear();
      this.endCreativeLook();
      this.lobbyEditor.finishPointerInteraction();
    });
    document.addEventListener('fullscreenchange', () => this.resize());

    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.state !== 'HUB_EDIT' || event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.creativeLookPointerId = event.pointerId;
      this.creativeCamera.beginLook();
      this.canvas.classList.add('creative-looking');
      this.canvas.setPointerCapture(event.pointerId);
    });
    window.addEventListener('pointermove', (event) => {
      if (
        this.state !== 'HUB_EDIT'
        || !this.creativeCamera.enabled
        || event.pointerId !== this.creativeLookPointerId
      ) return;
      this.creativeCamera.look(event.movementX, event.movementY, this.save.settings.sensitivity);
    });
    window.addEventListener('pointerup', (event) => {
      if (event.button === 2) this.endCreativeLook(event.pointerId);
    });
    window.addEventListener('pointercancel', (event) => this.endCreativeLook(event.pointerId));
    this.canvas.addEventListener('lostpointercapture', (event) => this.endCreativeLook(event.pointerId));
    this.canvas.addEventListener('contextmenu', (event) => {
      if (this.state === 'HUB_EDIT') event.preventDefault();
    });
    this.canvas.addEventListener('wheel', (event) => {
      if (
        this.state !== 'HUB'
        || this.currentLevel
        || this.ui.avatarWardrobeDialog.open
        || this.lobbyMultiplayer.getView() !== 'third'
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || !Number.isFinite(event.deltaY)
        || event.deltaY === 0
      ) return;
      event.preventDefault();
      const nextDistance = this.lobbyMultiplayer.adjustCameraDistance(event.deltaY, event.deltaMode, window.innerHeight);
      if (nextDistance === this.save.settings.thirdPersonCameraDistance) return;
      this.save.settings.thirdPersonCameraDistance = nextDistance;
      this.scheduleCameraZoomPersist();
    }, { passive: false });
    window.addEventListener('pagehide', () => this.flushCameraZoomPersist());

    this.canvas.addEventListener('click', () => {
      if (!this.lobbyEditor.enabled && this.isWorldInteractiveState() && document.pointerLockElement !== this.canvas) {
        this.requestPointerLock();
      }
      this.ensureAudio();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.ui.clickHint.classList.toggle('hidden', locked || !this.isWorldInteractiveState());
      if (!locked && !this.ui.avatarWardrobeDialog.open && !this.lobbyEditor.enabled && this.isWorldInteractiveState() && this.state !== 'BOOT') this.openPause();
    });

    window.addEventListener('mousemove', (event) => {
      if (this.state === 'HUB_EDIT') return;
      if (document.pointerLockElement !== this.canvas || !this.isWorldInteractiveState()) return;
      const scale = 0.002 * this.save.settings.sensitivity;
      this.yaw -= event.movementX * scale;
      this.pitch = clamp(this.pitch - event.movementY * scale, -Math.PI * 0.494, Math.PI * 0.494);
    });

    window.addEventListener('keydown', (event) => {
      if (this.ui.avatarWardrobeDialog.open) {
        const target = event.target as HTMLElement | null;
        const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
        if ((event.code === 'Escape' || (event.code === 'KeyP' && !typing)) && !event.repeat) {
          event.preventDefault();
          this.closeAvatarWardrobe();
        }
        return;
      }

      const shortcutTarget = event.target instanceof HTMLElement ? event.target : null;
      const focusedControl = shortcutTarget?.closest('input, textarea, select, button, [contenteditable="true"]');
      if (focusedControl) {
        if (event.code === 'Escape' && !event.repeat) {
          event.preventDefault();
          shortcutTarget?.blur();
        }
        return;
      }

      if (event.code === 'KeyF') {
        event.preventDefault();
        this.toggleFullscreen();
        return;
      }

      if (event.code === 'KeyP' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (this.activeVehicle) {
          event.preventDefault();
          this.showToast('请先停稳并离开载具，再更换形象', 1600);
          return;
        }
        if (this.canOpenAvatarWardrobe()) {
          event.preventDefault();
          this.openAvatarWardrobe(this.ui.avatarWardrobeEntry);
          return;
        }
      }

      if (event.code === 'KeyB' && !event.repeat) {
        if (this.activeVehicle || this.pendingVehicleObjectId) {
          event.preventDefault();
          this.showToast('请先停稳并离开载具，再进入装修', 1600);
          return;
        }
        if (this.state === 'HUB') {
          event.preventDefault();
          this.enterLobbyEditor();
          return;
        }
        if (this.state === 'HUB_EDIT') {
          event.preventDefault();
          this.lobbyEditor.disable();
          return;
        }
        if (this.state === 'PAUSED' && this.pausedFrom === 'HUB') {
          event.preventDefault();
          this.enterLobbyEditorFromPause();
          return;
        }
      }

      if (event.code === 'KeyV' && !event.repeat && this.state === 'HUB') {
        event.preventDefault();
        this.lobbyMultiplayer.toggleView();
        return;
      }

      if (event.code === 'Escape') {
        event.preventDefault();
        this.handleEscape();
        return;
      }

      if (this.state === 'HUB_EDIT' && shouldHandleCreativeCameraKey(event.code, event.target as HTMLElement | null)) {
        event.preventDefault();
        this.keys.add(event.code);
        return;
      }

      if (this.state === 'HUB_EDIT') return;

      if (this.state === 'SCREEN_FOCUS' && event.code === 'Enter') {
        event.preventDefault();
        this.diveSelectedLevel();
        return;
      }

      if (event.code === 'KeyE' && !event.repeat && this.activeVehicle) {
        event.preventDefault();
        this.requestVehicleExit();
        return;
      }

      this.keys.add(event.code);
      if (event.code === 'Space') {
        event.preventDefault();
        if (!this.activeVehicle) this.jumpBuffer = 0.12;
      }
      if (event.code === 'KeyE' && !event.repeat) this.useInteraction();
    });

    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'KeyR') this.resetHold = 0;
    });
  }

  private async beginGame(): Promise<void> {
    if (this.state !== 'BOOT' || this.joiningLobby) return;
    const channel = normalizePublicLobbyChannel(this.ui.lobbyChannelInput.value);
    if (!channel) {
      this.lobbyChannelPhase = 'error';
      this.ui.lobbyChannelInput.setAttribute('aria-invalid', 'true');
      this.ui.lobbyChannelStatus.dataset.state = 'error';
      this.ui.lobbyChannelStatus.textContent = '请输入 4–12 位数字频道号';
      this.ui.lobbyChannelInput.focus();
      this.ui.lobbyChannelInput.select();
      return;
    }
    this.ui.lobbyChannelInput.value = channel;
    this.ui.lobbyChannelInput.removeAttribute('aria-invalid');
    this.ui.lobbyChannelStatus.dataset.state = 'joining';
    this.lobbyChannelPhase = 'joining';
    this.ui.lobbyChannelStatus.textContent = `正在进入频道 ${channel}…`;
    this.ui.lobbyChannelInput.disabled = true;
    this.ui.startButton.disabled = true;
    this.joiningLobby = true;
    this.ensureAudio();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(withLobbyChannel('/api/lobby/state', channel), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`频道服务 HTTP ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      if (typeof payload.channel === 'string' && payload.channel !== channel) {
        throw new Error('频道服务返回了错误的房间');
      }
      this.lobbyChannel = channel;
      this.lobbyChannelPhase = 'ready';
      const url = new URL(window.location.href);
      url.searchParams.set('channel', channel);
      window.history.replaceState(null, '', url);
      this.lobbyEditor.setChannel(channel);
      this.lobbyMultiplayer.setLobbyChannel(channel);
      if (this.worldRoot) {
        this.lobbyEditor.attachHub(this.worldRoot);
        this.lobbyMultiplayer.attachHub(this.scene);
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.state = 'HUB';
      this.ui.boot.classList.remove('visible');
      this.ui.hud.classList.remove('hidden');
      this.showToast(`已进入频道 ${channel} · 去找音乐自动贩卖机`, 2800);
      this.requestPointerLock();
    } catch (error) {
      this.lobbyChannelPhase = 'error';
      this.ui.lobbyChannelStatus.dataset.state = 'error';
      this.ui.lobbyChannelStatus.textContent = error instanceof DOMException && error.name === 'AbortError'
        ? '频道连接超时，请重试'
        : '频道暂时无法进入，请检查号码后重试';
      this.ui.lobbyChannelInput.setAttribute('aria-invalid', 'true');
      this.ui.lobbyChannelInput.disabled = false;
      this.ui.startButton.disabled = false;
      this.ui.lobbyChannelInput.focus();
    } finally {
      window.clearTimeout(timeout);
      this.joiningLobby = false;
    }
  }

  private handleEscape(): void {
    if (this.ui.avatarWardrobeDialog.open) {
      this.closeAvatarWardrobe();
    } else if (this.state === 'HUB_EDIT') {
      this.lobbyEditor.disable();
    } else if (this.state === 'SCREEN_FOCUS') {
      this.closeTerminal();
    } else if (this.state === 'DOOR_CHOICE') {
      this.closeDoorChoice();
    } else if (this.state === 'PAUSED') {
      if (this.ui.pauseCard.classList.contains('settings-open')) this.closeSettings();
      else this.resumeGame();
    } else if (this.isWorldInteractiveState()) {
      this.openPause();
    }
  }

  private canOpenAvatarWardrobe(): boolean {
    return !this.currentLevel && !this.activeVehicle && !this.pendingVehicleObjectId && (
      this.state === 'HUB'
      || this.state === 'HUB_EDIT'
      || (this.state === 'PAUSED' && this.pausedFrom === 'HUB')
    );
  }

  private openAvatarWardrobe(opener: HTMLElement): void {
    if (!this.canOpenAvatarWardrobe() || this.ui.avatarWardrobeDialog.open) return;
    this.applySettingsToUi();
    this.keys.clear();
    this.playerVelocity.x = 0;
    this.playerVelocity.z = 0;
    this.endCreativeLook();
    this.lobbyEditor.finishPointerInteraction();
    this.wardrobeReturnPointerLock = this.state === 'HUB' && document.pointerLockElement === this.canvas;
    this.wardrobeOpener = opener;
    this.ui.avatarWardrobeDialog.showModal();
    this.ui.avatarWardrobeEntry.setAttribute('aria-expanded', 'true');
    this.updateAvatarPreviewItems();
    this.avatarPreviews.setActive(true);
    this.updateAvatarUploadUi();
    void this.refreshAccountAvatars();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    window.requestAnimationFrame(() => {
      const selected = this.ui.avatarWardrobeShell.querySelector<HTMLButtonElement>('.avatar-preset-card.selected');
      (selected ?? this.ui.nicknameInput).focus();
    });
  }

  private closeAvatarWardrobe(restoreInput = true): void {
    if (!this.ui.avatarWardrobeDialog.open) return;
    this.avatarPreviews.setActive(false);
    this.ui.avatarWardrobeDialog.close();
    this.ui.avatarWardrobeEntry.setAttribute('aria-expanded', 'false');
    const opener = this.wardrobeOpener;
    const restorePointerLock = restoreInput && this.wardrobeReturnPointerLock && this.state === 'HUB';
    this.wardrobeReturnPointerLock = false;
    this.wardrobeOpener = null;
    if (restorePointerLock) {
      window.requestAnimationFrame(() => this.requestPointerLock());
    } else if (restoreInput && opener?.isConnected) {
      opener.focus();
    }
  }

  private requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    this.canvas.requestPointerLock().catch(() => {
      this.ui.clickHint.classList.remove('hidden');
    });
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      const app = document.getElementById('app') ?? document.documentElement;
      void app.requestFullscreen();
    }
  }

  private isWorldInteractiveState(state: ShellState = this.state): boolean {
    return state === 'HUB' || state === 'LEVEL_INTRO' || state === 'LEVEL_PLAYING' || state === 'LEVEL_COMPLETE';
  }

  private enterLobbyEditor(): void {
    if (this.state !== 'HUB' || this.currentLevel) return;
    if (this.activeVehicle || this.pendingVehicleObjectId) {
      this.showToast('请先停稳并离开载具，再进入装修', 1600);
      return;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.state = 'HUB_EDIT';
    this.keys.clear();
    this.creativePlayerAnchor.copy(this.playerPosition);
    this.creativePlayerYawAnchor = this.yaw;
    this.creativePlayerPitchAnchor = this.pitch;
    this.creativeReturnView = this.lobbyMultiplayer.getView();
    this.creativeCamera.enter(this.camera, this.yaw, this.pitch, this.creativeReturnView);
    this.lobbyMultiplayer.setCreativeCameraActive(true);
    this.interactionTarget = null;
    this.setInteractionPrompt(null);
    this.ui.clickHint.classList.add('hidden');
    this.lobbyEditor.enable();
    this.ui.creativeCameraHelp.classList.add('visible');
    this.ui.creativeCameraHelp.setAttribute('aria-hidden', 'false');
    this.canvas.classList.add('creative-camera');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.showToast('创造飞行已开启 · 右键拖动观察', 1800);
  }

  private exitLobbyEditor(): void {
    if (this.state !== 'HUB_EDIT') return;
    this.keys.clear();
    this.lobbyEditor.finishPointerInteraction();
    this.lobbyMultiplayer.setView(this.creativeReturnView);
    this.deactivateCreativeCamera();
    this.state = 'HUB';
    this.syncCamera();
    this.requestPointerLock();
  }

  private endCreativeLook(pointerId?: number): void {
    if (pointerId !== undefined && this.creativeLookPointerId !== pointerId) return;
    const activePointer = this.creativeLookPointerId;
    this.creativeLookPointerId = null;
    this.creativeCamera.endLook();
    this.canvas.classList.remove('creative-looking');
    if (activePointer !== null && this.canvas.hasPointerCapture(activePointer)) {
      this.canvas.releasePointerCapture(activePointer);
    }
  }

  private deactivateCreativeCamera(): void {
    this.endCreativeLook();
    this.creativeCamera.exit();
    this.lobbyMultiplayer.setCreativeCameraActive(false);
    this.ui.creativeCameraHelp.classList.remove('visible');
    this.ui.creativeCameraHelp.setAttribute('aria-hidden', 'true');
    this.canvas.classList.remove('creative-camera', 'creative-looking');
  }

  private enterLobbyEditorFromPause(): void {
    if (this.state !== 'PAUSED' || this.pausedFrom !== 'HUB') return;
    this.ui.pause.classList.remove('visible');
    this.ui.pauseCard.classList.remove('settings-open');
    this.pausedFrom = null;
    this.state = 'HUB';
    this.enterLobbyEditor();
  }

  private openPause(): void {
    if (!this.isWorldInteractiveState()) return;
    this.pausedFrom = this.state;
    this.state = 'PAUSED';
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.ui.pause.classList.add('visible');
    this.ui.pauseCard.classList.remove('settings-open');
    const decorateButton = byId<HTMLButtonElement>('decorate-btn');
    const shortcut = document.createElement('small');
    shortcut.textContent = '快捷键 B';
    decorateButton.replaceChildren(
      document.createTextNode(this.activePersistentSpace ? '装修空间 ' : '装修大厅 '),
      shortcut,
    );
    document.querySelectorAll<HTMLElement>('.level-only').forEach((element) => {
      element.classList.toggle('hidden', this.pausedFrom === 'HUB');
    });
    document.querySelectorAll<HTMLElement>('.hub-only').forEach((element) => {
      element.classList.toggle('hidden', this.pausedFrom !== 'HUB');
    });
  }

  private resumeGame(): void {
    if (this.state !== 'PAUSED') return;
    this.state = this.pausedFrom ?? 'HUB';
    this.pausedFrom = null;
    this.ui.pause.classList.remove('visible');
    this.ui.pauseCard.classList.remove('settings-open');
    this.requestPointerLock();
  }

  private openSettings(): void {
    this.ui.pauseCard.classList.add('settings-open');
  }

  private closeSettings(): void {
    this.ui.pauseCard.classList.remove('settings-open');
  }

  private loadSave(): SaveData {
    const defaults: SaveData = {
      settings: {
        sensitivity: 1,
        fov: 75,
        headBob: true,
        volume: 0.8,
        reducedMotion: false,
        nickname: '访客',
        avatarId: DEFAULT_AVATAR_ID,
        lobbyView: 'first',
        thirdPersonCameraDistance: THIRD_PERSON_CAMERA_DISTANCE,
        lang: 'zh-CN',
      },
      history: [],
      stats: { totalCompleted: 0, totalDives: 0 },
      recent: [],
    };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const parsedSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings as Partial<Settings> : {};
      const finite = (value: unknown, fallback: number, min: number, max: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
      const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : defaults.stats;
      const history = Array.isArray(parsed.history)
        ? parsed.history.filter((entry) =>
          Boolean(entry) &&
          typeof entry.id === 'string' &&
          typeof entry.completedAt === 'number' &&
          Number.isFinite(entry.completedAt) &&
          typeof entry.timeMs === 'number' &&
          Number.isFinite(entry.timeMs) &&
          entry.result === 'complete',
        ).slice(-100)
        : [];
      return {
        settings: {
          sensitivity: finite(parsedSettings.sensitivity, defaults.settings.sensitivity, 0.2, 3),
          fov: finite(parsedSettings.fov, defaults.settings.fov, 60, 100),
          volume: finite(parsedSettings.volume, defaults.settings.volume, 0, 1),
          headBob: typeof parsedSettings.headBob === 'boolean' ? parsedSettings.headBob : defaults.settings.headBob,
          reducedMotion: typeof parsedSettings.reducedMotion === 'boolean' ? parsedSettings.reducedMotion : defaults.settings.reducedMotion,
          nickname: sanitizeNickname(parsedSettings.nickname, defaults.settings.nickname),
          avatarId: normalizeAvatarId(parsedSettings.avatarId) || DEFAULT_AVATAR_ID,
          lobbyView: parsedSettings.lobbyView === 'third' ? 'third' : 'first',
          thirdPersonCameraDistance: normalizeThirdPersonCameraDistance(parsedSettings.thirdPersonCameraDistance),
          lang: 'zh-CN',
        },
        history,
        stats: {
          totalCompleted: Math.max(0, Math.floor(finite(stats.totalCompleted, 0, 0, 1_000_000_000))),
          totalDives: Math.max(0, Math.floor(finite(stats.totalDives, 0, 0, 1_000_000_000))),
        },
        recent: Array.isArray(parsed.recent) ? parsed.recent.filter((id): id is string => typeof id === 'string').slice(-8) : [],
      };
    } catch {
      return defaults;
    }
  }

  private persistSave(): void {
    if (this.cameraZoomPersistTimer) window.clearTimeout(this.cameraZoomPersistTimer);
    this.cameraZoomPersistTimer = 0;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
      this.ui.saveIndicator.classList.add('visible');
      window.setTimeout(() => this.ui.saveIndicator.classList.remove('visible'), 950);
    } catch {
      this.showToast('浏览器阻止了本地存档', 1800);
    }
  }

  private scheduleCameraZoomPersist(): void {
    if (this.cameraZoomPersistTimer) window.clearTimeout(this.cameraZoomPersistTimer);
    this.cameraZoomPersistTimer = window.setTimeout(() => {
      this.cameraZoomPersistTimer = 0;
      this.persistSave();
    }, 220);
  }

  private flushCameraZoomPersist(): void {
    if (!this.cameraZoomPersistTimer) return;
    window.clearTimeout(this.cameraZoomPersistTimer);
    this.cameraZoomPersistTimer = 0;
    this.persistSave();
  }

  private applySettingsToUi(): void {
    const { settings } = this.save;
    settings.avatarId = normalizeAvatarId(settings.avatarId) || DEFAULT_AVATAR_ID;
    this.ui.sensitivityInput.value = settings.sensitivity.toString();
    this.ui.fovInput.value = settings.fov.toString();
    this.ui.volumeInput.value = settings.volume.toString();
    this.ui.headbobInput.checked = settings.headBob;
    this.ui.motionInput.checked = settings.reducedMotion;
    this.ui.nicknameInput.value = settings.nickname;
    this.ui.avatarInput.value = settings.avatarId;
    this.syncAvatarPresetSelection(settings.avatarId);
    const accountAvatar = this.accountAvatars.find((avatar) => avatar.avatarId === settings.avatarId);
    const avatarName = avatarPresetById(settings.avatarId)?.name ?? accountAvatar?.name ?? `自定义 · ${settings.avatarId}`;
    this.ui.avatarWardrobeCurrent.textContent = avatarName;
    this.ui.settingsAvatarCurrent.textContent = avatarName;
    this.ui.avatarWardrobeEntry.dataset.avatarId = settings.avatarId;
    this.ui.sensitivityValue.value = settings.sensitivity.toFixed(1);
    this.ui.fovValue.value = `${Math.round(settings.fov)}°`;
    this.ui.volumeValue.value = `${Math.round(settings.volume * 100)}%`;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.lobbyMultiplayer.setReducedMotion(settings.reducedMotion);
    this.vendingMachine?.setReducedMotion(settings.reducedMotion);
    if (this.masterGain) this.masterGain.gain.value = settings.volume * 0.18;
    this.ui.fade.classList.toggle('instant', settings.reducedMotion);
  }

  private accountTextState(): AccountTextState | null {
    return this.accountProfileStore?.getTextState?.() ?? null;
  }

  private accountCanUploadAvatar(): boolean {
    return this.accountTextState()?.mode === 'email';
  }

  private setAvatarUploadStatus(message: string, phase: AvatarUploadPhase, errorCode: string | null = null): void {
    this.avatarUploadPhase = phase;
    this.avatarUploadErrorCode = errorCode;
    this.ui.avatarUploadStatus.textContent = message;
    this.ui.avatarUploadStatus.dataset.state = phase === 'selected' ? 'success' : phase;
    this.updateAvatarUploadUi();
  }

  private updateAvatarUploadUi(): void {
    const signedIn = this.accountCanUploadAvatar();
    const busy = this.avatarUploadPhase === 'uploading';
    this.ui.avatarUploadPanel.dataset.state = this.avatarUploadPhase;
    this.ui.avatarUploadPanel.dataset.account = signedIn ? 'signed-in' : 'guest';
    this.ui.avatarUploadInput.disabled = !signedIn || busy;
    this.ui.avatarUploadNameInput.disabled = !signedIn || busy;
    this.ui.avatarUploadSubmit.disabled = !signedIn || !this.avatarUploadFile || busy;
    this.ui.avatarUploadLogin.classList.toggle('hidden', signedIn);
    if (!signedIn && !busy) {
      this.ui.avatarUploadStatus.textContent = '登录邮箱账号后即可上传自己的 GLB 角色';
      this.ui.avatarUploadStatus.dataset.state = 'idle';
    }
  }

  private clearAvatarUploadObjectUrl(): void {
    if (this.avatarUploadObjectUrl) URL.revokeObjectURL(this.avatarUploadObjectUrl);
    this.avatarUploadObjectUrl = null;
    this.ui.avatarUploadLocalPreview.classList.add('hidden');
  }

  private async selectAvatarUploadFile(): Promise<void> {
    const file = this.ui.avatarUploadInput.files?.[0] ?? null;
    this.avatarUploadFile = null;
    this.clearAvatarUploadObjectUrl();
    if (!file) {
      this.ui.avatarUploadFileLabel.textContent = '选择 GLB 文件';
      this.setAvatarUploadStatus('请选择一个自包含的 glTF 2.0 GLB 角色', 'idle');
      this.updateAvatarPreviewItems();
      return;
    }
    try {
      await validateAvatarUploadFile(file);
      this.avatarUploadFile = file;
      this.ui.avatarUploadNameInput.value = avatarNameFromFileName(file.name);
      this.ui.avatarUploadFileLabel.textContent = file.name;
      this.avatarUploadObjectUrl = URL.createObjectURL(file);
      this.ui.avatarUploadLocalPreview.classList.remove('hidden');
      this.updateAvatarPreviewItems();
      this.setAvatarUploadStatus(`已选择 ${(file.size / 1024 / 1024).toFixed(2)} MB · 可上传并预览`, 'selected');
    } catch (error) {
      const uploadError = error instanceof AvatarUploadError
        ? error
        : new AvatarUploadError('invalid_avatar_glb', '无法读取这个 GLB 文件');
      this.ui.avatarUploadInput.value = '';
      this.ui.avatarUploadFileLabel.textContent = '重新选择 GLB 文件';
      this.updateAvatarPreviewItems();
      this.setAvatarUploadStatus(uploadError.message, 'error', uploadError.code);
    }
  }

  private renderAccountAvatarCards(): void {
    this.ui.avatarAccountList.replaceChildren();
    for (const avatar of this.accountAvatars) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-preset-card avatar-account-card';
      button.dataset.avatarId = avatar.avatarId;
      button.setAttribute('aria-pressed', 'false');
      const preview = document.createElement('span');
      preview.className = 'avatar-preset-preview';
      preview.dataset.avatarPreviewId = avatar.avatarId;
      preview.dataset.previewId = avatar.avatarId;
      preview.dataset.previewKind = 'glb';
      preview.setAttribute('role', 'img');
      const viewport = document.createElement('span');
      viewport.className = 'avatar-preset-preview-viewport';
      viewport.dataset.previewViewport = '';
      const status = document.createElement('span');
      status.className = 'avatar-preset-preview-status';
      status.dataset.previewStatus = '';
      status.textContent = '准备 3D 预览';
      preview.append(viewport, status);
      const copy = document.createElement('span');
      copy.className = 'avatar-preset-copy';
      const name = document.createElement('b');
      name.textContent = avatar.name;
      const author = document.createElement('small');
      author.textContent = `我的上传 · ${avatar.author}`;
      copy.append(name, author);
      button.append(preview, copy);
      this.ui.avatarAccountList.append(button);
    }
    this.ui.avatarAccountLibrary.classList.toggle('hidden', this.accountAvatars.length === 0);
    this.syncAvatarPresetSelection(this.save.settings.avatarId);
    this.updateAvatarPreviewItems();
  }

  private updateAvatarPreviewItems(): void {
    const registrations: LobbyPropPreviewRegistration[] = [];
    for (const preset of AVATAR_PRESETS) {
      const host = [...this.ui.avatarPresetList.querySelectorAll<HTMLElement>('[data-avatar-preview-id]')]
        .find((element) => element.dataset.avatarPreviewId === preset.id);
      if (host) registrations.push({
        item: { id: preset.id, name: preset.name, kind: 'glb', assetUrl: preset.modelUrl },
        host,
      });
    }
    for (const avatar of this.accountAvatars) {
      const host = [...this.ui.avatarAccountList.querySelectorAll<HTMLElement>('[data-avatar-preview-id]')]
        .find((element) => element.dataset.avatarPreviewId === avatar.avatarId);
      if (host) registrations.push({
        item: { id: avatar.avatarId, name: avatar.name, kind: 'glb', assetUrl: avatar.avatarUrl },
        host,
      });
    }
    if (this.avatarUploadObjectUrl) registrations.push({
      item: {
        id: 'local-avatar-preview',
        name: this.ui.avatarUploadNameInput.value.trim() || '待上传角色',
        kind: 'glb',
        assetUrl: this.avatarUploadObjectUrl,
      },
      host: this.ui.avatarUploadLocalPreview,
    });
    this.avatarPreviews.setItems(registrations);
  }

  private async refreshAccountAvatars(): Promise<void> {
    const request = ++this.avatarListRequest;
    if (!this.accountCanUploadAvatar()) {
      this.accountAvatars = [];
      this.renderAccountAvatarCards();
      return;
    }
    try {
      const avatars = await listAccountAvatars();
      if (request !== this.avatarListRequest) return;
      this.accountAvatars = avatars;
      this.renderAccountAvatarCards();
      this.applySettingsToUi();
    } catch (error) {
      if (request !== this.avatarListRequest || this.avatarUploadPhase === 'uploading') return;
      const uploadError = error instanceof AvatarUploadError
        ? error
        : new AvatarUploadError('avatar_list_failed', '暂时无法读取我的角色');
      this.setAvatarUploadStatus(uploadError.message, 'error', uploadError.code);
    }
  }

  private async uploadSelectedAvatar(): Promise<void> {
    if (!this.accountCanUploadAvatar()) {
      this.setAvatarUploadStatus('请先登录邮箱账号再上传角色', 'error', 'account_required');
      return;
    }
    const file = this.avatarUploadFile;
    if (!file) {
      this.setAvatarUploadStatus('请先选择一个 GLB 文件', 'error', 'avatar_file_required');
      return;
    }
    this.avatarUploadController?.abort();
    const controller = new AbortController();
    this.avatarUploadController = controller;
    this.setAvatarUploadStatus('正在安全校验并上传角色…', 'uploading');
    try {
      const record = await uploadAccountAvatar(
        file,
        this.ui.avatarUploadNameInput.value,
        sanitizeNickname(this.ui.nicknameInput.value),
        controller.signal,
      );
      if (this.avatarUploadController !== controller) return;
      this.accountAvatars = [record, ...this.accountAvatars.filter((avatar) => avatar.avatarId !== record.avatarId)];
      this.uploadedAvatarId = record.avatarId;
      this.renderAccountAvatarCards();
      this.ui.avatarInput.value = record.avatarId;
      this.syncAvatarPresetSelection(record.avatarId);
      const applied = await this.verifyAndApplyProfile(
        sanitizeNickname(this.ui.nicknameInput.value),
        record.avatarId,
        true,
      );
      if (!applied) {
        this.setAvatarUploadStatus('角色已上传，但自动应用失败；可在“我的角色”中重试', 'error', 'avatar_apply_failed');
        return;
      }
      this.avatarUploadFile = null;
      this.ui.avatarUploadInput.value = '';
      this.ui.avatarUploadFileLabel.textContent = '继续上传其他 GLB';
      this.clearAvatarUploadObjectUrl();
      this.updateAvatarPreviewItems();
      this.setAvatarUploadStatus(`上传成功 · 已切换为 ${record.name}`, 'success');
    } catch (error) {
      if (this.avatarUploadController !== controller) return;
      const uploadError = error instanceof AvatarUploadError
        ? error
        : new AvatarUploadError('avatar_upload_failed', error instanceof DOMException && error.name === 'AbortError'
          ? '上传已取消'
          : '角色上传失败，请稍后重试');
      this.setAvatarUploadStatus(uploadError.message, 'error', uploadError.code);
    } finally {
      if (this.avatarUploadController === controller) {
        this.avatarUploadController = null;
        this.updateAvatarUploadUi();
      }
    }
  }

  private async applyProfileSettings(): Promise<void> {
    const rawAvatarId = this.ui.avatarInput.value.trim();
    const normalizedAvatarId = normalizeAvatarId(rawAvatarId);
    if (rawAvatarId && !normalizedAvatarId) {
      this.ui.profileStatus.textContent = 'Avatar 代码格式无效：请使用 9–64 位小写字母、数字或连字符';
      this.ui.profileStatus.dataset.state = 'error';
      return;
    }
    await this.verifyAndApplyProfile(
      sanitizeNickname(this.ui.nicknameInput.value),
      normalizedAvatarId || DEFAULT_AVATAR_ID,
      true,
    );
  }

  private syncAvatarPresetSelection(avatarId: string | null): void {
    const resolvedAvatarId = normalizeAvatarId(avatarId) || DEFAULT_AVATAR_ID;
    for (const button of this.ui.avatarWardrobeShell.querySelectorAll<HTMLButtonElement>('.avatar-preset-card[data-avatar-id]')) {
      const selected = button.dataset.avatarId === resolvedAvatarId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  private async applyAvatarFromUrl(): Promise<void> {
    const rawAvatarId = new URLSearchParams(window.location.search).get('avatar');
    if (rawAvatarId === null) return;
    const avatarId = normalizeAvatarId(rawAvatarId);
    if (!avatarId) {
      this.ui.profileStatus.textContent = '链接中的 Avatar 代码格式无效';
      this.ui.profileStatus.dataset.state = 'error';
      return;
    }
    this.ui.avatarInput.value = avatarId;
    await this.verifyAndApplyProfile(this.save.settings.nickname, avatarId, false);
  }

  private async verifyAndApplyProfile(name: string, avatarId: string, announce: boolean): Promise<boolean> {
    const resolvedAvatarId = normalizeAvatarId(avatarId) || DEFAULT_AVATAR_ID;
    const request = ++this.profileApplyRequest;
    this.profileApplyController?.abort();
    this.profileApplyController = null;
    const preset = avatarPresetById(resolvedAvatarId);
    this.ui.profileApplyButton.disabled = true;
    this.profileApplying = true;
    this.ui.profileStatus.textContent = preset ? `正在应用 ${preset.name}…` : '正在验证 Avatar…';
    this.ui.profileStatus.dataset.state = 'loading';
    try {
      if (!isBuiltInAvatarId(resolvedAvatarId)) {
        const controller = new AbortController();
        this.profileApplyController = controller;
        const timer = window.setTimeout(() => controller.abort(), 6000);
        try {
          const response = await fetch(`/api/avatars/${encodeURIComponent(resolvedAvatarId)}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(response.status === 404 ? '没有找到这个 Avatar' : `验证失败（HTTP ${response.status}）`);
          const payload = await response.json().catch(() => null) as unknown;
          const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
          const avatar = root.avatar && typeof root.avatar === 'object' ? root.avatar as Record<string, unknown> : root;
          const returnedId = normalizeAvatarId(avatar.avatarId ?? avatar.id);
          if (returnedId && returnedId !== resolvedAvatarId) throw new Error('Avatar 验证结果不匹配');
          const status = typeof avatar.status === 'string' ? avatar.status.toLowerCase() : '';
          if (status && !['ready', 'approved', 'active', 'published'].includes(status)) throw new Error(`Avatar 尚不可用（${status}）`);
        } finally {
          window.clearTimeout(timer);
        }
      }
      if (request !== this.profileApplyRequest) return false;
      const nickname = sanitizeNickname(name);
      await this.accountProfileStore?.savePlayerProfile(nickname, resolvedAvatarId);
      if (request !== this.profileApplyRequest) return false;
      this.save.settings.nickname = nickname;
      this.save.settings.avatarId = resolvedAvatarId;
      this.lobbyMultiplayer.setProfile({ name: this.save.settings.nickname, avatarId: resolvedAvatarId });
      this.lobbyEditor.setNickname(this.save.settings.nickname);
      this.applySettingsToUi();
      this.persistSave();
      const accountAvatar = this.accountAvatars.find((entry) => entry.avatarId === resolvedAvatarId);
      this.ui.profileStatus.textContent = preset
        ? `已应用 ${preset.name}`
        : `已应用 ${accountAvatar?.name ?? `自定义 Avatar · ${resolvedAvatarId}`}`;
      this.ui.profileStatus.dataset.state = 'success';
      if (announce) this.showToast('大厅形象已更新', 1500);
      return true;
    } catch (error) {
      if (request !== this.profileApplyRequest) return false;
      const message = error instanceof Error && error.name !== 'AbortError' ? error.message : '验证超时，请稍后重试';
      this.ui.profileStatus.textContent = message;
      this.ui.profileStatus.dataset.state = 'error';
      if (announce) this.showToast('Avatar 未应用', 1600);
      return false;
    } finally {
      if (request === this.profileApplyRequest) {
        this.profileApplyController = null;
        this.profileApplying = false;
        this.ui.profileApplyButton.disabled = false;
      }
    }
  }

  private ensureAudio(): void {
    if (this.save.settings.volume <= 0) return;
    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContext();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.save.settings.volume * 0.18;
        this.masterGain.connect(this.audioContext.destination);
      } catch {
        this.audioContext = null;
        this.masterGain = null;
      }
    }
    if (this.audioContext?.state === 'suspended') void this.audioContext.resume();
  }

  private playTone(frequency: number, duration = 0.12, wave: OscillatorType = 'sine', detune = 0): void {
    if (!this.audioContext || !this.masterGain || this.save.settings.volume <= 0) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.value = detune;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  private showToast(text: string, durationMs = 1800): void {
    this.ui.toast.textContent = text;
    this.ui.toast.classList.remove('hidden');
    this.toastEndsAt = this.simulationTime + durationMs / 1000;
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private async loadRegistry(): Promise<void> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      if (this.reviewLevelId) {
        const basePath = reviewLevelBasePath(this.reviewLevelId);
        const response = await fetch(`${basePath}level.json`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`review level HTTP ${response.status}`);
        const manifest = validateLevelManifest(await response.json(), this.reviewLevelId);
        const reviewLevel = manifestToLevel(manifest, basePath, 'review-preview');
        this.levelPool = [reviewLevel];
        this.selectedLevel = reviewLevel;
        this.registryLoaded = true;
        this.registryError = null;
        this.ui.indexedCount.textContent = '1';
        if (this.state === 'SCREEN_FOCUS') this.updateTerminalUi();
        return;
      }
      const response = await fetch('/registry.json', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
      const entries = parseApprovedRegistry(await response.json());
      const officialIds = new Set(LEVELS.map((level) => level.id));
      const communityLevels = entries
        .filter((entry) => !officialIds.has(entry.id))
        .map(registryEntryToLevel);
      this.levelPool = [...LEVELS, ...communityLevels];
      this.registryLoaded = true;
      this.registryError = null;
      this.ui.indexedCount.textContent = String(this.levelPool.length);
      const devLevel = this.devLevelId ? this.levelPool.find((level) => level.id === this.devLevelId) : null;
      if (devLevel) this.selectedLevel = devLevel;
      if (this.state === 'SCREEN_FOCUS') this.updateTerminalUi();
    } catch (error) {
      this.registryLoaded = false;
      this.registryError = error instanceof Error ? error.message : 'registry load failed';
      this.levelPool = [...LEVELS];
      this.ui.indexedCount.textContent = String(this.levelPool.length);
    } finally {
      window.clearTimeout(timer);
    }
  }

  private availableLevels(): LevelDefinition[] {
    const available = this.levelPool.filter((level) => !this.failedDynamicLevels.has(level.id));
    if (this.reviewLevelId) {
      const reviewLevel = available.find((level) => level.id === this.reviewLevelId);
      if (reviewLevel) return [reviewLevel];
    }
    if (this.devLevelId) {
      const devLevel = available.find((level) => level.id === this.devLevelId);
      if (devLevel) return [devLevel];
    }
    return available.length > 0 ? available : [...LEVELS];
  }

  private findAvailableLevel(id: string): LevelDefinition {
    const level = this.levelPool.find((candidate) => candidate.id === id);
    if (!level) throw new Error(`Unknown level: ${id}`);
    return level;
  }

  private rerollLevel(): void {
    if (this.partyState) {
      this.showToast('请先退出同行，再更换关卡', 1600);
      return;
    }
    this.selectedLevel = chooseLevel(this.availableLevels(), this.save.recent, Math.random, this.selectedLevel.id);
    this.updateTerminalUi();
    this.playTone(520, 0.07, 'square');
  }

  private focusTerminal(): void {
    if (this.state !== 'HUB') return;
    this.startVendingPerformance();
    this.state = 'SCREEN_FOCUS';
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.updateTerminalUi();
    this.ui.terminal.classList.add('visible');
  }

  private replayVendingMusic(): void {
    if (this.state !== 'SCREEN_FOCUS') return;
    this.startVendingPerformance();
    this.showToast('音乐与灯光已重新开始', 1200);
  }

  private startVendingPerformance(): void {
    this.vendingMachine?.setReducedMotion(this.save.settings.reducedMotion);
    this.vendingMachine?.start(this.simulationTime);
    this.ensureAudio();
    if (this.audioContext && this.masterGain && this.save.settings.volume > 0) {
      try {
        this.vendingMachineSynth.start(this.audioContext, this.masterGain);
      } catch (error) {
        console.warn('[WhiteRoom] Vending music could not start', error);
      }
    } else {
      this.vendingMachineSynth.stop();
    }
    byId('terminal-clock').textContent = '♪ NOW PLAYING · 126 BPM';
  }

  private stopVendingPerformance(): void {
    this.vendingMachineSynth.stop();
    this.vendingMachine?.stop();
    byId('terminal-clock').textContent = 'COIN READY';
  }

  private updateTerminalUi(): void {
    const level = this.selectedLevel;
    this.ui.worldName.textContent = level.name;
    const source = level.source === 'ugc' ? '社区 UGC' : '官方';
    this.ui.worldMeta.textContent = `by ${level.author} · ${source} · ${level.typeLabel} · ${difficultyStars(level.difficulty)} · 约 ${level.estimatedMinutes} 分钟`;
    this.ui.worldDescription.textContent = level.description;
    this.ui.worldGlyph.textContent = level.glyph;
    this.ui.worldSwatch.style.background = `radial-gradient(circle at 62% 28%, ${level.palette[0]} 0, ${level.palette[1]} 34%, ${level.palette[2]} 78%)`;
    const multiplayer = this.lobbyMultiplayer.getTextState();
    this.ui.partyDive.disabled = !multiplayer.connected || multiplayer.online < 2 || Boolean(this.partyState);
    this.ui.partyDive.textContent = multiplayer.online > 1
      ? `◎ 同行合购（${multiplayer.online - 1} 人在线）`
      : '◎ 暂无同行玩家';
  }

  private levelVersion(level: LevelDefinition): string {
    return level.contentHash ?? `builtin:1:${level.id}`;
  }

  private invitePartyToSelectedLevel(): void {
    if (this.state !== 'SCREEN_FOCUS') return;
    if (!this.lobbyMultiplayer.createParty(this.selectedLevel.id, this.levelVersion(this.selectedLevel))) {
      this.showToast('同行服务正在连接，请稍后再试', 1800);
    }
  }

  private handlePartyInvite(invite: LobbyPartyInvite | null): void {
    this.partyInvite = invite;
    if (invite) {
      let compatible = false;
      try {
        compatible = this.levelVersion(this.findAvailableLevel(invite.levelId)) === invite.levelVersion;
      } catch {
        compatible = false;
      }
      if (!compatible || this.currentLevel) {
        this.lobbyMultiplayer.respondToParty(invite, false, invite.levelVersion);
        this.partyInvite = null;
        if (!compatible) this.showToast('同行邀请的关卡版本不可用', 1900);
      } else if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    }
    this.updatePartyPanel();
  }

  private handlePartyState(party: LobbyPartyState | null): void {
    this.partyState = party;
    if (party) this.partyInvite = null;
    this.updatePartyPanel();
  }

  private respondToPartyInvite(accept: boolean): void {
    const invite = this.partyInvite;
    if (!invite) return;
    let version = invite.levelVersion;
    try {
      version = this.levelVersion(this.findAvailableLevel(invite.levelId));
    } catch {
      accept = false;
    }
    this.lobbyMultiplayer.respondToParty(invite, accept, version);
    if (!accept) {
      this.partyInvite = null;
      this.updatePartyPanel();
      if (this.state === 'HUB') this.requestPointerLock();
    }
  }

  private handlePartyLaunch(launch: LobbyPartyLaunch): void {
    let level: LevelDefinition;
    try {
      level = this.findAvailableLevel(launch.levelId);
    } catch {
      this.lobbyMultiplayer.returnToLobbyChannel();
      this.showToast('同行关卡已不可用，已留在大厅', 2200);
      return;
    }
    if (this.levelVersion(level) !== launch.levelVersion) {
      this.lobbyMultiplayer.returnToLobbyChannel();
      this.showToast('同行关卡版本不一致，已取消进入', 2200);
      return;
    }
    this.partyInvite = null;
    this.partyState = null;
    this.updatePartyPanel();
    if (this.state === 'HUB_EDIT') {
      this.lobbyEditor.disable(false);
      this.deactivateCreativeCamera();
      this.state = 'HUB';
    }
    if (this.ui.avatarWardrobeDialog.open) this.closeAvatarWardrobe(false);
    this.stopVendingPerformance();
    this.ui.terminal.classList.remove('visible');
    this.ui.pause.classList.remove('visible');
    this.selectedLevel = level;
    this.beginTransition({ kind: 'level', levelId: level.id, reset: false });
  }

  private handlePartyNotice(code: string): void {
    const labels: Record<string, string> = {
      party_no_players: '当前没有其他在线玩家',
      party_invite_rate_limited: '邀请太频繁，请稍后再试',
      party_already_joined: '你已加入另一支同行队伍，请先退出再接受',
      party_full: '同行队伍已经满员',
      party_version_mismatch: '双方关卡版本不一致',
      party_invite_expired: '同行邀请已经结束',
      party_leader_left: '发起者已离开，同行已取消',
      party_cancelled: '同行已取消',
    };
    this.showToast(labels[code] ?? '同行状态已更新', 1800);
  }

  private requestVehicleEnter(handle: LobbyVehicleHandle): void {
    if (this.state !== 'HUB' || this.currentLevel || this.lobbyEditor.enabled) return;
    if (this.activeVehicle || this.pendingVehicleObjectId) {
      this.showToast('当前正在使用另一台载具', 1500);
      return;
    }
    const snapshot = this.vehicleSnapshots.get(handle.objectId);
    if (snapshot?.driverId) {
      this.showToast('这台载具正在被其他玩家驾驶', 1700);
      return;
    }
    if (!this.lobbyMultiplayer.requestVehicleEnter(handle.objectId)) {
      this.showToast('载具服务正在连接，请稍后再试', 1800);
      return;
    }
    this.pendingVehicleObjectId = handle.objectId;
    this.keys.clear();
    this.playerVelocity.set(0, 0, 0);
    this.interactionTarget = null;
    this.setInteractionPrompt(null);
    this.showToast(`正在进入 ${handle.name}…`, 1400);
  }

  private handleVehicleEvent(event: LobbyVehicleEvent): void {
    if (event.type === 'snapshot') {
      const nextIds = new Set(event.vehicles.map((vehicle) => vehicle.objectId));
      for (const objectId of this.vehicleSnapshots.keys()) {
        if (!nextIds.has(objectId)) this.lobbyEditor.clearVehicleRuntimePose(objectId);
      }
      this.vehicleSnapshots.clear();
      this.pendingVehicleSnapshotIds.clear();
      for (const vehicle of event.vehicles) {
        this.vehicleSnapshots.set(vehicle.objectId, vehicle);
        this.pendingVehicleSnapshotIds.add(vehicle.objectId);
      }
      if (this.activeVehicle) {
        const activeSnapshot = event.vehicles.find((vehicle) => vehicle.objectId === this.activeVehicle?.handle.objectId);
        const selfId = this.lobbyMultiplayer.getTextState().self.id;
        if (!activeSnapshot) {
          this.beginPendingVehicleRecovery('state_loss');
        } else if (activeSnapshot.recovering && activeSnapshot.driverId === selfId) {
          this.applyServerVehicleRecoverySnapshot(activeSnapshot, 'state_loss');
        } else if (activeSnapshot.driverId !== selfId) {
          if (activeSnapshot.driverId) {
            this.finishActiveVehicleExit('原驾驶会话已结束', true);
            this.applyVehicleSnapshot(activeSnapshot);
          } else {
            this.applyVehicleSnapshot(activeSnapshot);
            this.finishOrAutolandReleasedVehicle(activeSnapshot, 'state_loss', '载具连接已安全释放');
          }
        }
      }
      this.flushPendingVehicleSnapshots();
      return;
    }

    if (event.type === 'error') {
      const labels: Record<string, string> = {
        vehicle_not_in_lobby: '只有在大厅里才能驾驶载具',
        vehicle_not_found: '这台载具已不存在',
        vehicle_not_capable: '这件物品没有通过载具能力审核',
        vehicle_too_far: '请再靠近一点后上车',
        vehicle_busy: '这台载具正在被其他玩家驾驶',
        vehicle_already_driving: '你已经在驾驶另一台载具',
        vehicle_lease_rejected: '驾驶授权已失效',
        vehicle_state_stale: '载具状态已过期，正在重新同步',
        vehicle_state_rejected: '载具同步异常，已启动安全降落',
        vehicle_state_rate_limited: '操作同步过快，已自动限速',
        vehicle_exit_rejected: '落地状态正在复核，继续保持座位',
      };
      this.pendingVehicleObjectId = null;
      this.showToast(labels[event.code] ?? '载具状态已更新', 1900);
      if (this.activeVehicle && vehicleErrorRequiresRecovery(event.code)) {
        this.beginPendingVehicleRecovery(event.code === 'vehicle_lease_rejected' ? 'timeout' : 'state_loss');
      } else if (
        this.activeVehicle?.safeExitMode === 'awaiting-release'
        && (event.code === 'vehicle_exit_rejected' || event.code === 'vehicle_state_stale')
      ) {
        this.beginPendingVehicleRecovery(
          'state_loss',
          '落地状态复核中 · 保持座位并等待安全接管',
          true,
        );
      }
      return;
    }

    const snapshot = event.vehicle;
    this.vehicleSnapshots.set(snapshot.objectId, snapshot);
    this.pendingVehicleSnapshotIds.add(snapshot.objectId);

    if (event.type === 'recovery') {
      const selfId = this.lobbyMultiplayer.getTextState().self.id;
      if (this.activeVehicle?.handle.objectId === snapshot.objectId && event.driverId === selfId) {
        if (event.local) {
          this.applyVehicleSnapshot(snapshot);
          this.finishOrAutolandReleasedVehicle(snapshot, event.reason, '载具连接已安全释放');
        } else {
          this.applyServerVehicleRecoverySnapshot(snapshot, event.reason);
        }
      } else {
        this.applyVehicleSnapshot(snapshot);
      }
      this.flushPendingVehicleSnapshots();
      return;
    }

    if (event.type === 'entered') {
      const handle = this.lobbyEditor.getVehicleHandle(snapshot.objectId);
      if (!handle || (this.pendingVehicleObjectId && this.pendingVehicleObjectId !== snapshot.objectId)) {
        this.lobbyMultiplayer.releaseVehicle(snapshot.objectId, event.leaseId, Math.max(1, snapshot.seq + 1));
        this.pendingVehicleObjectId = null;
        this.showToast('载具已经变化，请重新靠近后再试', 1800);
        return;
      }
      this.applyVehicleSnapshot(snapshot);
      const initialState = beginLobbyVehicleEnter(this.vehiclePhysicsStateFromSnapshot(snapshot, 'idle'));
      this.activeVehicle = {
        handle,
        simulation: new LobbyVehicleSimulation(handle.capability, initialState),
        leaseId: event.leaseId,
        networkSeq: snapshot.seq,
        lastStateSentAt: this.simulationTime - VEHICLE_STATE_INTERVAL,
        releaseSent: false,
        safeExitMode: 'none',
        recoveryReason: null,
        autolandTarget: null,
        autolandStartedAt: 0,
        autolandFallback: false,
      };
      this.pendingVehicleObjectId = null;
      this.lobbyMultiplayer.setLocalVehicleSafetyHold(true);
      this.keys.clear();
      this.playerVelocity.set(0, 0, 0);
      this.playerFacingYaw = snapshot.yaw;
      this.yaw = snapshot.yaw + Math.PI;
      this.pitch = -0.16;
      this.updateActiveVehicle(0, false);
      this.playTone(260, 0.08, 'square');
      this.showToast(
        handle.capability.kind === 'car'
          ? '驾驶已接管 · W/S 行驶'
          : handle.capability.flightModel === 'rotorcraft'
            ? '驾驶已接管 · W/S 前后 · Space 上升'
            : '驾驶已接管 · W/S 调整油门',
        1900,
      );
      return;
    }

    if (event.type === 'released') {
      this.applyVehicleSnapshot(snapshot);
      const selfId = this.lobbyMultiplayer.getTextState().self.id;
      if (this.activeVehicle?.handle.objectId === snapshot.objectId && event.driverId === selfId) {
        const label = event.reason === 'exit' ? '已离开载具' : '载具连接已安全释放';
        this.finishOrAutolandReleasedVehicle(snapshot, event.reason, label);
      }
      this.flushPendingVehicleSnapshots();
      return;
    }

    if (this.activeVehicle?.handle.objectId === snapshot.objectId) {
      if (
        snapshot.recovering
        || this.activeVehicle.safeExitMode === 'server-autoland'
        || this.activeVehicle.safeExitMode === 'awaiting-recovery'
      ) this.applyServerVehicleRecoverySnapshot(snapshot, this.activeVehicle.recoveryReason ?? 'state_loss');
    } else {
      this.applyVehicleSnapshot(snapshot);
    }
    this.flushPendingVehicleSnapshots();
  }

  private beginPendingVehicleRecovery(
    reason: LobbyVehicleRecoveryReason,
    message = '驾驶同步中断 · 保持座位并等待自动降落接管',
    requestServerRecovery = false,
  ): void {
    const active = this.activeVehicle;
    if (!active) return;
    active.safeExitMode = 'awaiting-recovery';
    active.recoveryReason = reason;
    active.releaseSent = false;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(true);
    this.keys.clear();
    this.playerVelocity.set(
      active.simulation.state.velocity.x,
      active.simulation.state.velocity.y,
      active.simulation.state.velocity.z,
    );
    if (requestServerRecovery) {
      this.lobbyMultiplayer.requestVehicleRecovery(active.handle.objectId, active.leaseId);
    }
    this.showToast(message, 2200);
  }

  private applyServerVehicleRecoverySnapshot(
    snapshot: LobbyVehicleSnapshot,
    reason: LobbyVehicleRecoveryReason,
  ): void {
    const active = this.activeVehicle;
    if (!active || active.handle.objectId !== snapshot.objectId || snapshot.driverId === null) return;
    const previousYaw = active.simulation.state.yaw;
    const state = this.vehiclePhysicsStateFromSnapshot(snapshot, 'driving');
    active.simulation = new LobbyVehicleSimulation(active.handle.capability, state);
    this.yaw += Math.atan2(Math.sin(state.yaw - previousYaw), Math.cos(state.yaw - previousYaw));
    active.networkSeq = Math.max(active.networkSeq, snapshot.seq);
    active.safeExitMode = 'server-autoland';
    active.recoveryReason = reason;
    active.releaseSent = false;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(true);
    this.keys.clear();
    this.applyVehicleSnapshot(snapshot);
    this.updateActiveVehicle(0, false);
  }

  private beginReleasedVehicleAutoland(
    snapshot: LobbyVehicleSnapshot,
    reason: LobbyVehicleReleaseReason | LobbyVehicleRecoveryReason,
  ): void {
    const active = this.activeVehicle;
    if (!active || active.handle.objectId !== snapshot.objectId) return;
    const previousYaw = active.simulation.state.yaw;
    const state = this.vehiclePhysicsStateFromSnapshot(snapshot, 'driving');
    active.simulation = new LobbyVehicleSimulation(active.handle.capability, state);
    this.yaw += Math.atan2(Math.sin(state.yaw - previousYaw), Math.cos(state.yaw - previousYaw));
    active.networkSeq = Math.max(active.networkSeq, snapshot.seq);
    active.safeExitMode = 'released-autoland';
    active.recoveryReason = reason === 'exit' || reason === 'server_shutdown' ? 'state_loss' : reason;
    active.releaseSent = false;
    active.autolandTarget = resolveLobbyRotorcraftLandingTarget(
      state,
      active.handle.capability,
      this.vehicleEnvironment(active.handle),
    );
    active.autolandStartedAt = this.simulationTime;
    active.autolandFallback = active.autolandTarget === null;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(true);
    this.keys.clear();
    this.updateActiveVehicle(0, false);
    this.showToast('载具授权已结束 · 保持座位并执行本地安全降落', 2200);
  }

  private finishOrAutolandReleasedVehicle(
    snapshot: LobbyVehicleSnapshot,
    reason: LobbyVehicleReleaseReason | LobbyVehicleRecoveryReason,
    message: string,
  ): void {
    const active = this.activeVehicle;
    if (!active || active.handle.objectId !== snapshot.objectId) return;
    const preservedExit = active.simulation.state.exitPosition
      ? { ...active.simulation.state.exitPosition }
      : null;
    const releasedState = this.vehiclePhysicsStateFromSnapshot(snapshot, 'driving');
    if (lobbyRotorcraftReleaseRequiresAutoland(
      releasedState,
      active.handle.capability,
      this.vehicleEnvironment(active.handle),
    )) {
      this.beginReleasedVehicleAutoland(snapshot, reason);
      return;
    }
    if (preservedExit) releasedState.exitPosition = preservedExit;
    else {
      const safeExit = resolveLobbyVehicleExit(
        releasedState,
        active.handle.capability,
        this.vehicleEnvironment(active.handle),
      );
      if (safeExit.position) releasedState.exitPosition = { ...safeExit.position };
    }
    active.simulation = new LobbyVehicleSimulation(active.handle.capability, releasedState);
    this.finishActiveVehicleExit(message);
  }

  private vehiclePhysicsStateFromSnapshot(
    snapshot: LobbyVehicleSnapshot,
    phase: LobbyVehiclePhysicsState['phase'],
  ): LobbyVehiclePhysicsState {
    const state = createLobbyVehicleState({ x: snapshot.x, y: snapshot.y, z: snapshot.z }, snapshot.yaw);
    state.phase = phase;
    state.pitch = snapshot.pitch;
    state.roll = snapshot.roll;
    state.velocity = { x: snapshot.vx, y: snapshot.vy, z: snapshot.vz };
    state.speed = snapshot.kind === 'car'
      ? snapshot.vx * Math.sin(snapshot.yaw) + snapshot.vz * Math.cos(snapshot.yaw)
      : Math.hypot(snapshot.vx, snapshot.vy, snapshot.vz);
    state.grounded = snapshot.kind === 'car' || snapshot.y <= 0.12;
    return state;
  }

  private applyVehicleSnapshot(snapshot: LobbyVehicleSnapshot): boolean {
    const handle = this.lobbyEditor.getVehicleHandle(snapshot.objectId);
    if (!handle || handle.capability.kind !== snapshot.kind) return false;
    const physics = this.vehiclePhysicsStateFromSnapshot(snapshot, snapshot.driverId ? 'driving' : 'idle');
    const pose: LobbyVehicleRuntimePose = {
      objectId: snapshot.objectId,
      driverId: snapshot.driverId,
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
      yaw: snapshot.yaw,
      pitch: snapshot.pitch,
      roll: snapshot.roll,
      vx: snapshot.vx,
      vy: snapshot.vy,
      vz: snapshot.vz,
      seq: snapshot.seq,
      visual: lobbyVehicleVisualState(physics, handle.capability),
    };
    const applied = this.lobbyEditor.applyVehicleRuntimePose(pose);
    if (applied) this.pendingVehicleSnapshotIds.delete(snapshot.objectId);
    return applied;
  }

  private flushPendingVehicleSnapshots(): void {
    for (const objectId of [...this.pendingVehicleSnapshotIds]) {
      if (this.activeVehicle?.handle.objectId === objectId) {
        this.pendingVehicleSnapshotIds.delete(objectId);
        continue;
      }
      const snapshot = this.vehicleSnapshots.get(objectId);
      if (!snapshot) this.pendingVehicleSnapshotIds.delete(objectId);
      else this.applyVehicleSnapshot(snapshot);
    }
  }

  private vehicleEnvironment(handle: LobbyVehicleHandle): LobbyVehicleEnvironment {
    const ownColliders = new Set(this.lobbyColliders.get(handle.objectId) ?? []);
    const aircraft = handle.capability.kind === 'aircraft';
    const celestialDragon = handle.catalogId === 'code-celestial-riding-dragon'
      && this.activePersistentSpace?.id === 'heaven';
    const unboundedCoordinate = Number.MAX_SAFE_INTEGER;
    const horizontalLimit = celestialDragon ? 20.5 : LOBBY_WORLD_LIMIT;
    return {
      groundY: 0,
      minX: celestialDragon ? -horizontalLimit : aircraft ? -unboundedCoordinate : -LOBBY_WORLD_LIMIT,
      maxX: celestialDragon ? horizontalLimit : aircraft ? unboundedCoordinate : LOBBY_WORLD_LIMIT,
      minY: 0,
      maxY: celestialDragon ? 38 : aircraft ? unboundedCoordinate : 32,
      minZ: celestialDragon ? -horizontalLimit : aircraft ? -unboundedCoordinate : -LOBBY_WORLD_LIMIT,
      maxZ: celestialDragon ? horizontalLimit : aircraft ? unboundedCoordinate : LOBBY_WORLD_LIMIT,
      playerHalfExtents: { x: PLAYER_RADIUS, y: PLAYER_HEIGHT / 2, z: PLAYER_RADIUS },
      colliders: this.colliders
        .filter((collider) => !ownColliders.has(collider) && collider.object !== handle.root)
        .map((collider) => ({
          min: { x: collider.box.min.x, y: collider.box.min.y, z: collider.box.min.z },
          max: { x: collider.box.max.x, y: collider.box.max.y, z: collider.box.max.z },
        })),
    };
  }

  private vehicleInput(active: ActiveLobbyVehicle): LobbyVehicleInput {
    if (active.simulation.state.phase !== 'driving') return {};
    if (active.safeExitMode === 'autoland' || active.safeExitMode === 'released-autoland') {
      return lobbyRotorcraftAutolandInput(active.simulation.state, active.autolandTarget);
    }
    if (active.safeExitMode !== 'none') return {};
    const right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    if (active.handle.capability.kind === 'car') {
      return {
        throttle: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
        steering: right,
        brake: this.keys.has('Space') ? 1 : 0,
      };
    }
    if (active.handle.capability.flightModel === 'rotorcraft') {
      return {
        throttle: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
        yaw: lobbyRotorcraftYawInput(right),
        vertical: (this.keys.has('Space') ? 1 : 0)
          - (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyC') ? 1 : 0),
      };
    }
    const throttleTarget = this.keys.has('KeyW')
      ? 1
      : this.keys.has('KeyS')
        ? 0
        : active.simulation.state.throttle;
    return {
      throttle: throttleTarget,
      yaw: right,
      pitch: (this.keys.has('Space') ? 1 : 0)
        - (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0),
      roll: (this.keys.has('KeyC') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0),
      brake: this.keys.has('KeyS') && active.simulation.state.throttle <= 0.02 ? 1 : 0,
    };
  }

  private updateActiveVehicle(dt: number, advancePhysics: boolean): void {
    const active = this.activeVehicle;
    if (!active) return;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(true);
    const previousYaw = active.simulation.state.yaw;
    if (active.safeExitMode === 'autoland' && this.simulationTime - active.autolandStartedAt > 20) {
      this.beginPendingVehicleRecovery(
        'state_loss',
        '自动降落已交由服务端接管 · 请保持座位',
        true,
      );
    } else if (
      active.safeExitMode === 'awaiting-release'
      && this.simulationTime - active.autolandStartedAt > 6
    ) {
      this.beginPendingVehicleRecovery(
        'state_loss',
        '离机确认超时 · 已交由服务端完成安全释放',
        true,
      );
    } else if (
      active.safeExitMode === 'released-autoland'
      && this.simulationTime - active.autolandStartedAt > 20
    ) {
      active.autolandFallback = true;
      active.autolandTarget = null;
    }
    const serverDriven = active.safeExitMode === 'awaiting-recovery' || active.safeExitMode === 'server-autoland';
    const baseEnvironment = this.vehicleEnvironment(active.handle);
    const simulationEnvironment = active.autolandFallback
      ? { ...baseEnvironment, colliders: [] }
      : baseEnvironment;
    let state = advancePhysics && !serverDriven
      ? active.simulation.advance(dt, this.vehicleInput(active), simulationEnvironment)
      : active.simulation.state;
    if ((active.safeExitMode === 'autoland' || active.safeExitMode === 'released-autoland') && state.phase === 'driving') {
      const releasedAutoland = active.safeExitMode === 'released-autoland';
      const exit = beginLobbyVehicleExit(state, active.handle.capability, simulationEnvironment);
      if (exit.decision.allowed) {
        active.simulation.state = exit.state;
        active.safeExitMode = releasedAutoland ? 'released-autoland' : 'awaiting-release';
        if (!releasedAutoland) active.autolandStartedAt = this.simulationTime;
        state = exit.state;
        this.showToast('自动降落完成 · 正在安全离开载具', 1200);
      }
    }
    if (advancePhysics) {
      const yawDelta = Math.atan2(Math.sin(state.yaw - previousYaw), Math.cos(state.yaw - previousYaw));
      this.yaw += yawDelta;
    }
    const selfId = this.lobbyMultiplayer.getTextState().self.id;
    const pose: LobbyVehicleRuntimePose = {
      objectId: active.handle.objectId,
      driverId: selfId,
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
      yaw: state.yaw,
      pitch: state.pitch,
      roll: state.roll,
      vx: state.velocity.x,
      vy: state.velocity.y,
      vz: state.velocity.z,
      seq: active.networkSeq,
      visual: lobbyVehicleVisualState(state, active.handle.capability),
    };
    this.lobbyEditor.applyVehicleRuntimePose(pose);
    active.handle.root.updateWorldMatrix(true, true);
    const seat = active.handle.root.localToWorld(new THREE.Vector3(...active.handle.capability.seatAnchor));
    this.playerPosition.copy(seat);
    this.playerVelocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    this.playerFacingYaw = state.yaw;
    this.grounded = state.grounded;
    this.movementInputActive = false;
    this.interactionTarget = null;
    this.setVehiclePrompt(active);
    this.syncVehicleCamera(active);

    const networkNow = this.simulationTime;
    if (
      !active.releaseSent
      && !serverDriven
      && active.safeExitMode !== 'released-autoland'
      && networkNow - active.lastStateSentAt >= VEHICLE_STATE_INTERVAL - 0.001
    ) {
      active.networkSeq += 1;
      if (this.lobbyMultiplayer.sendVehicleState({
        objectId: active.handle.objectId,
        leaseId: active.leaseId,
        seq: active.networkSeq,
        x: state.position.x,
        y: state.position.y,
        z: state.position.z,
        yaw: state.yaw,
        pitch: state.pitch,
        roll: state.roll,
        vx: state.velocity.x,
        vy: state.velocity.y,
        vz: state.velocity.z,
      })) active.lastStateSentAt = networkNow;
    }

    if (state.phase === 'idle' && state.exitPosition && active.safeExitMode === 'released-autoland') {
      this.finishActiveVehicleExit('自动降落完成 · 已安全离开载具');
      return;
    }
    if (state.phase === 'idle' && state.exitPosition && !active.releaseSent && !serverDriven) {
      active.networkSeq += 1;
      active.releaseSent = this.lobbyMultiplayer.releaseVehicle(
        active.handle.objectId,
        active.leaseId,
        active.networkSeq,
      );
      active.safeExitMode = active.releaseSent ? 'awaiting-release' : 'awaiting-recovery';
      if (active.releaseSent) active.autolandStartedAt = this.simulationTime;
      if (!active.releaseSent) this.beginPendingVehicleRecovery('disconnect', undefined, true);
    }
  }

  private setVehiclePrompt(active: ActiveLobbyVehicle): void {
    const state = active.simulation.state;
    if (active.safeExitMode === 'awaiting-recovery') {
      this.setInteractionPrompt('驾驶同步恢复中 · 保持座位并等待服务端安全接管…');
      return;
    }
    if (active.safeExitMode === 'server-autoland') {
      this.setInteractionPrompt('服务端安全接管 · 自动降落中…');
      return;
    }
    if (active.safeExitMode === 'autoland' || active.safeExitMode === 'released-autoland') {
      this.setInteractionPrompt(`自动降落中 · 保持座位 · 水平制动 · ${Math.round(state.position.y)} m`);
      return;
    }
    if (state.phase === 'entering') {
      this.setInteractionPrompt('正在进入载具…');
      return;
    }
    if (state.phase === 'exiting' || active.releaseSent) {
      this.setInteractionPrompt('正在安全离开载具…');
      return;
    }
    const speed = Math.round(Math.abs(state.speed) * 3.6);
    if (active.handle.capability.kind === 'car') {
      this.setInteractionPrompt(`W/S 行驶 · A/D 转向 · Space 手刹 · E 下车 · ${speed} km/h`);
    } else if (active.handle.capability.flightModel === 'rotorcraft') {
      const altitude = Math.round(state.position.y);
      this.setInteractionPrompt(`W/S 前后 · A/D 转向 · Space 上升 · Shift/C 下降 · E 下机 · ${speed} km/h · ${altitude} m`);
    } else {
      const altitude = Math.round(state.position.y);
      this.setInteractionPrompt(`W/S 油门 · A/D 偏航 · Space/Shift 俯仰 · Q/C 翻滚 · E 下机 · ${speed} km/h · ${altitude} m`);
    }
  }

  private syncVehicleCamera(active: ActiveLobbyVehicle): void {
    active.handle.root.updateWorldMatrix(true, true);
    this.camera.rotation.order = 'YXZ';
    if (this.lobbyMultiplayer.getView() === 'first') {
      const seat = active.handle.root.localToWorld(new THREE.Vector3(...active.handle.capability.seatAnchor));
      this.camera.position.copy(seat).add(new THREE.Vector3(0, 0.68, 0));
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      return;
    }
    const target = active.handle.root.localToWorld(new THREE.Vector3(...active.handle.capability.cameraAnchor));
    const cameraBase = target.clone().add(new THREE.Vector3(0, -THIRD_PERSON_AVATAR_CENTER_HEIGHT, 0));
    const ownColliders = new Set(this.lobbyColliders.get(active.handle.objectId) ?? []);
    const colliders = this.colliders.filter(
      (collider) => !ownColliders.has(collider) && collider.object !== active.handle.root,
    );
    const cameraDistance = resolveLobbyVehicleThirdPersonCameraDistance(
      active.handle.capability,
      this.lobbyMultiplayer.getCameraZoomState().currentDistance,
    );
    this.camera.position.copy(resolveThirdPersonCameraPosition(
      cameraBase,
      this.yaw,
      this.pitch,
      colliders,
      cameraDistance,
    ));
    this.camera.lookAt(target);
  }

  private requestVehicleExit(): void {
    const active = this.activeVehicle;
    if (!active || active.releaseSent) return;
    if (active.simulation.state.phase === 'entering') {
      this.showToast('请等待上车动作完成', 1200);
      return;
    }
    if (active.simulation.state.phase !== 'driving') return;
    if (active.handle.capability.kind === 'aircraft' && active.handle.capability.flightModel === 'rotorcraft') {
      if (active.safeExitMode !== 'none') {
        this.showToast('自动降落正在进行，请保持等待', 1300);
        return;
      }
      active.safeExitMode = 'autoland';
      active.recoveryReason = null;
      active.autolandTarget = resolveLobbyRotorcraftLandingTarget(
        active.simulation.state,
        active.handle.capability,
        this.vehicleEnvironment(active.handle),
      );
      active.autolandStartedAt = this.simulationTime;
      active.autolandFallback = false;
      this.keys.clear();
      if (!active.autolandTarget) {
        this.beginPendingVehicleRecovery(
          'state_loss',
          '已交由服务端规划安全降落 · 请保持座位',
          true,
        );
        return;
      }
      this.showToast('已启动自动降落 · 将在接地停稳后安全离机', 1900);
      return;
    }
    const result = beginLobbyVehicleExit(
      active.simulation.state,
      active.handle.capability,
      this.vehicleEnvironment(active.handle),
    );
    if (!result.decision.allowed) {
      const labels = {
        moving_too_fast: '请先停稳，再离开载具',
        airborne: '请先降落并停稳，再离开飞机',
        no_safe_space: '周围没有安全的下车位置',
        not_driving: '当前还不能离开载具',
        ok: '正在离开载具',
      } as const;
      this.showToast(labels[result.decision.reason], 1700);
      return;
    }
    active.simulation.state = result.state;
    this.keys.clear();
    this.showToast('正在安全离开载具…', 1100);
  }

  private finishActiveVehicleExit(message: string, placePlayer = true): void {
    const active = this.activeVehicle;
    if (!active) return;
    const state = active.simulation.state;
    if (placePlayer) {
      let exit = state.exitPosition
        ? new THREE.Vector3(state.exitPosition.x, state.exitPosition.y, state.exitPosition.z)
        : active.handle.root.localToWorld(new THREE.Vector3(...active.handle.capability.exitAnchors[0]!));
      if (!Number.isFinite(exit.x) || !Number.isFinite(exit.z)) exit = new THREE.Vector3(state.position.x + 1.5, 0, state.position.z);
      this.playerPosition.set(
        exit.x,
        0.02,
        exit.z,
      );
      this.playerVelocity.set(0, 0, 0);
      this.playerFacingYaw = state.yaw;
      this.grounded = true;
    }
    this.activeVehicle = null;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(false);
    this.pendingVehicleObjectId = null;
    this.keys.clear();
    this.interactionTarget = null;
    this.setInteractionPrompt(null);
    this.syncCamera();
    if (message) this.showToast(message, 1500);
  }

  private releaseVehicleForTransition(): void {
    const active = this.activeVehicle;
    if (active && !active.releaseSent) {
      active.networkSeq += 1;
      this.lobbyMultiplayer.releaseVehicle(active.handle.objectId, active.leaseId, active.networkSeq);
    }
    if (active) this.finishActiveVehicleExit('', false);
    this.pendingVehicleObjectId = null;
  }

  private updatePartyPanel(): void {
    const invite = this.partyInvite;
    const party = this.partyState;
    this.ui.partyPanel.classList.toggle('hidden', !invite && !party);
    if (!invite && !party) return;
    const startsAt = Date.parse((invite ?? party)!.startsAt);
    const seconds = Math.max(0, Math.ceil((startsAt - Date.now()) / 1000));
    if (invite) {
      let levelName = invite.levelId;
      try { levelName = this.findAvailableLevel(invite.levelId).name; } catch { /* handled by version validation */ }
      this.ui.partyKicker.textContent = `${invite.leader.name} 的邀请`;
      this.ui.partyTitle.textContent = `一起进入「${levelName}」`;
      this.ui.partyDetail.textContent = `${seconds} 秒后出发 · 确认后会一起进入同一个世界`;
      this.ui.partyMembers.replaceChildren();
      this.ui.partyAccept.classList.remove('hidden');
      this.ui.partyDecline.classList.remove('hidden');
      this.ui.partyCancel.classList.add('hidden');
      return;
    }
    const leader = party!.leaderId === this.lobbyMultiplayer.getTextState().self.id;
    let levelName = party!.levelId;
    try { levelName = this.findAvailableLevel(party!.levelId).name; } catch { /* display safe ID fallback */ }
    this.ui.partyKicker.textContent = leader ? '你发起了同行' : '已加入同行';
    this.ui.partyTitle.textContent = `即将进入「${levelName}」`;
    this.ui.partyDetail.textContent = `${seconds} 秒后一起出发 · 当前 ${party!.members.length}/${party!.maxMembers} 人`;
    this.ui.partyMembers.replaceChildren(...party!.members.map((member) => {
      const chip = document.createElement('span');
      chip.textContent = member.id === party!.leaderId ? `${member.name} · 发起者` : member.name;
      return chip;
    }));
    this.ui.partyAccept.classList.add('hidden');
    this.ui.partyDecline.classList.add('hidden');
    this.ui.partyCancel.classList.remove('hidden');
    this.ui.partyCancel.textContent = leader ? '取消同行' : '退出同行';
  }

  private closeTerminal(): void {
    if (this.state !== 'SCREEN_FOCUS') return;
    this.stopVendingPerformance();
    this.state = 'HUB';
    this.ui.terminal.classList.remove('visible');
    this.requestPointerLock();
  }

  private diveSelectedLevel(): void {
    if (this.state !== 'SCREEN_FOCUS') return;
    this.stopVendingPerformance();
    this.lobbyMultiplayer.cancelParty();
    this.partyInvite = null;
    this.partyState = null;
    this.updatePartyPanel();
    this.ui.terminal.classList.remove('visible');
    this.beginTransition({ kind: 'level', levelId: this.selectedLevel.id, reset: false });
  }

  private useLobbyPortal(portal: LobbyPortalUse): void {
    if (this.state !== 'HUB' || this.currentLevel || this.transition) return;
    const destination = portal.destination;
    if (!this.lobbyChannel || !isPersistentPortalSpaceId(destination.spaceId)) {
      this.showToast('任意门目的地暂不可用', 1800);
      return;
    }
    this.lobbyMultiplayer.cancelParty();
    this.partyInvite = null;
    this.partyState = null;
    this.updatePartyPanel();
    this.showToast(`任意门开启 · 正在前往${destination.label}`, 1100);
    this.beginTransition({
      kind: 'persistent-space',
      spaceId: destination.spaceId,
      spaceLabel: destination.label,
      stateChannel: persistentSpaceChannel(this.lobbyChannel, destination.spaceId),
    });
  }

  private handleLobbyPropInteraction(interaction: LobbyPropInteractionUse): void {
    if (
      interaction.catalogId !== 'code-infernal-concert-grand'
      || this.activePersistentSpace?.id !== 'hell'
      || interaction.sequence <= this.infernalPianoInteractionSequence
    ) return;
    this.infernalPianoInteractionSequence = interaction.sequence;
    if (interaction.ageSeconds >= interaction.durationMs / 1000) return;

    this.ensureAudio();
    if (!this.audioContext || !this.masterGain) {
      this.showToast('浏览器暂时无法启用钢琴音频', 1800);
      return;
    }
    if (!this.infernalPianoAudio) {
      this.infernalPianoAudio = new InfernalPianoAudio(this.audioContext, this.masterGain, {
        musicGain: 0.86,
        spatialPosition: { x: 0, y: 1.95, z: -0.45 },
      });
    }
    const playback = this.infernalPianoAudio.active || this.infernalPianoAudio.starting
      ? this.infernalPianoAudio.restart(interaction.ageSeconds)
      : this.infernalPianoAudio.start(interaction.ageSeconds);
    void playback.then((started) => {
      if (started && this.activePersistentSpace?.id === 'hell') {
        this.showToast('钢琴开始自动演奏 · 可在礁石旁静静聆听', 2400);
      }
    }).catch((error) => {
      console.warn('[WhiteRoom] Infernal piano playback failed', error);
      this.showToast('钢琴音频启动失败', 1800);
    });
  }

  private handleLocalLobbyPropInteraction(interaction: LobbyLocalPropInteractionUse): void {
    if (interaction.catalogId !== 'code-trump-tower-residences') return;
    const destination = trumpTowerResidenceForSequence(interaction.sequence);
    if (!destination) return;
    interaction.root.updateWorldMatrix(true, true);
    const worldPosition = interaction.root.localToWorld(new THREE.Vector3(...destination.localPosition));
    this.playerPosition.copy(worldPosition);
    this.playerVelocity.set(0, 0, 0);
    this.syncCamera();
    this.showToast(`Trump 大厦 · 已抵达 ${destination.label}`, 1800);
  }

  private continueRoaming(): void {
    if (!this.currentLevel) return;
    this.lobbyMultiplayer.returnToLobbyChannel();
    this.ui.door.classList.remove('visible');
    this.selectedLevel = chooseLevel(this.availableLevels(), this.save.recent, Math.random, this.currentLevel.id);
    this.beginTransition({ kind: 'level', levelId: this.selectedLevel.id, reset: false });
  }

  private transitionToHub(): void {
    this.lobbyMultiplayer.returnToLobbyChannel();
    this.ui.pause.classList.remove('visible');
    this.ui.door.classList.remove('visible');
    this.beginTransition({ kind: 'hub' });
  }

  private beginTransition(target: Omit<TransitionTarget, 'readyAt'>): void {
    this.releaseVehicleForTransition();
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.state = 'TRANSITION_IN';
    this.ui.intro.classList.remove('visible');
    this.ui.fade.classList.remove('dark');
    this.ui.fade.classList.add('active');
    const delay = this.save.settings.reducedMotion ? 0.08 : 0.48;
    this.transition = { ...target, readyAt: this.simulationTime + delay };
    this.playTone(190, 0.25, 'sine', -80);
  }

  private softResetLevel(): void {
    const level = this.currentLevel;
    if (!level) return;
    this.ui.pause.classList.remove('visible');
    this.ui.pauseCard.classList.remove('settings-open');
    this.showToast('正在重载当前世界…', 1000);
    this.beginTransition({ kind: 'level', levelId: level.id, reset: true });
  }

  private update(dt: number): void {
    this.simulationTime += dt;

    if (this.transition && this.simulationTime >= this.transition.readyAt) {
      const target = this.transition;
      this.transition = null;
      if (target.kind === 'hub') {
        this.buildHubScene();
        this.fadeEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.04 : 0.18);
      } else if (
        target.kind === 'persistent-space'
        && target.spaceId
        && target.spaceLabel
        && target.stateChannel
      ) {
        this.buildPersistentSpaceScene(target.spaceId, target.spaceLabel, target.stateChannel);
        this.fadeEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.04 : 0.18);
      } else {
        void this.loadTransitionLevel(target.levelId!, Boolean(target.reset));
      }
    }

    if (this.fadeEndsAt > 0 && this.simulationTime >= this.fadeEndsAt) {
      this.fadeEndsAt = 0;
      this.ui.fade.classList.remove('active', 'dark');
    }

    if (this.ui.avatarWardrobeDialog.open && !this.canOpenAvatarWardrobe()) this.closeAvatarWardrobe(false);

    const multiplayerActive = (!this.currentLevel && (
      this.state === 'HUB'
      || this.state === 'HUB_EDIT'
      || this.state === 'SCREEN_FOCUS'
      || (this.state === 'PAUSED' && this.pausedFrom === 'HUB')
    )) || this.lobbyMultiplayer.hasActivePartyLevel();
    this.lobbyMultiplayer.setLevelMode(Boolean(this.currentLevel) && this.lobbyMultiplayer.hasActivePartyLevel());
    this.lobbyMultiplayer.setActive(multiplayerActive, this.scene);

    if (this.toastEndsAt > 0 && this.simulationTime >= this.toastEndsAt) {
      this.toastEndsAt = 0;
      this.ui.toast.classList.add('hidden');
    }

    if (this.state === 'LEVEL_INTRO' && this.simulationTime >= this.introEndsAt) {
      this.state = 'LEVEL_PLAYING';
      this.ui.intro.classList.remove('visible');
    }

    if (this.state === 'LEVEL_FAILED' && this.simulationTime >= this.failEndsAt) {
      if (this.failNeedsReset) {
        this.failNeedsReset = false;
        this.softResetLevel();
      } else {
        this.respawnAtCheckpoint();
      }
    }

    this.movementInputActive = false;
    if (this.activeVehicle && !this.currentLevel && (
      this.state === 'HUB'
      || (this.state === 'PAUSED' && this.pausedFrom === 'HUB')
    )) {
      this.updateActiveVehicle(dt, this.state === 'HUB');
    } else if (this.pendingVehicleObjectId && this.state === 'HUB') {
      this.playerVelocity.set(0, 0, 0);
      this.syncCamera();
      this.interactionTarget = null;
      this.setInteractionPrompt('正在申请驾驶授权…');
    } else if (this.ui.avatarWardrobeDialog.open && this.state === 'HUB') {
      this.playerVelocity.x = 0;
      this.playerVelocity.z = 0;
      this.syncCamera();
      this.interactionTarget = null;
      this.setInteractionPrompt(null);
    } else if (this.isWorldInteractiveState()) {
      this.updatePlayer(dt);
      this.updateInteractionTarget();
    } else if (this.state === 'HUB_EDIT') {
      this.playerPosition.copy(this.creativePlayerAnchor);
      this.yaw = this.creativePlayerYawAnchor;
      this.pitch = this.creativePlayerPitchAnchor;
      this.creativeCamera.update(dt, this.keys);
      this.interactionTarget = null;
      this.setInteractionPrompt(null);
    } else {
      this.interactionTarget = null;
      this.setInteractionPrompt(null);
    }

    if (this.persistentPortalScene) {
      this.persistentPortalScene.root.userData.pianoPlaying = this.infernalPianoAudio?.active === true;
      this.persistentPortalScene.root.userData.pianoActiveNotes = this.infernalPianoAudio?.getActiveMidiNotes() ?? [];
      this.persistentPortalScene.update(this.simulationTime, dt);
    }
    if (!this.currentLevel) {
      this.lobbyEditor.update(this.simulationTime);
      this.flushPendingVehicleSnapshots();
    }
    const networkVehicle = !this.currentLevel ? this.activeVehicle?.simulation.state : null;
    this.lobbyMultiplayer.update(dt, this.simulationTime, {
      x: networkVehicle?.position.x ?? this.playerPosition.x,
      y: networkVehicle ? 0.02 : this.playerPosition.y,
      z: networkVehicle?.position.z ?? this.playerPosition.z,
      yaw: this.playerFacingYaw,
      moving: multiplayerActive
        && !this.ui.avatarWardrobeDialog.open
        && (this.state === 'HUB' || this.state === 'LEVEL_INTRO' || this.state === 'LEVEL_PLAYING' || this.state === 'LEVEL_COMPLETE')
        && this.movementInputActive,
    });

    if (this.currentLevel && (this.state === 'LEVEL_INTRO' || this.state === 'LEVEL_PLAYING')) {
      this.levelElapsed += dt;
      this.updateLevel(dt);
      if (this.state === 'LEVEL_PLAYING' && this.currentLevel.timeLimit && this.levelElapsed >= this.currentLevel.timeLimit) {
        this.failLevel('time_up', true);
      } else if (this.state === 'LEVEL_PLAYING' && this.playerPosition.y < this.currentLevel.killY) {
        this.failLevel('fall', false);
      }
    } else if (this.currentLevel) {
      this.animateLevelObjects(dt);
    } else if (this.activePersistentSpace) {
      this.animateLevelObjects(dt);
      if (this.playerPosition.y < -8) {
        this.playerPosition.copy(this.checkpoint);
        this.playerVelocity.set(0, 0, 0);
        this.grounded = true;
        this.showToast(`已回到${this.activePersistentSpace.label}入口`, 1200);
        this.syncCamera();
      }
    }

    if (this.currentLevel && this.isWorldInteractiveState() && this.state !== 'HUB') this.updateResetHold(dt);
    else this.resetHold = 0;

    if (this.gateGroup) {
      const progress = clamp((this.simulationTime - this.gateSpawnTime) / 0.85, 0.001, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.gateGroup.scale.y = eased;
      this.gateGroup.visible = progress > 0;
    }

    this.syncCamera();
    this.updateHud();
    if (this.partyInvite || this.partyState) this.updatePartyPanel();
    if (this.state === 'SCREEN_FOCUS') this.updateTerminalUi();
  }

  private async loadTransitionLevel(levelId: string, reset: boolean): Promise<void> {
    if (this.loadingDynamicLevel) return;
    try {
      const level = this.findAvailableLevel(levelId);
      if (level.source !== 'ugc') {
        this.buildLevelScene(level, reset);
      } else {
        this.loadingDynamicLevel = true;
        await this.loadDynamicLevel(level, reset);
      }
      this.fadeEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.04 : 0.18);
    } catch (error) {
      this.failedDynamicLevels.add(levelId);
      this.loadingDynamicLevel = false;
      this.lobbyMultiplayer.returnToLobbyChannel();
      this.buildHubScene();
      this.selectedLevel = chooseLevel(this.availableLevels(), this.save.recent, Math.random, levelId);
      const reason = error instanceof Error ? error.message : 'unknown error';
      console.error(`[WhiteRoom] UGC level ${levelId} failed: ${reason}`);
      this.showToast(`世界加载失败 · 已安全返回桌面`, 2600);
      this.fadeEndsAt = this.simulationTime + 0.1;
    } finally {
      this.loadingDynamicLevel = false;
    }
  }

  private render(): void {
    this.vendingMachine?.update(this.simulationTime);
    this.renderer.render(this.scene, this.camera);
  }

  private updateHud(): void {
    const wardrobeAvailable = !this.currentLevel && (this.state === 'HUB' || this.state === 'HUB_EDIT');
    this.ui.avatarWardrobeEntry.classList.toggle('hidden', !wardrobeAvailable);
    const inLevel = Boolean(this.currentLevel) && this.state !== 'TRANSITION_IN' && this.state !== 'HUB' && this.state !== 'SCREEN_FOCUS';
    this.ui.objectiveCard.classList.toggle('hidden', !inLevel);
    if (this.currentLevel && inLevel) {
      this.ui.objectiveText.textContent = this.currentLevel.objective;
      this.ui.progressText.textContent = this.getProgressText();
    }

    const hasTimer = Boolean(this.currentLevel?.timeLimit) && inLevel;
    this.ui.timerCard.classList.toggle('hidden', !hasTimer);
    if (hasTimer && this.currentLevel?.timeLimit) {
      const remaining = Math.max(0, this.currentLevel.timeLimit - this.levelElapsed);
      this.ui.timerText.textContent = formatTime(remaining);
      this.ui.timerCard.classList.toggle('warning', remaining <= 15);
    } else {
      this.ui.timerCard.classList.remove('warning');
    }
  }

  private getProgressText(): string {
    const level = this.currentLevel;
    if (!level) return '';
    if (this.state === 'LEVEL_COMPLETE' || this.state === 'DOOR_CHOICE') return '完成 · 找到归返之门';
    if (this.dynamicProgress) return this.dynamicProgress;
    if (level.type === 'collect') return `收集进度 ${this.collectedCount}/${level.required ?? 0}`;
    if (level.type === 'puzzle') return `协议节点 ${this.puzzleFlags.size}/${level.flags?.length ?? 0}`;
    if (level.type === 'survive') return `坚持 ${formatTime(Math.max(0, (level.duration ?? 0) - this.surviveElapsed))}`;
    if (level.type === 'eliminate') return `目标 ${this.dynamicTargetsDown}/${this.dynamicTargetsTotal}`;
    if (level.type === 'escape') return `解锁条件 ${this.puzzleFlags.size}/${level.flags?.length ?? 0}`;
    if (level.type === 'custom') return '等待世界判定';
    if (level.type === 'reach_zone') return level.source === 'ugc' ? '寻找目标区域' : this.checkpointReached ? '中继点已同步 · 继续向前' : '寻找前方信标';
    return '';
  }

  private updateResetHold(dt: number): void {
    if (!this.keys.has('KeyR')) {
      this.resetHold = 0;
      this.ui.resetMeter.classList.add('hidden');
      return;
    }
    this.resetHold += dt;
    this.ui.resetMeter.classList.remove('hidden');
    this.ui.resetFill.style.width = `${clamp(this.resetHold, 0, 1) * 100}%`;
    if (this.resetHold >= 1) {
      this.keys.delete('KeyR');
      this.resetHold = 0;
      this.ui.resetMeter.classList.add('hidden');
      this.softResetLevel();
    }
  }

  private createTextState(): GameTextState {
    const round = (value: number): number => Number(value.toFixed(2));
    const position = this.playerPosition;
    const wardrobeOpen = this.ui.avatarWardrobeDialog.open;
    const wardrobeContext = this.state === 'HUB'
      ? 'hub'
      : this.state === 'HUB_EDIT'
        ? 'hub_edit'
        : this.state === 'PAUSED' && this.pausedFrom === 'HUB'
          ? 'paused_hub'
          : null;
    const multiplayerText = this.lobbyMultiplayer.getTextState();
    const cameraZoom = this.lobbyMultiplayer.getCameraZoomState();
    const activeVehicle = this.activeVehicle;
    const vehicleState = activeVehicle?.simulation.state ?? null;
    const avatarTarget = thirdPersonCameraTarget(position);
    const thirdPersonFraming = !this.currentLevel
      && (this.state === 'HUB' || (this.state === 'PAUSED' && this.pausedFrom === 'HUB'))
      && multiplayerText.view === 'third';
    this.camera.updateMatrixWorld(true);
    const avatarAnchorNdc = thirdPersonFraming && !activeVehicle ? avatarTarget.clone().project(this.camera) : null;
    const vehicleTarget = activeVehicle
      ? activeVehicle.handle.root.localToWorld(new THREE.Vector3(...activeVehicle.handle.capability.cameraAnchor))
      : null;
    const effectiveCameraDistance = activeVehicle
      ? resolveLobbyVehicleThirdPersonCameraDistance(activeVehicle.handle.capability, cameraZoom.currentDistance)
      : cameraZoom.currentDistance;
    const vehicleAnchorNdc = thirdPersonFraming && vehicleTarget ? vehicleTarget.clone().project(this.camera) : null;
    const vehicleExit = activeVehicle
      ? resolveLobbyVehicleExit(vehicleState!, activeVehicle.handle.capability, this.vehicleEnvironment(activeVehicle.handle))
      : null;
    const distanceToAvatarCenter = this.camera.position.distanceTo(avatarTarget);
    const state: GameTextState = {
      coordinateSystem: 'Three.js world meters; origin varies per world, +Y up, camera forward is -Z at yaw 0',
      mode: this.activePersistentSpace ? 'persistent-space' : this.currentLevel ? 'level' : 'lobby',
      state: this.state,
      lobbyChannel: {
        selected: this.lobbyChannel,
        entryRequired: this.state === 'BOOT' && !this.lobbyChannel,
        joining: this.joiningLobby,
        phase: this.lobbyChannelPhase,
      },
      persistentSpace: this.activePersistentSpace
        ? {
          id: this.activePersistentSpace.id,
          label: this.activePersistentSpace.label,
          stateChannel: this.activePersistentSpace.stateChannel,
          originChannel: this.activePersistentSpace.returnChannel,
          returnChannel: this.activePersistentSpace.returnChannel,
          persistence: 'server-backed',
          returnPortalPosition: this.persistentSpaceReturnPosition
            ? {
              x: round(this.persistentSpaceReturnPosition.x),
              y: round(this.persistentSpaceReturnPosition.y),
              z: round(this.persistentSpaceReturnPosition.z),
            }
            : null,
          landmark: {
            kind: this.activePersistentSpace.id === 'heaven'
              ? 'celestial-riding-dragon'
              : 'infernal-concert-grand',
            statePersistence: 'server-backed',
            pianoPlaying: this.infernalPianoAudio?.active === true,
            activePianoKeys: this.infernalPianoAudio?.getActiveMidiNotes().length ?? 0,
            dragonOccupied: Boolean(this.vehicleSnapshots.get('realm-celestial-dragon-0001')?.driverId),
          },
        }
        : null,
      input: {
        pointerLocked: document.pointerLockElement === this.canvas,
        pausedFrom: this.pausedFrom,
        controlTarget: activeVehicle ? 'vehicle' : 'player',
        movementSuppressed: Boolean(activeVehicle || this.pendingVehicleObjectId),
      },
      player: {
        position: { x: round(position.x), y: round(position.y), z: round(position.z) },
        velocity: { x: round(this.playerVelocity.x), y: round(this.playerVelocity.y), z: round(this.playerVelocity.z) },
        yawDeg: round(THREE.MathUtils.radToDeg(this.yaw)),
        facingYawDeg: round(THREE.MathUtils.radToDeg(this.playerFacingYaw)),
        movementInputActive: this.movementInputActive,
        controlSuppressed: Boolean(activeVehicle || this.pendingVehicleObjectId),
        visible: !activeVehicle,
        pitchDeg: round(THREE.MathUtils.radToDeg(this.pitch)),
        grounded: this.grounded,
        checkpoint: { x: round(this.checkpoint.x), y: round(this.checkpoint.y), z: round(this.checkpoint.z) },
      },
      camera: {
        position: { x: round(this.camera.position.x), y: round(this.camera.position.y), z: round(this.camera.position.z) },
        distanceToPlayerEye: round(this.camera.position.distanceTo(lobbyPlayerEyePosition(position))),
        distanceToAvatarCenter: round(distanceToAvatarCenter),
        requestedDistance: round(cameraZoom.requestedDistance),
        zoomDistance: round(cameraZoom.currentDistance),
        effectiveDistance: round(effectiveCameraDistance),
        minDistance: THIRD_PERSON_MIN_CAMERA_DISTANCE,
        maxDistance: THIRD_PERSON_MAX_CAMERA_DISTANCE,
        collisionLimited: !activeVehicle && thirdPersonFraming && distanceToAvatarCenter < cameraZoom.currentDistance - 0.03,
        avatarTarget: thirdPersonFraming && !activeVehicle
          ? { x: round(avatarTarget.x), y: round(avatarTarget.y), z: round(avatarTarget.z) }
          : null,
        avatarAnchorNdc: avatarAnchorNdc
          ? { x: round(avatarAnchorNdc.x), y: round(avatarAnchorNdc.y) }
          : null,
        targetKind: activeVehicle ? 'vehicle' : 'player',
        vehicleAnchorNdc: vehicleAnchorNdc
          ? { x: round(vehicleAnchorNdc.x), y: round(vehicleAnchorNdc.y) }
          : null,
        obstructed: !activeVehicle && thirdPersonFraming && this.lobbyMultiplayer.isThirdPersonCameraObstructed(),
      },
      vehicle: {
        active: Boolean(activeVehicle),
        pendingObjectId: this.pendingVehicleObjectId,
        objectId: activeVehicle?.handle.objectId ?? null,
        catalogId: activeVehicle?.handle.catalogId ?? null,
        kind: activeVehicle?.handle.capability.kind ?? null,
        flightModel: activeVehicle?.handle.capability.kind === 'aircraft'
          ? activeVehicle.handle.capability.flightModel ?? 'fixed-wing'
          : null,
        phase: vehicleState?.phase ?? null,
        safeExitMode: activeVehicle?.safeExitMode ?? null,
        driverId: activeVehicle ? multiplayerText.self.id : null,
        speedKph: round(Math.abs(vehicleState?.speed ?? 0) * 3.6),
        throttle: round(vehicleState?.throttle ?? 0),
        steering: round(vehicleState?.steering ?? 0),
        vertical: activeVehicle?.handle.capability.kind === 'aircraft'
          && activeVehicle.handle.capability.flightModel === 'rotorcraft'
          && vehicleState
          ? round(vehicleState.velocity.y / activeVehicle.handle.capability.physics.maxVerticalSpeed)
          : 0,
        grounded: vehicleState?.grounded ?? null,
        altitude: vehicleState ? round(vehicleState.position.y) : null,
        position: vehicleState
          ? { x: round(vehicleState.position.x), y: round(vehicleState.position.y), z: round(vehicleState.position.z) }
          : null,
        velocity: vehicleState
          ? { x: round(vehicleState.velocity.x), y: round(vehicleState.velocity.y), z: round(vehicleState.velocity.z) }
          : null,
        exitAllowed: vehicleExit?.allowed ?? false,
        exitReason: vehicleExit?.reason ?? null,
        persistence: activeVehicle?.handle.catalogId === 'code-celestial-riding-dragon'
          ? 'server-backed-parked-pose'
          : 'runtime-only',
      },
      diagnostics: {
        renderer: {
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          points: this.renderer.info.render.points,
          lines: this.renderer.info.render.lines,
          geometries: this.renderer.info.memory.geometries,
          textures: this.renderer.info.memory.textures,
          pixelRatio: this.renderer.getPixelRatio(),
        },
        physics: {
          engine: 'custom-fixed-step',
          timestep: FIXED_STEP,
          activeVehicleBodies: activeVehicle ? 1 : 0,
          colliders: this.colliders.length,
          sensors: 0,
          ccdBodies: 0,
        },
      },
      avatarWardrobe: {
        open: wardrobeOpen,
        context: wardrobeOpen ? wardrobeContext : null,
        selectedAvatarId: normalizeAvatarId(this.ui.avatarInput.value) || DEFAULT_AVATAR_ID,
        appliedAvatarId: normalizeAvatarId(this.save.settings.avatarId) || DEFAULT_AVATAR_ID,
        applying: this.profileApplying,
        presetIds: AVATAR_PRESETS.map((preset) => preset.id),
        accountAvatarIds: this.accountAvatars.map((avatar) => avatar.avatarId),
        previews: this.avatarPreviews.getTextState(),
        upload: {
          enabled: this.accountCanUploadAvatar(),
          phase: this.avatarUploadPhase,
          selectedFile: this.avatarUploadFile?.name ?? null,
          errorCode: this.avatarUploadErrorCode,
          uploadedAvatarId: this.uploadedAvatarId,
        },
      },
      nearbyInteraction:
        activeVehicle
          ? `正在驾驶 ${activeVehicle.handle.name}`
          : this.interactionTarget === 'terminal'
          ? '投币使用音乐自动贩卖机'
          : this.interactionTarget === 'gate'
            ? '选择归返之门去向'
            : this.interactionTarget === 'persistent-space-return'
              ? '返回原大厅'
            : this.interactionTarget?.label ?? null,
      availableActions:
        activeVehicle
          ? activeVehicle.handle.capability.kind === 'car'
            ? ['W/S 行驶', 'A/D 转向', 'Space 手刹', 'V 切换视角', '滚轮缩放', 'E 安全下车']
            : activeVehicle.handle.capability.flightModel === 'rotorcraft'
              ? ['W/S 前进/后退', 'A/D 转向', 'Space 上升', 'Shift/C 下降', 'V 切换视角', '滚轮缩放', 'E 落地停稳后下机']
              : ['W/S 调整油门', 'A/D 偏航', 'Space/Shift 俯仰', 'Q/C 翻滚', 'V 切换视角', '滚轮缩放', 'E 落地后下机']
          : wardrobeOpen
          ? ['旋转查看 3D 角色', '点击角色立即换装', '上传并预览 GLB 角色', 'P/Esc 关闭衣柜']
          : this.state === 'HUB_EDIT'
          ? ['WASD 自由飞行', 'Space 上升', 'Shift/C 下降', 'Ctrl 加速', '按住右键拖动观察', '拖放添加物件', '选择并拖动物件', '旋转', '缩放', '删除', '退出装修']
          : this.state === 'SCREEN_FOCUS'
          ? ['投币单人出发', '邀请在线玩家同行', '换一罐世界', '重播音乐', '返回房间']
          : this.state === 'DOOR_CHOICE'
            ? ['返回桌面', '继续漫游', '留在当前世界']
          : this.state === 'PAUSED'
              ? ['继续', ...(this.pausedFrom === 'HUB' ? [this.activePersistentSpace ? '装修空间' : '装修大厅'] : ['重置本关', '强制拔线']), '设置']
              : this.state === 'HUB'
                ? [`B ${this.activePersistentSpace ? '装修空间' : '装修大厅'}`, 'V 切换第一/第三人称', '滚轮缩放第三人称', 'P 更换形象', ...(this.interactionTarget ? ['E 交互'] : [])]
              : this.interactionTarget
                ? ['E 交互']
                : [],
      controls: wardrobeOpen
        ? 'rotating GLB previews, preset/account Avatar click changes immediately, signed-in player GLB upload, P/Esc closes wardrobe'
        : activeVehicle?.handle.capability.kind === 'car'
          ? 'W/S throttle, brake and reverse; A/D steer; Space handbrake; mouse look; V first/third person; wheel zoom; E exits only when slow and a safe landing spot exists'
          : activeVehicle?.handle.capability.kind === 'aircraft' && activeVehicle.handle.capability.flightModel === 'rotorcraft'
            ? 'W/S fly forward/back; A/D yaw; Space ascend; Shift/C descend; mouse look; V first/third person; wheel zoom; E exits only after landing and stopping'
          : activeVehicle?.handle.capability.kind === 'aircraft'
            ? 'W/S throttle up/down; A/D yaw; Space/Shift pitch; Q/C roll; mouse look; V first/third person; wheel zoom; E exits only after landing and stopping'
            : this.state === 'HUB_EDIT'
        ? `${CREATIVE_CAMERA_CONTROLS}, left mouse select/drag objects, B/Esc exit decoration, F fullscreen`
        : `WASD move, mouse look, mouse wheel zooms third person, Shift sprint, Space jump, E interact, B decorate ${this.activePersistentSpace ? 'persistent space' : 'shared lobby'}, V first/third person, P live Avatar wardrobe, Esc pause/back, F fullscreen`,
      lobbyEditor: this.lobbyEditor.getTextState(),
      creativeCamera: this.creativeCamera.getTextState(),
      multiplayer: multiplayerText,
    };

    if (!this.currentLevel && !this.activePersistentSpace) {
      const terminalDistance = lobbyPlayerEyePosition(this.playerPosition).distanceTo(this.terminalPosition);
      const vendingSnapshot = this.vendingMachine?.snapshot(this.simulationTime);
      const entrancePhase: 'idle' | 'coin' | 'playing' = vendingSnapshot?.phase === 'coin'
        ? 'coin'
        : vendingSnapshot?.phase === 'playing'
          ? 'playing'
          : 'idle';
      state.hub = {
        terminalDistance: round(terminalDistance),
        terminalInRange: terminalDistance <= 3.25,
        terminalPosition: { x: 0, y: 1.65, z: -6.72 },
        terminalFaces: '+Z toward hub spawn',
        entrance: {
          kind: 'music-vending-machine',
          phase: entrancePhase,
          musicPlaying: entrancePhase === 'coin' || entrancePhase === 'playing',
          audioActive: this.vendingMachineSynth.active,
          elapsedSeconds: round(vendingSnapshot?.elapsedSeconds ?? 0),
          beat: entrancePhase === 'playing' && typeof vendingSnapshot?.step === 'number'
            ? Math.floor(vendingSnapshot.step / 4)
            : null,
          bar: entrancePhase === 'playing' && typeof vendingSnapshot?.bar === 'number'
            ? vendingSnapshot.bar
            : null,
          activeSlots: entrancePhase === 'idle' ? [] : [...(vendingSnapshot?.activeSlots ?? [])],
          display: vendingSnapshot?.displayText ?? '- - -',
          reducedMotion: this.save.settings.reducedMotion,
        },
        selectedLevel: this.selectedLevel.id,
        registry: {
          loaded: this.registryLoaded,
          totalLevels: this.levelPool.length,
          communityLevels: this.levelPool.filter((level) => level.source === 'ugc').length,
          error: this.registryError,
        },
      };
    } else if (this.currentLevel) {
      const level = this.currentLevel;
      const remaining = level.timeLimit ? Math.max(0, level.timeLimit - this.levelElapsed) : null;
      state.level = {
        id: level.id,
        name: level.name,
        type: level.type,
        source: level.source ?? 'official',
        objective: this.dynamicObjective ?? level.objective,
        progress: this.getProgressText(),
        elapsedSeconds: round(this.levelElapsed),
        remainingSeconds: remaining === null ? null : round(remaining),
        deaths: this.levelDeaths,
        collectibles: this.collectibles.map((item) => {
          const itemPosition = item.mesh.getWorldPosition(new THREE.Vector3());
          return {
            id: item.id,
            x: round(itemPosition.x),
            y: round(itemPosition.y),
            z: round(itemPosition.z),
            collected: item.collected,
          };
        }),
        puzzleExpectedIndex: level.type === 'puzzle' ? this.puzzleExpectedIndex : null,
        activeFlags: [...this.puzzleFlags],
        colliders: this.colliders.slice(0, 18).map((collider) => {
          const center = collider.box.getCenter(new THREE.Vector3());
          const size = collider.box.getSize(new THREE.Vector3());
          return {
            x: round(center.x), y: round(center.y), z: round(center.z),
            sizeX: round(size.x), sizeY: round(size.y), sizeZ: round(size.z),
          };
        }),
        interactables: this.interactables.map((item) => {
          const itemPosition = item.object.getWorldPosition(new THREE.Vector3());
          return { label: item.label, x: round(itemPosition.x), y: round(itemPosition.y), z: round(itemPosition.z), enabled: item.enabled };
        }),
        goal: this.goalZone
          ? { x: round(this.goalZone.center.x), y: round(this.goalZone.center.y), z: round(this.goalZone.center.z) }
          : null,
        gate: this.gatePosition
          ? { x: round(this.gatePosition.x), y: round(this.gatePosition.y), z: round(this.gatePosition.z), available: this.doorAvailable }
          : null,
        ugc: level.source === 'ugc'
          ? {
            flags: [...this.puzzleFlags],
            targets: { down: this.dynamicTargetsDown, total: this.dynamicTargetsTotal },
            pressurePlates: (this.dynamicRuntime?.snapshot().pressurePlates ?? []).map((plate) => ({
              id: plate.id,
              flag: plate.flag,
              pressed: plate.pressed,
              x: round(plate.position[0]),
              y: round(plate.position[1]),
              z: round(plate.position[2]),
            })),
            runtimeLoaded: Boolean(this.dynamicHandle),
          }
          : undefined,
      };
    }
    return state;
  }

  private clearWorld(): void {
    if (this.creativeCamera.enabled) this.deactivateCreativeCamera();
    this.activeVehicle = null;
    this.lobbyMultiplayer.setLocalVehicleSafetyHold(false);
    this.pendingVehicleObjectId = null;
    this.vehicleSnapshots.clear();
    this.pendingVehicleSnapshotIds.clear();
    this.infernalPianoAudio?.leaveRealm();
    this.infernalPianoAudio?.dispose();
    this.infernalPianoAudio = null;
    this.infernalPianoInteractionSequence = 0;
    this.persistentPortalScene = null;
    this.stopVendingPerformance();
    this.vendingMachine?.dispose();
    this.lobbyMultiplayer.attachHub(null);
    this.lobbyEditor.detachHub();
    this.lobbyColliders.clear();
    if (this.dynamicHandle?.onDispose) {
      try {
        this.dynamicHandle.onDispose();
      } catch (error) {
        console.warn('[WhiteRoom] UGC onDispose failed', error);
      }
    }
    this.dynamicRuntime?.dispose();
    this.dynamicHandle = null;
    this.dynamicRuntime = null;
    this.dynamicTargetsTotal = 0;
    this.dynamicTargetsDown = 0;
    this.dynamicObjective = null;
    this.dynamicProgress = null;
    this.surviveElapsed = 0;
    if (this.worldRoot) {
      this.worldRoot.traverse((object) => {
        const renderable = object as THREE.Mesh;
        renderable.geometry?.dispose();
        const material = renderable.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      this.scene.remove(this.worldRoot);
    }
    while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0]!);
    this.worldRoot = new THREE.Group();
    this.worldRoot.name = 'ActiveWorld';
    this.scene.add(this.worldRoot);
    this.colliders.length = 0;
    this.collectibles.length = 0;
    this.interactables.length = 0;
    this.puzzleHeads.length = 0;
    this.puzzleFlags.clear();
    this.goalZone = null;
    this.gateGroup = null;
    this.gatePosition = null;
    this.doorAvailable = false;
    this.vendingMachine = null;
    this.interactionTarget = null;
    this.persistentSpaceReturnPosition = null;
  }

  private buildHubScene(): void {
    const preserveBoot = this.state === 'BOOT';
    const returningFromPersistentSpace = this.activePersistentSpace?.label ?? null;
    this.clearWorld();
    this.currentLevel = null;
    this.activePersistentSpace = null;
    if (this.lobbyChannel) {
      this.lobbyEditor.setChannel(this.lobbyChannel);
      this.lobbyMultiplayer.setLobbyChannel(this.lobbyChannel);
    }
    this.scene.background = new THREE.Color('#f7f7f5');
    this.scene.fog = new THREE.Fog('#f7f7f5', 42, 132);
    this.renderer.toneMappingExposure = 1.18;

    const hemi = new THREE.HemisphereLight('#ffffff', '#d7d9d5', 2.15);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fffdf5', 3.15);
    sun.position.set(-10, 18, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -58;
    sun.shadow.camera.right = 58;
    sun.shadow.camera.top = 58;
    sun.shadow.camera.bottom = -58;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 96;
    sun.shadow.bias = -0.00008;
    this.scene.add(sun);

    this.addBox([180, 0.2, 180], [0, -0.1, 0], '#f7f7f5', true, {
      roughness: 0.92,
      receiveShadow: true,
    });
    this.addHubTerminal();

    if (this.lobbyChannel) {
      this.lobbyEditor.attachHub(this.worldRoot!, { kind: 'lobby', label: '大厅' });
      this.lobbyMultiplayer.attachHub(this.scene);
    }

    this.playerPosition.set(0, 0.02, 4.2);
    this.playerVelocity.set(0, 0, 0);
    this.checkpoint.copy(this.playerPosition);
    this.yaw = 0;
    this.playerFacingYaw = this.yaw;
    this.pitch = -0.02;
    this.grounded = true;
    this.syncCamera();
    this.ui.objectiveCard.classList.add('hidden');
    this.ui.timerCard.classList.add('hidden');
    this.ui.door.classList.remove('visible');
    this.ui.pause.classList.remove('visible');
    this.ui.intro.classList.remove('visible');
    if (!preserveBoot) {
      this.state = 'HUB';
      this.ui.hud.classList.remove('hidden');
      this.showToast(
        returningFromPersistentSpace
          ? `已从${returningFromPersistentSpace}返回频道 ${this.lobbyChannel ?? ''}`
          : '连接已断开 · 已返回桌面',
        1600,
      );
    }
  }

  private buildPersistentSpaceScene(
    spaceId: PersistentSpaceId,
    label: string,
    stateChannel: PersistentSpaceChannel,
  ): void {
    if (!this.lobbyChannel || !isPersistentPortalSpaceId(spaceId)) {
      this.buildHubScene();
      this.showToast('共享空间连接失败 · 已返回大厅', 1800);
      return;
    }
    this.clearWorld();
    this.currentLevel = null;
    this.activePersistentSpace = {
      id: spaceId,
      label,
      stateChannel,
      returnChannel: this.lobbyChannel,
    };
    this.lobbyEditor.setChannel(stateChannel);
    this.lobbyMultiplayer.setLobbyChannel(stateChannel);

    const space = createPersistentPortalSpace(spaceId);
    this.persistentPortalScene = space;
    this.scene.background = space.background;
    this.scene.fog = space.fog;
    this.renderer.toneMappingExposure = space.exposure;
    this.worldRoot!.add(space.root);
    space.root.updateWorldMatrix(true, true);
    for (const object of space.colliders) {
      object.updateWorldMatrix(true, false);
      this.colliders.push({ object, box: new THREE.Box3().setFromObject(object) });
    }
    this.addPersistentSpaceReturnPortal(spaceId, space.returnPortal);

    this.lobbyEditor.attachHub(this.worldRoot!, {
      kind: 'persistent-space',
      label,
      placementSurfaces: space.placementSurfaces,
    });
    this.lobbyMultiplayer.attachHub(this.scene);
    this.playerPosition.set(...space.spawn);
    this.playerVelocity.set(0, 0, 0);
    this.checkpoint.copy(this.playerPosition);
    this.yaw = 0;
    this.playerFacingYaw = 0;
    this.pitch = -0.02;
    this.grounded = true;
    this.syncCamera();
    this.state = 'HUB';
    this.ui.hud.classList.remove('hidden');
    this.ui.objectiveCard.classList.add('hidden');
    this.ui.timerCard.classList.add('hidden');
    this.ui.door.classList.remove('visible');
    this.ui.pause.classList.remove('visible');
    this.ui.intro.classList.remove('visible');
    this.ui.clickHint.classList.remove('hidden');
    this.showToast(`已进入${label} · 空间状态会自动保存`, 2400);
    this.playTone(spaceId === 'heaven' ? 620 : 180, 0.24, 'sine');
  }

  private addPersistentSpaceReturnPortal(
    spaceId: PersistentSpaceId,
    position: readonly [number, number, number],
  ): void {
    const group = new THREE.Group();
    group.name = 'PersistentSpaceReturnPortal';
    group.position.set(...position);
    const color = spaceId === 'heaven' ? '#fff2b2' : '#ff5b2e';
    const glow = spaceId === 'heaven' ? '#d8f4ff' : '#ffb04f';
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(1.28, 0.09, 12, 56),
      new THREE.MeshStandardMaterial({
        color,
        emissive: glow,
        emissiveIntensity: 2.2,
        metalness: 0.5,
        roughness: 0.24,
      }),
    );
    outer.castShadow = true;
    group.add(outer);
    const veil = new THREE.Mesh(
      new THREE.CircleGeometry(1.18, 48),
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    veil.position.z = 0.025;
    group.add(veil);
    const light = new THREE.PointLight(glow, 10, 9, 2);
    light.position.z = 0.4;
    group.add(light);
    this.worldRoot!.add(group);
    this.persistentSpaceReturnPosition = group.position.clone();
  }

  private addHubTerminal(): void {
    const vendingMachine = new MusicVendingMachine();
    vendingMachine.setReducedMotion(this.save.settings.reducedMotion);
    vendingMachine.root.name = 'MusicVendingMachineEntrance';
    vendingMachine.root.position.set(0, 0, -7.42);
    this.worldRoot!.add(vendingMachine.root);
    vendingMachine.root.updateWorldMatrix(true, true);
    this.vendingMachine = vendingMachine;
    this.colliders.push({
      object: vendingMachine.root,
      box: vendingMachine.localCollider.clone().applyMatrix4(vendingMachine.root.matrixWorld),
    });
  }

  private updateLobbyCollider(id: string, object: THREE.Object3D | null, collidable: boolean): void {
    const previous = this.lobbyColliders.get(id) ?? [];
    if (previous.length > 0) {
      const previousSet = new Set(previous);
      for (let index = this.colliders.length - 1; index >= 0; index -= 1) {
        if (previousSet.has(this.colliders[index]!)) this.colliders.splice(index, 1);
      }
      this.lobbyColliders.delete(id);
    }
    if (!object || !collidable) return;
    const physics = this.lobbyEditor.getPhysicsPropHandle(id)?.physics;
    const colliders = lobbyPropPlayerColliderBoxes(object, physics)
      .filter((box) => !box.isEmpty())
      .map((box): Collider => ({ object, box }));
    if (colliders.length === 0) return;
    this.lobbyColliders.set(id, colliders);
    this.colliders.push(...colliders);
  }

  private addBox(
    size: [number, number, number],
    position: [number, number, number],
    color: string,
    collider = true,
    options: { roughness?: number; metalness?: number; emissive?: string; receiveShadow?: boolean } = {},
  ): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.72,
      metalness: options.metalness ?? 0.05,
      emissive: options.emissive ?? '#000000',
      emissiveIntensity: options.emissive ? 0.8 : 0,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    this.worldRoot!.add(mesh);
    if (collider) {
      mesh.updateWorldMatrix(true, false);
      this.colliders.push({ object: mesh, box: new THREE.Box3().setFromObject(mesh) });
    }
    return mesh;
  }

  private addWorldLights(sky: string, ground: string, sunColor: string, intensity = 2.2): void {
    this.scene.add(new THREE.HemisphereLight(sky, ground, 1.5));
    const sun = new THREE.DirectionalLight(sunColor, intensity);
    sun.position.set(-9, 17, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.00012;
    this.scene.add(sun);
  }

  private async loadDynamicLevel(registryLevel: LevelDefinition, reset: boolean): Promise<void> {
    const basePath = registryLevel.basePath ?? `/levels/${encodeURIComponent(registryLevel.id)}/`;
    const manifestResponse = await this.withTimeout(
      fetch(`${basePath}level.json`, { headers: { Accept: 'application/json' }, cache: 'no-store' }),
      7000,
      'level.json 加载超时',
    );
    if (!manifestResponse.ok) throw new Error(`level.json HTTP ${manifestResponse.status}`);
    const manifest = validateLevelManifest(await manifestResponse.json(), registryLevel.id);
    const level = manifestToLevel(manifest, basePath, registryLevel.contentHash);
    const entryUrl = new URL(`${basePath}${manifest.entry}`, window.location.origin);
    if (entryUrl.origin !== window.location.origin || !entryUrl.pathname.startsWith(new URL(basePath, window.location.origin).pathname)) {
      throw new Error('关卡 entry 越出包目录');
    }
    entryUrl.searchParams.set('v', registryLevel.contentHash ?? 'unversioned');
    const module = await this.withTimeout(
      import(/* @vite-ignore */ entryUrl.href) as Promise<{ default?: unknown }>,
      10_000,
      'main.js 加载超时',
    );
    if (typeof module.default !== 'function') throw new Error('main.js 必须 default export createLevel(sdk)');

    this.clearWorld();
    this.currentLevel = level;
    this.selectedLevel = level;
    this.dynamicTargetsTotal = 0;
    this.dynamicTargetsDown = 0;
    this.dynamicObjective = null;
    this.dynamicProgress = null;
    this.dynamicPendingWin = false;
    this.dynamicPendingFail = null;
    this.surviveElapsed = 0;
    this.renderer.toneMappingExposure = 1.02;
    this.levelElapsed = 0;
    this.levelDeaths = reset ? this.levelDeaths : 0;
    this.collectedCount = 0;
    this.puzzleExpectedIndex = 0;
    this.checkpointReached = false;
    this.resetHold = 0;
    this.completionRecorded = false;
    this.failNeedsReset = false;
    this.scene.background = new THREE.Color('#151923');
    this.scene.fog = new THREE.Fog('#151923', 28, 80);
    this.addWorldLights('#8d9cb0', '#151923', '#fff1ce', 2);

    this.playerPosition.set(...level.spawn);
    this.playerVelocity.set(0, 0, 0);
    this.checkpoint.copy(this.playerPosition);
    this.yaw = THREE.MathUtils.degToRad(level.yaw);
    this.playerFacingYaw = this.yaw;
    this.pitch = 0;
    this.grounded = true;
    this.coyoteTime = 0.1;

    const created = createUGCLevelSdk(this.createDynamicHost(), manifest);
    this.dynamicRuntime = created.runtime;
    const handle = await this.withTimeout(
      Promise.resolve((module.default as (sdk: Record<string, any>) => unknown)(created.sdk)),
      15_000,
      'createLevel(sdk) 执行超时',
    );
    if (handle !== undefined && (typeof handle !== 'object' || handle === null)) {
      throw new Error('createLevel 必须返回 LevelHandle 或 undefined');
    }
    this.dynamicHandle = (handle ?? {}) as UGCLevelHandle;

    const poolIndex = this.levelPool.findIndex((candidate) => candidate.id === level.id);
    if (poolIndex >= 0) this.levelPool[poolIndex] = level;
    if (!reset) {
      this.save.stats.totalDives += 1;
      this.save.recent.push(level.id);
      this.save.recent = this.save.recent.slice(-8);
      this.persistSave();
    }
    this.state = 'LEVEL_INTRO';
    this.introEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.45 : 2.35);
    this.ui.introType.textContent = `${level.typeLabel}世界 · 社区 UGC · 难度 ${difficultyStars(level.difficulty)}`;
    this.ui.introName.textContent = level.name;
    this.ui.introObjective.textContent = level.objective;
    this.ui.intro.classList.add('visible');
    this.ui.hud.classList.remove('hidden');
    this.ui.door.classList.remove('visible');
    this.ui.pause.classList.remove('visible');
    this.ui.clickHint.classList.remove('hidden');
    this.syncCamera();
    this.loadingDynamicLevel = false;
    this.playTone(420, 0.14, 'sine');
    this.playTone(630, 0.2, 'sine', 4);

    if (this.dynamicPendingWin) {
      this.dynamicPendingWin = false;
      this.completeLevel();
    } else {
      const pending = this.dynamicPendingFail as { reason: string; reset: boolean } | null;
      if (!pending) return;
      this.dynamicPendingFail = null;
      this.failLevel(pending.reason, pending.reset);
    }
  }

  private createDynamicHost(): UGCLevelHost {
    return {
      root: this.worldRoot!,
      addCollider: (object) => {
        if (this.colliders.some((collider) => collider.object === object)) return;
        object.updateWorldMatrix(true, true);
        this.colliders.push({ object, box: new THREE.Box3().setFromObject(object) });
      },
      addCollectible: (collectible) => this.collectibles.push(collectible),
      setGoalZone: (position, size) => {
        this.goalZone = {
          center: new THREE.Vector3(...position),
          size: new THREE.Vector3(...size),
          reached: false,
        };
      },
      addInteractable: (interactable) => this.interactables.push(interactable),
      setFlag: (name, value) => this.setDynamicFlag(name, value),
      getFlag: (name) => this.puzzleFlags.has(name),
      complete: () => {
        if (this.currentLevel?.type !== 'custom') {
          console.warn('[WhiteRoom] state.complete()/win() 仅对 custom 关卡有效');
          return;
        }
        if (this.loadingDynamicLevel) this.dynamicPendingWin = true;
        else this.completeLevel();
      },
      fail: (reason, reset) => {
        if (this.loadingDynamicLevel) this.dynamicPendingFail = { reason, reset };
        else this.failLevel(reason, reset);
      },
      teleport: (position, yawDeg, checkpoint) => {
        if (position.some((value) => !Number.isFinite(value))) throw new Error('player position 必须是有限数字');
        this.playerPosition.set(...position);
        this.playerVelocity.set(0, 0, 0);
        if (yawDeg !== undefined) {
          this.yaw = THREE.MathUtils.degToRad(yawDeg);
          this.playerFacingYaw = this.yaw;
        }
        if (checkpoint) this.checkpoint.copy(this.playerPosition);
        this.syncCamera();
      },
      setCheckpoint: (position, yawDeg) => {
        this.checkpoint.copy(position ? new THREE.Vector3(...position) : this.playerPosition);
        if (yawDeg !== undefined) {
          this.yaw = THREE.MathUtils.degToRad(yawDeg);
          this.playerFacingYaw = this.yaw;
        }
        this.showToast('检查点已同步', 1200);
      },
      setBackground: (value) => this.setDynamicBackground(value),
      setFog: (color, near, far) => {
        if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) throw new Error('env.setFog 参数无效');
        this.scene.fog = new THREE.Fog(color, near, far);
      },
      addSun: (options = {}) => {
        const sun = new THREE.DirectionalLight(options.color ?? '#fff5d9', options.intensity ?? 2);
        sun.position.set(...(options.direction ?? [-8, 15, 9]));
        sun.castShadow = options.castShadow ?? true;
        sun.shadow.mapSize.set(1024, 1024);
        this.scene.add(sun);
        return sun;
      },
      setAmbient: (color, intensity) => {
        this.scene.add(new THREE.AmbientLight(color, clamp(intensity, 0, 10)));
      },
      setObjective: (text) => {
        this.dynamicObjective = String(text).slice(0, 80);
        if (this.currentLevel) this.currentLevel.objective = this.dynamicObjective;
      },
      setProgress: (text) => { this.dynamicProgress = String(text).slice(0, 100); },
      toast: (text, ms) => this.showToast(String(text).slice(0, 180), ms ?? 1800),
      getPlayerPosition: () => this.playerPosition.clone(),
      registerTarget: () => { this.dynamicTargetsTotal += 1; },
      downTarget: () => {
        this.dynamicTargetsDown += 1;
        if (
          this.currentLevel?.type === 'eliminate' &&
          this.dynamicTargetsTotal > 0 &&
          this.dynamicTargetsDown >= this.dynamicTargetsTotal
        ) this.completeLevel();
      },
    };
  }

  private setDynamicFlag(name: string, value: boolean): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('flag 名称无效');
    if (value) this.puzzleFlags.add(name);
    else this.puzzleFlags.delete(name);
    const level = this.currentLevel;
    if (level?.type === 'puzzle' && level.flags?.every((flag) => this.puzzleFlags.has(flag))) {
      if (this.loadingDynamicLevel) this.dynamicPendingWin = true;
      else this.completeLevel();
    }
  }

  private setDynamicBackground(value: string): void {
    const presets: Record<string, string> = {
      white: '#f7f7f5',
      dawn: '#e7b893',
      night: '#10152c',
      void: '#050609',
    };
    const color = presets[value] ?? value;
    this.scene.background = new THREE.Color(color);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer = 0;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  private buildLevelScene(level: LevelDefinition, reset: boolean): void {
    this.clearWorld();
    this.currentLevel = level;
    this.selectedLevel = level;
    this.renderer.toneMappingExposure = 1.02;
    this.levelElapsed = 0;
    this.levelDeaths = reset ? this.levelDeaths : 0;
    this.collectedCount = 0;
    this.puzzleExpectedIndex = 0;
    this.checkpointReached = false;
    this.resetHold = 0;
    this.completionRecorded = false;
    this.failNeedsReset = false;

    if (level.type === 'reach_zone') this.buildParkourLevel();
    else if (level.type === 'collect') this.buildCollectLevel();
    else this.buildPuzzleLevel();

    this.playerPosition.set(...level.spawn);
    this.playerVelocity.set(0, 0, 0);
    this.checkpoint.copy(this.playerPosition);
    this.yaw = THREE.MathUtils.degToRad(level.yaw);
    this.playerFacingYaw = this.yaw;
    this.pitch = 0;
    this.grounded = true;
    this.coyoteTime = 0.1;
    this.syncCamera();

    if (!reset) {
      this.save.stats.totalDives += 1;
      this.save.recent.push(level.id);
      this.save.recent = this.save.recent.slice(-8);
      this.persistSave();
    }

    this.state = 'LEVEL_INTRO';
    this.introEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.45 : 2.35);
    this.ui.introType.textContent = `${level.typeLabel}世界 · 难度 ${difficultyStars(level.difficulty)}`;
    this.ui.introName.textContent = level.name;
    this.ui.introObjective.textContent = level.objective;
    this.ui.intro.classList.add('visible');
    this.ui.hud.classList.remove('hidden');
    this.ui.door.classList.remove('visible');
    this.ui.pause.classList.remove('visible');
    this.ui.clickHint.classList.remove('hidden');
    this.playTone(420, 0.14, 'sine');
    this.playTone(630, 0.2, 'sine', 4);
  }

  private buildParkourLevel(): void {
    this.scene.background = new THREE.Color('#92d9e8');
    this.scene.fog = new THREE.Fog('#92d9e8', 18, 74);
    this.addWorldLights('#d8fbff', '#33475a', '#fff0c5', 2.45);

    const mist = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshBasicMaterial({ color: '#c7eef4', transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
    );
    mist.rotation.x = -Math.PI / 2;
    mist.position.y = -5.2;
    this.worldRoot!.add(mist);

    const platforms: Array<[[number, number, number], [number, number, number]]> = [
      [[10, 1, 10], [0, -0.5, 5]],
      [[4.2, 0.6, 3.2], [-1.8, 0.3, -2.1]],
      [[3.8, 0.6, 3.1], [1.7, 0.75, -6.2]],
      [[3.8, 0.6, 3.1], [-1.6, 1.2, -10.3]],
      [[3.8, 0.6, 3.1], [1.65, 1.65, -14.4]],
      [[5.2, 0.6, 4], [0, 2.1, -18.7]],
      [[8, 0.8, 7.2], [0, 2.4, -24.6]],
    ];
    platforms.forEach(([size, position], index) => {
      const mesh = this.addBox(size, position, index === platforms.length - 1 ? '#213f57' : '#315f78', true, {
        roughness: 0.48,
        metalness: 0.22,
      });
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: index === platforms.length - 1 ? '#fff0b4' : '#7ae7e1', transparent: true, opacity: 0.7 }),
      );
      mesh.add(edges);
    });

    for (let index = 0; index < 18; index += 1) {
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18 + (index % 4) * 0.05, 0),
        new THREE.MeshStandardMaterial({
          color: index % 3 === 0 ? '#ffe5a2' : '#72dcd8',
          emissive: index % 3 === 0 ? '#a56a20' : '#176e73',
          emissiveIntensity: 0.6,
          roughness: 0.28,
        }),
      );
      const side = index % 2 === 0 ? -1 : 1;
      shard.position.set(side * (5.5 + (index % 5) * 1.3), -1 + (index % 4) * 1.5, 4 - index * 1.9);
      shard.rotation.set(index * 0.4, index * 0.7, index * 0.2);
      shard.userData.floatPhase = index * 0.61;
      shard.userData.baseY = shard.position.y;
      this.worldRoot!.add(shard);
    }

    const beacon = new THREE.Group();
    beacon.position.set(0, 4.05, -25.5);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#fff1b8', transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.065, 12, 48), ringMaterial);
    beacon.add(ring);
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(1.18, 48),
      new THREE.MeshBasicMaterial({ color: '#eaffff', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    inner.position.z = 0.03;
    beacon.add(inner);
    const light = new THREE.PointLight('#ffe7a0', 16, 12, 2);
    beacon.add(light);
    beacon.userData.beacon = true;
    this.worldRoot!.add(beacon);
    this.goalZone = {
      center: new THREE.Vector3(0, 3.8, -25.2),
      size: new THREE.Vector3(4, 3.4, 4),
      reached: false,
    };
  }

  private buildCollectLevel(): void {
    this.scene.background = new THREE.Color('#12152d');
    this.scene.fog = new THREE.Fog('#12152d', 24, 58);
    this.addWorldLights('#6b5b98', '#130d23', '#f4d8ff', 2.1);
    this.addBox([30, 1, 30], [0, -0.5, 0], '#27284b', true, { roughness: 0.76, metalness: 0.12 });

    const rimMaterial = new THREE.MeshStandardMaterial({ color: '#493c70', emissive: '#271d4a', emissiveIntensity: 0.5, roughness: 0.48 });
    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2;
      const radius = 12.5 + Math.sin(index * 2.2) * 0.8;
      const height = 1.8 + (index % 4) * 0.65;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.38, height, 6), rimMaterial.clone());
      stem.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
      stem.rotation.y = angle;
      stem.castShadow = true;
      stem.userData.floatPhase = index * 0.44;
      this.worldRoot!.add(stem);
    }

    const arches: Array<[number, number, number, number]> = [
      [-7, 0, 0, Math.PI / 2],
      [7, 0, 0, Math.PI / 2],
      [0, 0, -7, 0],
    ];
    arches.forEach(([x, y, z, rotation]) => {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = rotation;
      const left = this.makeBoxMesh([0.45, 3.5, 0.7], [-1.65, 1.75, 0], '#4a426a');
      const right = this.makeBoxMesh([0.45, 3.5, 0.7], [1.65, 1.75, 0], '#4a426a');
      const top = this.makeBoxMesh([3.75, 0.45, 0.7], [0, 3.35, 0], '#5b4f7f');
      group.add(left, right, top);
      this.worldRoot!.add(group);
      group.updateWorldMatrix(true, true);
      [left, right, top].forEach((part) => {
        part.updateWorldMatrix(true, false);
        this.colliders.push({ object: part, box: new THREE.Box3().setFromObject(part) });
      });
    });

    const positions: Array<[number, number, number]> = [
      [0, 1.25, 4.2],
      [7.2, 1.25, 6.2],
      [-7.4, 1.25, 3.2],
      [8.4, 1.25, -4.6],
      [-8.1, 1.25, -5.2],
      [0, 1.25, -9.2],
    ];
    positions.forEach((position, index) => this.addCollectible(`memory-${index + 1}`, position, index));

    const centerRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.045, 8, 64),
      new THREE.MeshBasicMaterial({ color: '#a98ae3', transparent: true, opacity: 0.62 }),
    );
    centerRing.rotation.x = Math.PI / 2;
    centerRing.position.y = 0.025;
    this.worldRoot!.add(centerRing);
  }

  private addCollectible(id: string, position: [number, number, number], index: number): void {
    const group = new THREE.Group();
    group.position.set(...position);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: index % 2 === 0 ? '#f8d7ff' : '#9fe7ef',
      emissive: index % 2 === 0 ? '#b04fc2' : '#30a6ba',
      emissiveIntensity: 2.4,
      roughness: 0.18,
      metalness: 0.1,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), coreMaterial);
    core.castShadow = true;
    group.add(core);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.025, 8, 40),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? '#f4bfff' : '#8ef4ed', transparent: true, opacity: 0.75 }),
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    const glow = new THREE.PointLight(index % 2 === 0 ? '#d17add' : '#65dfd6', 5, 4, 2);
    group.add(glow);
    group.userData.floatPhase = index * 0.9;
    this.worldRoot!.add(group);
    this.collectibles.push({ id, mesh: group, baseY: position[1], collected: false });
  }

  private buildPuzzleLevel(): void {
    this.scene.background = new THREE.Color('#0f1218');
    this.scene.fog = new THREE.Fog('#0f1218', 20, 50);
    this.addWorldLights('#758093', '#11131a', '#fff1c4', 2.25);
    this.addBox([24, 1, 24], [0, -0.5, 0], '#242a31', true, { roughness: 0.62, metalness: 0.25 });
    this.addBox([24, 4, 0.6], [0, 2, -12], '#1b2026', true, { roughness: 0.7 });
    this.addBox([0.6, 4, 24], [-12, 2, 0], '#1b2026', true, { roughness: 0.7 });
    this.addBox([0.6, 4, 24], [12, 2, 0], '#1b2026', true, { roughness: 0.7 });

    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.55, 0.38, 32),
      new THREE.MeshStandardMaterial({ color: '#313941', roughness: 0.48, metalness: 0.4 }),
    );
    dais.position.y = 0.19;
    dais.castShadow = true;
    dais.receiveShadow = true;
    this.worldRoot!.add(dais);
    dais.updateWorldMatrix(true, false);
    this.colliders.push({ object: dais, box: new THREE.Box3().setFromObject(dais) });

    const clueColors = ['#f0bf56', '#55d7d1', '#9367da'];
    clueColors.forEach((color, index) => {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.04, 1.5),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.25 }),
      );
      tile.position.set((index - 1) * 1.15, 0.43, 0);
      this.worldRoot!.add(tile);
    });

    const stations: Array<{ position: [number, number, number]; color: string; label: string }> = [
      { position: [-6.2, 0, -2], color: '#f0bf56', label: '激活金相信号' },
      { position: [0, 0, -8], color: '#55d7d1', label: '激活青相信号' },
      { position: [6.2, 0, -2], color: '#9367da', label: '激活紫相信号' },
    ];
    stations.forEach((station, index) => this.addPuzzleStation(station.position, station.color, station.label, index));

    const beams = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 5, 6),
        new THREE.MeshBasicMaterial({ color: clueColors[index], transparent: true, opacity: 0.34 }),
      );
      beam.position.set((index - 1) * 0.8, 2.8, 0);
      beams.add(beam);
    }
    this.worldRoot!.add(beams);
    this.showToast('中央投影显示：金 → 青 → 紫', 3200);
  }

  private addPuzzleStation(
    position: [number, number, number],
    color: string,
    label: string,
    index: number,
  ): void {
    const group = new THREE.Group();
    group.position.set(...position);
    const base = this.makeBoxMesh([1.8, 0.3, 1.8], [0, 0.15, 0], '#30363d');
    const stem = this.makeBoxMesh([0.75, 1.15, 0.75], [0, 0.86, 0], '#414850');
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.48, roughness: 0.25, metalness: 0.36 });
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 0), material);
    head.position.set(0, 1.75, 0);
    head.castShadow = true;
    head.userData.baseColor = color;
    group.add(base, stem, head);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.035, 8, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 }),
    );
    ring.position.y = 1.75;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    this.worldRoot!.add(group);
    group.updateWorldMatrix(true, true);
    this.colliders.push({ object: group, box: new THREE.Box3().setFromObject(group) });
    this.puzzleHeads.push(head);
    this.interactables.push({
      id: `puzzle-station-${index}`,
      object: head,
      label,
      maxDistance: 3.2,
      enabled: true,
      onUse: () => this.pressPuzzleStation(index),
    });
  }

  private makeBoxMesh(size: [number, number, number], position: [number, number, number], color: string): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.64, metalness: 0.16 }),
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private updatePlayer(dt: number): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.grounded) this.coyoteTime = 0.1;
    else this.coyoteTime = Math.max(0, this.coyoteTime - dt);

    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const rightInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.movementInputActive = resolveAvatarAnimationMode(
      forwardInput,
      rightInput,
      this.state === 'HUB' && !this.currentLevel,
    ) === 'running';
    const moveDirection = cameraRelativeMovement(forwardInput, rightInput, this.yaw);
    const move = new THREE.Vector3(moveDirection.x, 0, moveDirection.z);
    if (forwardInput !== 0 || rightInput !== 0) {
      const targetFacingYaw = movementFacingYaw(move.x, move.z, this.playerFacingYaw);
      this.playerFacingYaw = interpolateYaw(this.playerFacingYaw, targetFacingYaw, 1 - Math.exp(-14 * dt));
    }

    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 7 : 4.5;
    const targetX = move.x * speed;
    const targetZ = move.z * speed;
    const acceleration = this.grounded ? 18 : 7.5;
    const blend = 1 - Math.exp(-acceleration * dt);
    this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetX, blend);
    this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetZ, blend);

    if (this.jumpBuffer > 0 && this.coyoteTime > 0) {
      this.playerVelocity.y = 7;
      this.grounded = false;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      this.playTone(160, 0.08, 'triangle');
    }

    this.playerVelocity.y -= 20 * dt;

    const xCandidate = this.playerPosition.clone();
    xCandidate.x += this.playerVelocity.x * dt;
    this.resolveHorizontalAxis(xCandidate, 'x');
    this.playerPosition.x = xCandidate.x;

    const zCandidate = this.playerPosition.clone();
    zCandidate.z += this.playerVelocity.z * dt;
    this.resolveHorizontalAxis(zCandidate, 'z');
    this.playerPosition.z = zCandidate.z;

    const oldY = this.playerPosition.y;
    let nextY = oldY + this.playerVelocity.y * dt;
    let floorY = Number.NEGATIVE_INFINITY;
    let ceilingY = Number.POSITIVE_INFINITY;
    this.grounded = false;

    for (const collider of this.colliders) {
      const box = collider.box;
      const insideHorizontal =
        this.playerPosition.x >= box.min.x - PLAYER_RADIUS &&
        this.playerPosition.x <= box.max.x + PLAYER_RADIUS &&
        this.playerPosition.z >= box.min.z - PLAYER_RADIUS &&
        this.playerPosition.z <= box.max.z + PLAYER_RADIUS;
      if (!insideHorizontal) continue;

      if (this.playerVelocity.y <= 0 && oldY >= box.max.y - 0.08 && nextY <= box.max.y + 0.04) {
        floorY = Math.max(floorY, box.max.y);
      }
      const oldHead = oldY + PLAYER_HEIGHT;
      const nextHead = nextY + PLAYER_HEIGHT;
      if (this.playerVelocity.y > 0 && oldHead <= box.min.y + 0.04 && nextHead >= box.min.y) {
        ceilingY = Math.min(ceilingY, box.min.y);
      }
    }

    if (floorY > Number.NEGATIVE_INFINITY) {
      nextY = floorY + 0.002;
      this.playerVelocity.y = 0;
      this.grounded = true;
    } else {
      const hubGround = resolveHubInfiniteGround({
        x: this.playerPosition.x,
        y: nextY,
        z: this.playerPosition.z,
      }, this.playerVelocity.y, Boolean(this.currentLevel || this.activePersistentSpace));
      if (hubGround.grounded) {
        nextY = hubGround.position.y;
        this.playerVelocity.y = hubGround.verticalVelocity;
        this.grounded = true;
      } else if (ceilingY < Number.POSITIVE_INFINITY) {
        nextY = ceilingY - PLAYER_HEIGHT - 0.002;
        this.playerVelocity.y = Math.min(0, this.playerVelocity.y);
      }
    }
    this.playerPosition.y = nextY;

    const horizontalSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    if (this.grounded && horizontalSpeed > 0.35) this.bobTime += dt * (this.keys.has('ShiftLeft') ? 11 : 8.2);
    this.syncCamera();
  }

  private resolveHorizontalAxis(candidate: THREE.Vector3, axis: 'x' | 'z'): void {
    for (const collider of this.colliders) {
      const box = collider.box;
      const overlapsVertically =
        candidate.y + PLAYER_HEIGHT > box.min.y + 0.04 && candidate.y < box.max.y - 0.035;
      if (!overlapsVertically) continue;
      const insideX = candidate.x > box.min.x - PLAYER_RADIUS && candidate.x < box.max.x + PLAYER_RADIUS;
      const insideZ = candidate.z > box.min.z - PLAYER_RADIUS && candidate.z < box.max.z + PLAYER_RADIUS;
      if (!insideX || !insideZ) continue;

      const stepHeight = box.max.y - candidate.y;
      if (stepHeight >= -0.03 && stepHeight <= 0.35 && this.playerVelocity.y <= 0.1) {
        candidate.y = box.max.y + 0.003;
        this.playerPosition.y = candidate.y;
        this.grounded = true;
        continue;
      }

      if (axis === 'x') {
        if (this.playerVelocity.x > 0) candidate.x = box.min.x - PLAYER_RADIUS - 0.002;
        else if (this.playerVelocity.x < 0) candidate.x = box.max.x + PLAYER_RADIUS + 0.002;
        this.playerVelocity.x = 0;
      } else {
        if (this.playerVelocity.z > 0) candidate.z = box.min.z - PLAYER_RADIUS - 0.002;
        else if (this.playerVelocity.z < 0) candidate.z = box.max.z + PLAYER_RADIUS + 0.002;
        this.playerVelocity.z = 0;
      }
    }
  }

  private syncCamera(): void {
    if (this.state === 'HUB_EDIT' && this.creativeCamera.enabled) {
      this.creativeCamera.apply(this.camera);
      return;
    }
    if (this.activeVehicle) {
      this.syncVehicleCamera(this.activeVehicle);
      return;
    }
    const moving = this.grounded && Math.hypot(this.playerVelocity.x, this.playerVelocity.z) > 0.35;
    const bobAmount = this.save.settings.headBob && moving ? 0.025 : 0;
    const bobY = Math.abs(Math.sin(this.bobTime)) * bobAmount;
    const bobX = Math.cos(this.bobTime * 0.5) * bobAmount * 0.35;
    this.camera.position.set(this.playerPosition.x + bobX, this.playerPosition.y + EYE_HEIGHT + bobY, this.playerPosition.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    if (!this.currentLevel && (
      this.state === 'HUB'
      || this.state === 'HUB_EDIT'
      || (this.state === 'PAUSED' && this.pausedFrom === 'HUB')
    )) {
      this.lobbyMultiplayer.applyThirdPersonCamera(this.camera, this.playerPosition, this.pitch, this.yaw, this.colliders);
    }
  }

  private updateInteractionTarget(): void {
    if (this.activeVehicle) {
      this.interactionTarget = null;
      this.setVehiclePrompt(this.activeVehicle);
      return;
    }
    this.interactionTarget = null;
    const cameraForward = new THREE.Vector3();
    this.camera.getWorldDirection(cameraForward);
    const playerEye = lobbyPlayerEyePosition(this.playerPosition);

    if (this.state === 'HUB') {
      if (this.activePersistentSpace && this.persistentSpaceReturnPosition) {
        const toReturnPortal = this.persistentSpaceReturnPosition.clone().sub(playerEye);
        const distance = toReturnPortal.length();
        const facing = distance > 0 ? toReturnPortal.normalize().dot(cameraForward) : 1;
        if (distance <= 3.3 && facing > 0.28) this.interactionTarget = 'persistent-space-return';
      } else {
        const toTerminal = this.terminalPosition.clone().sub(playerEye);
        const distance = toTerminal.length();
        const facing = distance > 0 ? toTerminal.normalize().dot(cameraForward) : 1;
        if (distance <= 3.25 && facing > 0.42) this.interactionTarget = 'terminal';
      }
      if (!this.interactionTarget) this.interactionTarget = this.lobbyEditor.getInteraction(this.camera, playerEye);
    } else if (this.state === 'LEVEL_COMPLETE' && this.gatePosition) {
      const toGate = this.gatePosition.clone().sub(this.camera.position);
      const distance = toGate.length();
      const facing = distance > 0 ? toGate.normalize().dot(cameraForward) : 1;
      if (distance <= 2.8 && facing > -0.15) this.interactionTarget = 'gate';
      if (distance <= 0.95 && this.doorAvailable) this.openDoorChoice();
    }

    if (!this.interactionTarget && this.currentLevel && (this.state === 'LEVEL_PLAYING' || this.state === 'LEVEL_INTRO')) {
      let bestScore = Number.POSITIVE_INFINITY;
      for (const item of this.interactables) {
        if (!item.enabled) continue;
        const worldPosition = item.object.getWorldPosition(new THREE.Vector3());
        const toItem = worldPosition.sub(this.camera.position);
        const distance = toItem.length();
        if (distance > item.maxDistance || distance <= 0.001) continue;
        const facing = toItem.normalize().dot(cameraForward);
        if (facing < 0.46) continue;
        const score = distance - facing * 0.8;
        if (score < bestScore) {
          bestScore = score;
          this.interactionTarget = item;
        }
      }
    }

    if (this.interactionTarget === 'terminal') this.setInteractionPrompt('E · 投币选关');
    else if (this.interactionTarget === 'gate') this.setInteractionPrompt('E · 选择去向');
    else if (this.interactionTarget === 'persistent-space-return') this.setInteractionPrompt('E · 返回原大厅');
    else if (this.interactionTarget) this.setInteractionPrompt(`E · ${this.interactionTarget.label}`);
    else this.setInteractionPrompt(null);
  }

  private setInteractionPrompt(text: string | null): void {
    this.ui.prompt.classList.toggle('hidden', text === null);
    this.ui.crosshair.classList.toggle('active', text !== null);
    if (text) this.ui.prompt.textContent = text;
  }

  private useInteraction(): void {
    if (this.activeVehicle) {
      this.requestVehicleExit();
    } else if (this.interactionTarget === 'terminal') {
      this.focusTerminal();
    } else if (this.interactionTarget === 'gate') {
      this.openDoorChoice();
    } else if (this.interactionTarget === 'persistent-space-return') {
      this.leavePersistentSpace();
    } else if (this.interactionTarget) {
      try {
        this.interactionTarget.onUse();
      } catch (error) {
        if (this.currentLevel?.source === 'ugc') this.handleDynamicRuntimeError(error);
        else throw error;
      }
    }
  }

  private leavePersistentSpace(): void {
    const space = this.activePersistentSpace;
    if (!space || this.state !== 'HUB' || this.transition) return;
    this.showToast(`正在离开${space.label} · 已保存空间状态`, 1100);
    this.beginTransition({ kind: 'hub' });
  }

  private pressPuzzleStation(index: number): void {
    const level = this.currentLevel;
    if (!level || level.type !== 'puzzle' || this.state === 'LEVEL_COMPLETE') return;
    if (index === this.puzzleExpectedIndex) {
      const flag = level.flags?.[index];
      if (!flag) return;
      this.puzzleFlags.add(flag);
      this.puzzleExpectedIndex += 1;
      const material = this.puzzleHeads[index]?.material as THREE.MeshStandardMaterial | undefined;
      if (material) {
        material.color.set('#dfffe4');
        material.emissive.set('#68ff96');
        material.emissiveIntensity = 2.2;
      }
      this.playTone(360 + index * 145, 0.17, 'sine');
      if (this.puzzleExpectedIndex >= (level.flags?.length ?? 0)) {
        this.showToast('三相同步完成', 1700);
        this.completeLevel();
      } else {
        const next = ['金相', '青相', '紫相'][this.puzzleExpectedIndex] ?? '下一节点';
        this.showToast(`同步成功 · 下一节点：${next}`, 1400);
      }
    } else {
      this.puzzleExpectedIndex = 0;
      this.puzzleFlags.clear();
      this.puzzleHeads.forEach((head) => {
        const material = head.material as THREE.MeshStandardMaterial;
        const baseColor = head.userData.baseColor as string;
        material.color.set(baseColor);
        material.emissive.set(baseColor);
        material.emissiveIntensity = 0.48;
      });
      this.playTone(112, 0.24, 'sawtooth');
      this.showToast('相位冲突 · 协议已重置（提示：金 → 青 → 紫）', 2400);
    }
  }

  private updateLevel(dt: number): void {
    this.animateLevelObjects(dt);
    const level = this.currentLevel;
    if (!level || (this.state !== 'LEVEL_PLAYING' && this.state !== 'LEVEL_INTRO')) return;

    if (level.source === 'ugc') {
      try {
        this.dynamicRuntime?.update();
        this.dynamicHandle?.onUpdate?.(dt, this.levelElapsed);
      } catch (error) {
        this.handleDynamicRuntimeError(error);
        return;
      }
      if (this.state !== 'LEVEL_PLAYING' && this.state !== 'LEVEL_INTRO') return;
    }

    if (level.type === 'collect') {
      const playerCenter = this.playerPosition.clone().add(new THREE.Vector3(0, 0.9, 0));
      for (const item of this.collectibles) {
        if (item.collected || !item.mesh.visible) continue;
        const itemPosition = item.mesh.getWorldPosition(new THREE.Vector3());
        if (playerCenter.distanceTo(itemPosition) <= 1.25) {
          item.collected = true;
          item.mesh.visible = false;
          this.collectedCount += 1;
          this.playTone(520 + this.collectedCount * 42, 0.16, 'sine');
          this.showToast(`收集进度 ${this.collectedCount}/${level.required ?? 0}`, 1100);
          if (item.onCollect) {
            try {
              item.onCollect();
            } catch (error) {
              this.handleDynamicRuntimeError(error);
              return;
            }
          }
          if (this.collectedCount >= (level.required ?? Number.POSITIVE_INFINITY)) this.completeLevel();
        }
      }
    }

    if (level.type === 'reach_zone' || level.type === 'escape') {
      if (level.source !== 'ugc' && !this.checkpointReached && this.playerPosition.z < -9 && this.playerPosition.y > 1.15) {
        this.checkpointReached = true;
        this.checkpoint.set(-1.6, 1.503, -10.3);
        this.playTone(470, 0.12, 'triangle');
        this.showToast('中继点已同步', 1500);
      }
      const escapeUnlocked = level.type !== 'escape' || Boolean(level.flags?.every((flag) => this.puzzleFlags.has(flag)));
      if (escapeUnlocked && this.goalZone && !this.goalZone.reached) {
        const center = this.playerPosition.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.5, 0));
        const half = this.goalZone.size.clone().multiplyScalar(0.5);
        const offset = center.sub(this.goalZone.center);
        if (Math.abs(offset.x) <= half.x && Math.abs(offset.y) <= half.y && Math.abs(offset.z) <= half.z) {
          this.goalZone.reached = true;
          this.completeLevel();
        }
      }
    }

    if (level.type === 'survive' && this.state === 'LEVEL_PLAYING') {
      this.surviveElapsed += dt;
      if (this.surviveElapsed >= (level.duration ?? Number.POSITIVE_INFINITY)) this.completeLevel();
    }
  }

  private handleDynamicRuntimeError(error: unknown): void {
    const levelId = this.currentLevel?.id;
    if (levelId) this.failedDynamicLevels.add(levelId);
    console.error('[WhiteRoom] UGC runtime crashed', error);
    this.showToast('该世界已崩溃 · 正在安全返回桌面', 2600);
    this.beginTransition({ kind: 'hub' });
  }

  private animateLevelObjects(dt: number): void {
    for (const item of this.collectibles) {
      if (item.collected) continue;
      item.mesh.rotation.y += dt * 0.9;
      const phase = typeof item.mesh.userData.floatPhase === 'number' ? item.mesh.userData.floatPhase as number : 0;
      item.mesh.position.y = item.baseY + Math.sin(this.simulationTime * 1.8 + phase) * 0.16;
    }
    this.puzzleHeads.forEach((head, index) => {
      head.rotation.y += dt * (0.65 + index * 0.1);
      head.rotation.x = Math.sin(this.simulationTime * 0.7 + index) * 0.15;
    });
    this.worldRoot?.traverse((object) => {
      if (object.userData.beacon) {
        object.rotation.z = Math.sin(this.simulationTime * 0.7) * 0.08;
        object.rotation.y += dt * 0.25;
      } else if (typeof object.userData.floatPhase === 'number' && typeof object.userData.baseY === 'number') {
        object.position.y = (object.userData.baseY as number) + Math.sin(this.simulationTime + (object.userData.floatPhase as number)) * 0.22;
        object.rotation.y += dt * 0.18;
      }
    });
  }

  private completeLevel(): void {
    const level = this.currentLevel;
    if (!level || this.state === 'LEVEL_COMPLETE' || this.state === 'DOOR_CHOICE') return;
    this.state = 'LEVEL_COMPLETE';
    this.playerVelocity.multiplyScalar(0.2);
    this.ui.intro.classList.remove('visible');
    this.playTone(440, 0.16, 'sine');
    this.playTone(660, 0.3, 'sine');
    this.showToast('世界条件已满足 · 归返之门正在建立', 2500);
    this.recordCompletion();
    this.createReturnGate();
  }

  private recordCompletion(): void {
    const level = this.currentLevel;
    if (!level || this.completionRecorded) return;
    this.completionRecorded = true;
    this.save.history.push({
      id: level.id,
      completedAt: Date.now(),
      timeMs: Math.round(this.levelElapsed * 1000),
      result: 'complete',
    });
    this.save.history = this.save.history.slice(-100);
    this.save.stats.totalCompleted += 1;
    this.persistSave();
  }

  private createReturnGate(): void {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const basePosition = this.playerPosition.clone().addScaledVector(forward, 2.6);
    let floor = this.playerPosition.y;
    for (const collider of this.colliders) {
      const box = collider.box;
      if (
        basePosition.x >= box.min.x - 0.2 &&
        basePosition.x <= box.max.x + 0.2 &&
        basePosition.z >= box.min.z - 0.2 &&
        basePosition.z <= box.max.z + 0.2 &&
        box.max.y <= this.playerPosition.y + 0.75
      ) {
        floor = Math.max(floor, box.max.y + 0.002);
      }
    }
    basePosition.y = floor;

    const group = new THREE.Group();
    group.position.copy(basePosition);
    group.rotation.y = this.yaw;
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: '#f7fff9',
      emissive: '#ffffff',
      emissiveIntensity: 2.1,
      roughness: 0.22,
      metalness: 0.12,
    });
    const lightMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.6, 0.13), frameMaterial);
    left.position.set(-0.76, 1.3, 0);
    const right = left.clone();
    right.position.x = 0.76;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.13, 0.13), frameMaterial);
    top.position.set(0, 2.54, 0);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), lightMaterial);
    inner.position.set(0, 1.28, 0.025);
    const glow = new THREE.PointLight('#ffffff', 12, 8, 2);
    glow.position.set(0, 1.25, 0.8);
    group.add(left, right, top, inner, glow);
    group.scale.y = 0.001;
    group.visible = false;
    this.worldRoot!.add(group);
    this.gateGroup = group;
    this.gatePosition = basePosition.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.gateSpawnTime = this.simulationTime;
    this.doorAvailable = true;
  }

  private openDoorChoice(): void {
    const level = this.currentLevel;
    if (!level || this.state !== 'LEVEL_COMPLETE' || !this.doorAvailable) return;
    this.state = 'DOOR_CHOICE';
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.ui.resultName.textContent = level.name;
    this.ui.resultAuthor.textContent = level.author;
    this.ui.resultTime.textContent = formatTime(this.levelElapsed);
    if (level.type === 'collect') this.ui.resultProgress.textContent = `${this.collectedCount}/${level.required}`;
    else if (level.type === 'puzzle' || level.type === 'escape') this.ui.resultProgress.textContent = `${this.puzzleFlags.size}/${level.flags?.length}`;
    else if (level.type === 'eliminate') this.ui.resultProgress.textContent = `${this.dynamicTargetsDown}/${this.dynamicTargetsTotal}`;
    else if (level.type === 'survive') this.ui.resultProgress.textContent = formatTime(this.surviveElapsed);
    else if (level.type === 'custom') this.ui.resultProgress.textContent = '条件达成';
    else this.ui.resultProgress.textContent = '已抵达';
    this.ui.door.classList.add('visible');
    this.playTone(780, 0.11, 'sine');
  }

  private closeDoorChoice(): void {
    if (this.state !== 'DOOR_CHOICE') return;
    this.state = 'LEVEL_COMPLETE';
    this.ui.door.classList.remove('visible');
    this.requestPointerLock();
  }

  private failLevel(reason: string, reset: boolean): void {
    if (this.state !== 'LEVEL_PLAYING' && this.state !== 'LEVEL_INTRO') return;
    this.state = 'LEVEL_FAILED';
    this.levelDeaths += 1;
    if (this.currentLevel?.type === 'survive') this.surviveElapsed = 0;
    this.failNeedsReset = reset;
    this.failEndsAt = this.simulationTime + (this.save.settings.reducedMotion ? 0.18 : 0.52);
    this.ui.fade.classList.add('dark', 'active');
    const message = reason === 'time_up'
      ? '连接超时 · 世界将重启'
      : reason === 'hazard'
        ? '信号损坏 · 返回检查点'
        : reason === 'fall'
          ? '坠入空白 · 返回检查点'
          : `世界拒绝了本次输入 · 返回检查点`;
    this.showToast(message, 1300);
    this.playTone(92, 0.32, 'sawtooth');
  }

  private respawnAtCheckpoint(): void {
    this.playerPosition.copy(this.checkpoint);
    this.playerVelocity.set(0, 0, 0);
    this.grounded = true;
    this.state = 'LEVEL_PLAYING';
    this.ui.fade.classList.remove('active', 'dark');
    this.syncCamera();
  }
}
