import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  acceptsLobbyObjectRevision,
  acceptsLobbyPlotRevision,
  acceptsLobbySnapshotRevision,
  canDeleteLobbyObject,
  canEditLobbyObject,
  canEditLobbyObjectForOwner,
  isAuthoritativeLocalLobbyInteraction,
  isPendingLobbyObjectId,
  lobbyDragPositionChanged,
  lobbyHomeClaimsForOwner,
  lobbySnapshotMissingAction,
  lobbyPlacementInFront,
  isLobbyPlacementProtected,
  lobbyDeletedObjectId,
  lobbyObjectOwnership,
  isUserLobbyGlbAssetId,
  LobbyEditor,
  mergeLobbyCatalog,
  normalizeLobbyObject,
  normalizeLobbyPlotClaim,
  parseLobbyCatalog,
  parseLobbyPhysicsDescriptor,
  sanitizeLobbyOwnerNickname,
  selectedLobbyHomePlotId,
  type LobbyCatalogItem,
  type LobbyObjectState,
  type LobbyVehicleRuntimePose,
} from './lobby-editor';
import { getLobbyPropModule, listLobbyPropCodes } from './lobby-props/registry';
import {
  lobbyPortalCapabilitiesMatch,
  lobbyPortalDestinationForSequence,
  parseLobbyPortalCapability,
} from './lobby-props/portal';

function createVehicleBindingTestEditor(item: LobbyCatalogItem): LobbyEditor {
  const editor = Object.create(LobbyEditor.prototype) as LobbyEditor;
  Object.assign(editor, {
    root: new THREE.Group(),
    systemObjects: new Map(),
    pendingDeletes: new Set(),
    pendingInteractions: new Set(),
    objectMutationQueues: new Map(),
    records: new Map(),
    tombstones: new Map(),
    catalog: new Map([[item.id, item]]),
    remoteCatalog: new Map(),
    runtimeVehicles: new Map(),
    runtimeVehicleGenerations: new Map(),
    runtimePhysicsPoses: new Map(),
    options: {
      onColliderChanged: () => undefined,
      onToast: () => undefined,
      isAccountSignedIn: () => false,
    },
    selectionHelper: null,
    plots: new Map(),
    ownerId: null,
    selectedHomePlotId: null,
    selectedId: null,
    isEnabled: false,
    channel: '0000',
    environment: { kind: 'lobby', label: '大厅' },
    online: 1,
    sync: 'synced',
    assetUploadStatus: 'idle',
    personalCatalog: new Map(),
    selectedAssetFileName: null,
    assetUploadErrorCode: null,
    propCreationJobs: [],
    propCreationWorker: { online: false, lastSeenAt: null },
    propCreationEnabled: null,
    propCreationStatus: 'idle',
    propCreationMessage: '输入描述后即可提交创作任务',
    ui: { homeDialog: { open: false }, propPrompt: { value: '' } },
    serverTimeOffsetMs: 0,
    lastElapsed: 0,
    generation: 1,
    updateUi: () => undefined,
  });
  return editor;
}

function bindCatalogObject(
  editor: LobbyEditor,
  catalogId: string,
  objectId: string,
  overrides: Partial<LobbyObjectState> = {},
): void {
  const object: LobbyObjectState = {
    id: objectId,
    catalogId,
    position: { x: 2, y: 0, z: 3 },
    rotationY: 0,
    scale: 1,
    locked: false,
    system: false,
    createdBy: null,
    plotId: null,
    interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
    ...overrides,
  };
  (editor as unknown as { upsertObject: (value: LobbyObjectState) => void }).upsertObject(object);
}

function precisionHelicopterCatalogItem(): LobbyCatalogItem {
  return parseLobbyCatalog({
    items: [{
      id: 'code-precision-rescue-helicopter',
      name: '苍隼救援直升机',
      category: '载具',
      kind: 'code',
      code: 'precision-rescue-helicopter',
      defaultScale: 1,
      vehicle: {
        kind: 'aircraft',
        enterRadius: 4.2,
        maxSpeed: 9,
        maxAcceleration: 8,
        maxAngularSpeed: 1.8,
      },
    }],
  })[0]!;
}

function vehicleRuntimePose(
  objectId: string,
  driverId: string | null,
  overrides: Partial<LobbyVehicleRuntimePose> = {},
): LobbyVehicleRuntimePose {
  return {
    objectId,
    driverId,
    x: 12,
    y: 0,
    z: -8,
    yaw: 0.9,
    pitch: 0,
    roll: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    seq: 4,
    ...overrides,
  };
}

describe('lobby catalog', () => {
  it('accepts the platform catalog contract and rejects incomplete entries', () => {
    const catalog = parseLobbyCatalog({
      items: [
        { id: 'code-glow-cube', name: '柔光方块', category: '摆件', kind: 'code', code: 'glow-cube', defaultScale: 1 },
        { id: 'glb-chair', name: '椅子', category: '家具', kind: 'glb', assetUrl: '/generated-assets/chair.glb', defaultScale: 8 },
        { id: 'broken-code', kind: 'code' },
      ],
    });
    expect(catalog).toEqual([
      { id: 'code-glow-cube', name: '柔光方块', category: '摆件', kind: 'code', code: 'glow-cube', defaultScale: 1 },
      { id: 'glb-chair', name: '椅子', category: '家具', kind: 'glb', assetUrl: '/generated-assets/chair.glb', defaultScale: 3 },
    ]);
  });

  it('accepts the private assets envelope and keeps personal uploads ahead of system items', () => {
    const system = parseLobbyCatalog({
      items: [
        { id: 'system-chair', name: '系统椅', category: '家具', kind: 'code', code: 'soft-bench', defaultScale: 1 },
        { id: 'collision', name: '系统版本', category: '摆件', kind: 'code', code: 'glow-cube', defaultScale: 1 },
      ],
    });
    const personal = parseLobbyCatalog({
      assets: [
        { id: 'user-glb-0123456789abcdef0123456789abcdef', name: '我的台灯', category: '灯具', kind: 'glb', assetUrl: '/lobby-assets/user-glb-0123456789abcdef0123456789abcdef/model.glb', defaultScale: 1 },
        { id: 'collision', name: '伪造覆盖', category: '摆件', kind: 'glb', assetUrl: '/lobby-assets/collision/model.glb', defaultScale: 1 },
      ],
    });

    expect(mergeLobbyCatalog(system, personal).map((item) => [item.id, item.name])).toEqual([
      ['user-glb-0123456789abcdef0123456789abcdef', '我的台灯'],
      ['system-chair', '系统椅'],
      ['collision', '系统版本'],
    ]);
  });

  it('validates and clamps the authoritative vehicle metadata contract', () => {
    const catalog = parseLobbyCatalog({
      items: [
        {
          id: 'code-precision-rescue-helicopter', name: '苍隼救援直升机', category: '载具', kind: 'code', code: 'precision-rescue-helicopter', defaultScale: 1,
          vehicle: { kind: 'aircraft', enterRadius: 4.2, maxSpeed: 9, maxAcceleration: 8, maxAngularSpeed: 1.8 },
        },
        {
          id: 'code-precision-rescue-helicopter-overclocked', name: '超界直升机', category: '载具', kind: 'code', code: 'precision-rescue-helicopter', defaultScale: 1,
          vehicle: { kind: 'aircraft', enterRadius: 99, maxSpeed: 99, maxAcceleration: 99, maxAngularSpeed: 99 },
        },
        {
          id: 'code-precision-rescue-helicopter-partial', name: '不完整直升机', category: '载具', kind: 'code', code: 'precision-rescue-helicopter', defaultScale: 1,
          vehicle: { kind: 'aircraft', enterRadius: 4.2, maxSpeed: 9, maxAcceleration: 8 },
        },
      ],
    });

    expect(catalog[0]?.vehicle).toEqual({
      kind: 'aircraft',
      enterRadius: 4.2,
      maxSpeed: 9,
      maxAcceleration: 8,
      maxAngularSpeed: 1.8,
    });
    expect(catalog[1]?.vehicle).toEqual({
      kind: 'aircraft',
      enterRadius: 6,
      maxSpeed: 40,
      maxAcceleration: 30,
      maxAngularSpeed: Math.PI * 2,
    });
    expect(catalog[2]?.vehicle).toBeUndefined();
  });

  it('accepts an exact reviewed space portal and resolves its shared alternating destination', () => {
    const portal = {
      kind: 'space',
      destinations: [
        { id: 'heaven', label: '天堂', spaceId: 'heaven' },
        { id: 'hell', label: '地狱', spaceId: 'hell' },
      ],
    } as const;
    const parsed = parseLobbyPortalCapability(portal);
    expect(parsed).toEqual(portal);
    expect(lobbyPortalDestinationForSequence(parsed!, 0).id).toBe('heaven');
    expect(lobbyPortalDestinationForSequence(parsed!, 1).id).toBe('heaven');
    expect(lobbyPortalDestinationForSequence(parsed!, 2).id).toBe('hell');
    expect(lobbyPortalDestinationForSequence(parsed!, 3).id).toBe('heaven');
    expect(lobbyPortalCapabilitiesMatch(parsed!, portal)).toBe(true);
    expect(parseLobbyPortalCapability({ ...portal, script: 'unsafe' })).toBeNull();
    expect(parseLobbyPortalCapability({
      kind: 'realm',
      destinations: [
        { id: 'heaven', label: '天堂', levelId: 'celestial-sanctum-official' },
        { id: 'hell', label: '地狱', levelId: 'infernal-abyss-official' },
      ],
    })).toBeNull();
    expect(parseLobbyPortalCapability({
      ...portal,
      destinations: [...portal.destinations, portal.destinations[0]],
    })).toBeNull();
    expect(parseLobbyPortalCapability({
      ...portal,
      destinations: [portal.destinations[0], { id: 'hell', label: '地狱', spaceId: 'heaven' }],
    })).toBeNull();
    expect(parseLobbyPortalCapability({
      ...portal,
      destinations: [{ id: 'pearly-gates', label: '天堂', spaceId: 'heaven' }, portal.destinations[1]],
    })).toBeNull();

    const catalog = parseLobbyCatalog({ items: [{
      id: 'code-heaven-hell-door', name: '天堂地狱任意门', category: '互动建筑', kind: 'code',
      code: 'heaven-hell-door', defaultScale: 1, portal,
    }] });
    expect(catalog[0]?.portal).toEqual(portal);
  });

  it('accepts only the exact bounded reviewed physics descriptor schema', () => {
    const descriptor = parseLobbyPhysicsDescriptor({
      body: 'dynamic',
      mass: 32,
      friction: 0.8,
      restitution: 0.1,
      colliders: [
        { shape: 'box', halfExtents: [1, 0.5, 2], position: [0, 0.5, 0], rotation: [-0.35, 0, 0] },
        { shape: 'capsule', radius: 0.25, halfHeight: 0.75, position: [0, 1, 0], rotation: [0, 0, Math.PI / 2] },
        { shape: 'ball', radius: 0.4, position: [0, 1.8, 0], rotation: [0, 0, 0] },
      ],
      breakImpulse: 900,
    });
    expect(descriptor).toEqual({
      body: 'dynamic',
      mass: 32,
      friction: 0.8,
      restitution: 0.1,
      colliders: [
        { shape: 'box', halfExtents: [1, 0.5, 2], position: [0, 0.5, 0], rotation: [-0.35, 0, 0] },
        { shape: 'capsule', radius: 0.25, halfHeight: 0.75, position: [0, 1, 0], rotation: [0, 0, Math.PI / 2] },
        { shape: 'ball', radius: 0.4, position: [0, 1.8, 0], rotation: [0, 0, 0] },
      ],
      breakImpulse: 900,
    });

    const validFixed = {
      body: 'fixed', mass: 0, friction: 1, restitution: 0,
      colliders: [{ shape: 'box', halfExtents: [1, 0.1, 2], position: [0, 1, 0], rotation: [-0.3, 0, 0] }],
    };
    for (const invalid of [
      { ...validFixed, script: 'unsafe' },
      { ...validFixed, mass: 1 },
      { ...validFixed, friction: Number.NaN },
      { ...validFixed, breakImpulse: 10 },
      { ...validFixed, colliders: [] },
      { ...validFixed, colliders: Array.from({ length: 9 }, () => validFixed.colliders[0]) },
      { ...validFixed, colliders: [{ ...validFixed.colliders[0], extra: true }] },
      { ...validFixed, colliders: [{ ...validFixed.colliders[0], halfExtents: [13, 1, 1] }] },
      { ...validFixed, colliders: [{ ...validFixed.colliders[0], rotation: [Number.NaN, 0, 0] }] },
    ]) expect(parseLobbyPhysicsDescriptor(invalid)).toBeNull();
  });

  it('preserves valid catalog physics but fails closed for invalid or non-code metadata', () => {
    const rampPhysics = {
      body: 'fixed', mass: 0, friction: 1.1, restitution: 0.04,
      colliders: [{ shape: 'box', halfExtents: [2.5, 0.18, 4], position: [0, 1.3, 0], rotation: [-Math.PI / 12, 0, 0] }],
    };
    const catalog = parseLobbyCatalog({ items: [
      { id: 'code-physics-ramp', name: '斜坡', category: '物理', kind: 'code', code: 'physics-ramp', defaultScale: 1, physics: rampPhysics },
      { id: 'code-physics-invalid', name: '无效', category: '物理', kind: 'code', code: 'physics-ramp', defaultScale: 1, physics: { ...rampPhysics, eval: true } },
      { id: 'glb-physics-forbidden', name: 'GLB', category: '物理', kind: 'glb', assetUrl: '/generated-assets/chair.glb', defaultScale: 1, physics: rampPhysics },
    ] });
    expect(catalog[0]?.physics).toEqual(rampPhysics);
    expect(catalog[1]?.physics).toBeUndefined();
    expect(catalog[2]?.physics).toBeUndefined();
  });

  it('only recognizes the strict random dynamic GLB asset namespace', () => {
    expect(isUserLobbyGlbAssetId('user-glb-0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isUserLobbyGlbAssetId('user-glb-0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isUserLobbyGlbAssetId('user-glb-system-chair')).toBe(false);
    expect(isUserLobbyGlbAssetId('code-glow-cube')).toBe(false);
  });

  it('keeps the reviewed core inside the explicit, sorted code-module manifest', () => {
    const codes = listLobbyPropCodes();
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining([
      'ember-shift-sentinel',
      'glow-cube',
      'heaven-hell-door',
      'howls-moving-castle',
      'light-arch',
      'precision-rescue-helicopter',
      'soft-bench',
      'spacex-starship',
    ]));
    for (const code of codes) expect(getLobbyPropModule(code)?.code).toBe(code);
  });

  it('registers both reviewed vehicle code props without changing their host capabilities', () => {
    expect(getLobbyPropModule('howls-moving-castle')).toMatchObject({
      code: 'howls-moving-castle',
      vehicle: { kind: 'car' },
    });
    expect(getLobbyPropModule('howls-moving-castle')?.vehicle).not.toHaveProperty('locomotion');
    expect(getLobbyPropModule('howls-moving-castle')?.createLobbyProp()).toMatchObject({
      name: 'HowlsMovingCastleVehicle',
      userData: { forwardAxis: '+Z' },
    });
    expect(getLobbyPropModule('precision-rescue-helicopter')).toMatchObject({
      code: 'precision-rescue-helicopter',
      vehicle: { kind: 'aircraft', flightModel: 'rotorcraft' },
    });
    expect(getLobbyPropModule('precision-rescue-helicopter')?.createLobbyProp().name).toBe('PrecisionRescueHelicopter');
  });

  it('registers a reviewed alternating space portal without moving its shared root', () => {
    const module = getLobbyPropModule('heaven-hell-door')!;
    expect(module).toMatchObject({ code: 'heaven-hell-door', portal: { kind: 'space' } });
    const root = module.createLobbyProp();
    const position = root.position.toArray();
    const rotation = root.rotation.toArray();
    const scale = root.scale.toArray();

    expect(root.name).toBe('HeavenHellDoor');
    expect(root.userData).toMatchObject({ interactionState: 'destination:heaven' });
    module.applyLobbyPropInteraction?.(root, { sequence: 2, ageSeconds: 0.2 }, 4);
    expect(root.userData).toMatchObject({
      portalSequence: 2,
      interactionState: 'destination:hell',
      portalDestination: { id: 'hell', label: '地狱', spaceId: 'hell' },
    });
    module.updateLobbyProp?.(root, 8.5);
    module.applyLobbyPropInteraction?.(root, { sequence: 3, ageSeconds: 0 }, 9);
    expect(root.userData.interactionState).toBe('destination:heaven');
    expect(root.position.toArray()).toEqual(position);
    expect(root.rotation.toArray()).toEqual(rotation);
    expect(root.scale.toArray()).toEqual(scale);
  });

  it('enables host portal travel only when module and catalog destinations match exactly', () => {
    const module = getLobbyPropModule('heaven-hell-door')!;
    const portal = module.portal!;
    const base = {
      id: 'code-heaven-hell-door', name: '天堂地狱任意门', category: '互动建筑', kind: 'code',
      code: 'heaven-hell-door', defaultScale: 1,
      interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 600 },
    } as const;
    const matchingItem = parseLobbyCatalog({ items: [{ ...base, portal }] })[0]!;
    const mismatchedItem = parseLobbyCatalog({ items: [{
      ...base,
      id: 'code-heaven-hell-door-mismatch',
      portal: {
        kind: 'space',
        destinations: [...portal.destinations].reverse(),
      },
    }] })[0]!;
    const matchingEditor = createVehicleBindingTestEditor(matchingItem);
    const mismatchedEditor = createVehicleBindingTestEditor(mismatchedItem);
    bindCatalogObject(matchingEditor, matchingItem.id, 'portal-object-matching');
    bindCatalogObject(mismatchedEditor, mismatchedItem.id, 'portal-object-mismatched');

    expect(matchingEditor.getTextState().objects[0]).toMatchObject({
      portal: true,
      portalDestination: '天堂',
      interactionState: 'destination:heaven',
    });
    expect(mismatchedEditor.getTextState().objects[0]).toMatchObject({
      portal: false,
      portalDestination: null,
    });
  });

  it('reports persistent-space context without enabling lobby home controls', () => {
    const item = parseLobbyCatalog({ items: [{
      id: 'code-heaven-hell-door', name: '天堂地狱任意门', category: '互动建筑', kind: 'code',
      code: 'heaven-hell-door', defaultScale: 1, portal: getLobbyPropModule('heaven-hell-door')?.portal,
    }] })[0]!;
    const editor = createVehicleBindingTestEditor(item);
    Object.assign(editor, {
      channel: 'space-2048-heaven',
      environment: { kind: 'persistent-space', label: '天堂' },
    });
    bindCatalogObject(editor, item.id, 'portal-object-in-heaven');

    expect(editor.getTextState()).toMatchObject({
      channel: 'space-2048-heaven',
      environment: { kind: 'persistent-space', label: '天堂' },
      home: { enabled: false },
    });
    expect(editor.getTextState().home.enabled).toBe(false);
  });

  it('treats the full persistent-space bounds as public and never infers lobby plots', () => {
    const editor = createVehicleBindingTestEditor({
      id: 'code-glow-cube', name: '柔光方块', category: '摆件', kind: 'code',
      code: 'glow-cube', defaultScale: 1,
    });
    Object.assign(editor, {
      environment: { kind: 'persistent-space', label: '天堂' },
      ownerId: 'owner-client-001',
    });
    const placementAccess = (editor as unknown as {
      placementAccess: (x: number, z: number) => { allowed: boolean; plot: unknown; message: string };
    }).placementAccess.bind(editor);

    expect(placementAccess(24, -24)).toEqual({ allowed: true, plot: null, message: '' });
    expect(placementAccess(54, -54)).toEqual({ allowed: true, plot: null, message: '' });
    expect(placementAccess(54.01, -54).allowed).toBe(false);
    expect(placementAccess(0, 4.75).allowed).toBe(false);
    expect(placementAccess(3.5, 5).allowed).toBe(true);
    expect(normalizeLobbyObject({
      id: 'space-prop-001', catalogId: 'code-glow-cube', position: [24, 1.25, -24],
      plotId: 'plot-001', createdBy: 'owner-client-001',
    }, { kind: 'persistent-space', label: '天堂' })).toMatchObject({
      position: { x: 24, y: 1.25, z: -24 },
      plotId: null,
    });
  });

  it('uses reviewed persistent-space platform tops as three-dimensional placement surfaces', () => {
    const editor = createVehicleBindingTestEditor({
      id: 'code-glow-cube', name: '柔光方块', category: '摆件', kind: 'code',
      code: 'glow-cube', defaultScale: 1,
    });
    const surface = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 8), new THREE.MeshBasicMaterial());
    surface.position.set(0, 2, -4);
    surface.updateWorldMatrix(true, true);
    Object.assign(editor, {
      environment: { kind: 'persistent-space', label: '天堂' },
      placementSurfaces: [surface],
      raycaster: new THREE.Raycaster(),
    });
    const placementSurfacePoint = (editor as unknown as {
      placementSurfacePoint: (x: number, z: number) => THREE.Vector3 | null;
    }).placementSurfacePoint.bind(editor);

    expect(placementSurfacePoint(0, -4)?.toArray()).toEqual([0, 2.5, -4]);
    expect(placementSurfacePoint(7, -4)).toBeNull();
    surface.geometry.dispose();
    (surface.material as THREE.Material).dispose();
  });

  it('revokes an existing portal binding when a hot catalog refresh removes its capability', () => {
    const module = getLobbyPropModule('heaven-hell-door')!;
    const item = parseLobbyCatalog({ items: [{
      id: 'code-heaven-hell-door', name: '天堂地狱任意门', category: '互动建筑', kind: 'code',
      code: 'heaven-hell-door', defaultScale: 1,
      interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 600 },
      portal: module.portal,
    }] })[0]!;
    const revoked = parseLobbyCatalog({ items: [{
      id: item.id, name: item.name, category: item.category, kind: item.kind,
      code: item.code, defaultScale: item.defaultScale,
      interaction: item.interaction,
    }] })[0]!;
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'portal-object-hot-revocation';
    bindCatalogObject(editor, item.id, objectId);
    expect(editor.getTextState().objects[0]?.portal).toBe(true);

    (editor as unknown as { catalog: Map<string, LobbyCatalogItem> }).catalog = new Map([[revoked.id, revoked]]);
    bindCatalogObject(editor, revoked.id, objectId);

    expect(editor.getTextState().objects[0]).toMatchObject({
      portal: false,
      portalDestination: null,
    });
  });

  it('binds a module vehicle capability only when the catalog permits the same kind', () => {
    const matchingItem = parseLobbyCatalog({
      items: [{
        id: 'code-precision-rescue-helicopter', name: '苍隼救援直升机', category: '载具', kind: 'code', code: 'precision-rescue-helicopter', defaultScale: 1,
        vehicle: { kind: 'aircraft', enterRadius: 4.2, maxSpeed: 9, maxAcceleration: 8, maxAngularSpeed: 1.8 },
      }],
    })[0]!;
    const mismatchedItem = parseLobbyCatalog({
      items: [{
        id: 'code-precision-rescue-helicopter-mismatched', name: '错误声明直升机', category: '载具', kind: 'code', code: 'precision-rescue-helicopter', defaultScale: 1,
        vehicle: { kind: 'car', enterRadius: 4.2, maxSpeed: 9, maxAcceleration: 8, maxAngularSpeed: 1.8 },
      }],
    })[0]!;
    const matchingEditor = createVehicleBindingTestEditor(matchingItem);
    const mismatchedEditor = createVehicleBindingTestEditor(mismatchedItem);

    bindCatalogObject(matchingEditor, matchingItem.id, 'vehicle-object-matching');
    bindCatalogObject(mismatchedEditor, mismatchedItem.id, 'vehicle-object-mismatched');

    expect(matchingEditor.getVehicleHandle('vehicle-object-matching')?.capability).toMatchObject({
      kind: 'aircraft',
      flightModel: 'rotorcraft',
    });
    expect(mismatchedEditor.getVehicleHandle('vehicle-object-mismatched')).toBeNull();
  });

  it('allows editing an idle parked vehicle while keeping an occupied or recovering vehicle locked', () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-editability';
    bindCatalogObject(editor, item.id, objectId, { revision: 1 });

    expect(editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null))).toBe(true);
    expect(editor.getTextState().objects.find((object) => object.id === objectId)).toMatchObject({
      canEdit: true,
      canDelete: true,
      occupiedBy: null,
    });

    expect(editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, 'recovery-autoland'))).toBe(true);
    expect(editor.getTextState().objects.find((object) => object.id === objectId)).toMatchObject({
      canEdit: false,
      canDelete: false,
      occupiedBy: 'recovery-autoland',
    });
    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState }>;
      protectedObjectMessage: (record: { state: LobbyObjectState }) => string;
      selectedId: string | null;
      transformSelected: (kind: 'rotate' | 'scale', delta: number) => void;
      deleteSelected: () => void;
      pendingDeletes: Set<string>;
      queuePatch: ReturnType<typeof vi.fn>;
      queueObjectMutation: ReturnType<typeof vi.fn>;
    };
    const record = internals.records.get(objectId)!;
    expect(internals.protectedObjectMessage(record)).toBe('载具正在被驾驶或安全降落，暂时不能编辑或删除');
    internals.selectedId = objectId;
    internals.queuePatch = vi.fn();
    internals.queueObjectMutation = vi.fn();
    internals.transformSelected('scale', 0.25);
    internals.transformSelected('rotate', Math.PI / 6);
    internals.deleteSelected();
    expect(record.state).toMatchObject({ scale: 1, rotationY: 0 });
    expect(internals.queuePatch).not.toHaveBeenCalled();
    expect(internals.queueObjectMutation).not.toHaveBeenCalled();
    expect(internals.pendingDeletes.has(objectId)).toBe(false);
  });

  it('scales, rotates, and deletes an idle vehicle without losing its parked world pose', () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-idle-transform';
    bindCatalogObject(editor, item.id, objectId, { revision: 1 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null));

    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      selectedId: string | null;
      transformSelected: (kind: 'rotate' | 'scale', delta: number) => void;
      deleteSelected: () => void;
      pendingDeletes: Set<string>;
      queuePatch: ReturnType<typeof vi.fn>;
      queueObjectMutation: ReturnType<typeof vi.fn>;
    };
    const record = internals.records.get(objectId)!;
    internals.selectedId = objectId;
    internals.queuePatch = vi.fn();
    internals.queueObjectMutation = vi.fn();

    internals.transformSelected('scale', 0.25);
    expect(record.state.scale).toBe(1.25);
    expect(record.root.position.toArray()).toEqual([12, 0, -8]);
    expect(record.root.rotation.y).toBeCloseTo(0.9, 8);
    expect(record.root.scale.toArray()).toEqual([1.25, 1.25, 1.25]);
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({ x: 12, y: 0, z: -8 });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(0.9, 8);

    internals.transformSelected('rotate', Math.PI / 6);
    expect(record.state.rotationY).toBeCloseTo(0.9 + Math.PI / 6, 8);
    expect(record.root.position.toArray()).toEqual([12, 0, -8]);
    expect(record.root.rotation.y).toBeCloseTo(0.9 + Math.PI / 6, 8);
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(0.9 + Math.PI / 6, 8);
    expect(internals.queuePatch).toHaveBeenNthCalledWith(1, record, ['scale'], expect.any(Object));
    expect(internals.queuePatch).toHaveBeenNthCalledWith(2, record, ['rotationY'], expect.any(Object));

    internals.deleteSelected();
    expect(internals.pendingDeletes.has(objectId)).toBe(true);
    expect(internals.queueObjectMutation).toHaveBeenCalledWith(objectId, expect.any(Function));
  });

  it('drags an idle vehicle from its parked pose and updates the runtime pose immediately', () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-idle-drag';
    bindCatalogObject(editor, item.id, objectId, { revision: 1 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null));

    const groundPoint = vi.fn()
      .mockReturnValueOnce(new THREE.Vector3(11, 0, -9))
      .mockReturnValueOnce(new THREE.Vector3(15, 1, -4));
    const setPointerCapture = vi.fn();
    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      isEnabled: boolean;
      canvas: { setPointerCapture: (pointerId: number) => void };
      dragging: {
        pointerId: number;
        objectId: string;
        offsetX: number;
        offsetZ: number;
        startX: number;
        startZ: number;
        moved: boolean;
      } | null;
      pickObject: () => { state: LobbyObjectState; root: THREE.Group };
      groundPoint: () => THREE.Vector3 | null;
      placementAccess: () => { allowed: boolean; plot: null; message: string };
      onPointerDown: (event: PointerEvent) => void;
      onPointerMove: (event: PointerEvent) => void;
    };
    const record = internals.records.get(objectId)!;
    internals.isEnabled = true;
    internals.canvas = { setPointerCapture };
    internals.pickObject = () => record;
    internals.groundPoint = groundPoint;
    internals.placementAccess = () => ({ allowed: true, plot: null, message: '' });
    internals.onPointerDown({
      button: 0,
      pointerId: 7,
      clientX: 20,
      clientY: 30,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as PointerEvent);

    expect(internals.dragging).toMatchObject({
      pointerId: 7,
      objectId,
      offsetX: 1,
      offsetZ: 1,
      startX: 12,
      startZ: -8,
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    internals.onPointerMove({ pointerId: 7, clientX: 25, clientY: 35 } as PointerEvent);
    expect(record.state.position).toEqual({ x: 16, y: 1, z: -3 });
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({
      x: 16,
      y: 1,
      z: -3,
      driverId: null,
    });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(0.9, 8);
    expect(record.root.position.toArray()).toEqual([16, 1, -3]);
    expect(record.root.rotation.y).toBeCloseTo(0.9, 8);
  });

  it('rolls an optimistic idle-vehicle transform back to its parked pose when saving fails', async () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-transform-rollback';
    bindCatalogObject(editor, item.id, objectId, { revision: 7 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null, {
      x: 92,
      z: -118,
      yaw: 1.1,
      seq: 12,
    }));

    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      objectMutationQueues: Map<string, Promise<void>>;
      selectedId: string | null;
      transformSelected: (kind: 'rotate' | 'scale', delta: number) => void;
      mutate: ReturnType<typeof vi.fn>;
      loadSharedLobby: ReturnType<typeof vi.fn>;
    };
    const record = internals.records.get(objectId)!;
    internals.selectedId = objectId;
    internals.mutate = vi.fn().mockRejectedValue(new Error('simulated PATCH failure'));
    internals.loadSharedLobby = vi.fn().mockResolvedValue(undefined);

    internals.transformSelected('rotate', Math.PI / 6);
    expect(record.state.rotationY).toBeCloseTo(1.1 + Math.PI / 6, 8);
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(1.1 + Math.PI / 6, 8);
    const pending = internals.objectMutationQueues.get(objectId);
    expect(pending).toBeDefined();
    await pending;
    await Promise.resolve();

    expect(record.state.rotationY).toBe(0);
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({
      driverId: null,
      x: 92,
      z: -118,
      seq: 12,
    });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(1.1, 8);
    expect(record.root.position.toArray()).toEqual([92, 0, -118]);
    expect(record.root.rotation.y).toBeCloseTo(1.1, 8);
    expect(internals.loadSharedLobby).toHaveBeenCalledWith(1);
  });

  it('never rolls back over a newly released lower-sequence vehicle session', async () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-cross-lease-rollback';
    bindCatalogObject(editor, item.id, objectId, { revision: 9 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null, {
      x: 84,
      z: -96,
      yaw: 0.7,
      seq: 12,
    }));

    let rejectPatch: (reason?: unknown) => void = (): void => {
      throw new Error('PATCH did not start');
    };
    const pendingPatch = new Promise<never>((_resolve, reject) => {
      rejectPatch = reject;
    });
    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      objectMutationQueues: Map<string, Promise<void>>;
      selectedId: string | null;
      transformSelected: (kind: 'rotate' | 'scale', delta: number) => void;
      mutate: ReturnType<typeof vi.fn>;
      loadSharedLobby: ReturnType<typeof vi.fn>;
    };
    const record = internals.records.get(objectId)!;
    internals.selectedId = objectId;
    internals.mutate = vi.fn().mockReturnValue(pendingPatch);
    internals.loadSharedLobby = vi.fn().mockResolvedValue(undefined);

    internals.transformSelected('rotate', Math.PI / 6);
    const queued = internals.objectMutationQueues.get(objectId);
    expect(queued).toBeDefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(internals.mutate).toHaveBeenCalledTimes(1);

    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, 'new-driver', {
      x: 135,
      z: -240,
      yaw: 2.3,
      seq: 0,
    }));
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null, {
      x: 135,
      z: -240,
      yaw: 2.3,
      seq: 0,
    }));
    rejectPatch(new Error('simulated delayed PATCH failure'));
    await queued;
    await Promise.resolve();

    expect(record.state.rotationY).toBe(0);
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({
      driverId: null,
      x: 135,
      z: -240,
      seq: 0,
    });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(2.3, 8);
    expect(record.root.position.toArray()).toEqual([135, 0, -240]);
    expect(record.root.rotation.y).toBeCloseTo(2.3, 8);
    expect(internals.loadSharedLobby).toHaveBeenCalledWith(1);
  });

  it('discards an unsaved drag if another player occupies the vehicle before pointer-up', () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-mid-drag-occupancy';
    bindCatalogObject(editor, item.id, objectId, { revision: 3 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null));

    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      objectMutationQueues: Map<string, Promise<void>>;
      isEnabled: boolean;
      canvas: {
        setPointerCapture: (pointerId: number) => void;
        hasPointerCapture: (pointerId: number) => boolean;
        releasePointerCapture: (pointerId: number) => void;
      };
      pickObject: () => { state: LobbyObjectState; root: THREE.Group };
      groundPoint: () => THREE.Vector3 | null;
      placementAccess: () => { allowed: boolean; plot: null; message: string };
      onPointerDown: (event: PointerEvent) => void;
      onPointerMove: (event: PointerEvent) => void;
      finishPointerInteraction: () => void;
    };
    const record = internals.records.get(objectId)!;
    internals.isEnabled = true;
    internals.canvas = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    };
    internals.pickObject = () => record;
    internals.groundPoint = vi.fn()
      .mockReturnValueOnce(new THREE.Vector3(11, 0, -9))
      .mockReturnValueOnce(new THREE.Vector3(15, 0, -4));
    internals.placementAccess = () => ({ allowed: true, plot: null, message: '' });

    internals.onPointerDown({
      button: 0,
      pointerId: 9,
      clientX: 20,
      clientY: 30,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as PointerEvent);
    internals.onPointerMove({ pointerId: 9, clientX: 25, clientY: 35 } as PointerEvent);
    expect(record.state.position).toEqual({ x: 16, y: 0, z: -3 });

    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, 'other-driver', {
      x: 17,
      z: -2,
      seq: 5,
    }));
    internals.finishPointerInteraction();

    expect(record.state.position).toEqual({ x: 2, y: 0, z: 3 });
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({
      driverId: 'other-driver',
      x: 17,
      z: -2,
      seq: 5,
    });
    expect(record.root.position.toArray()).toEqual([17, 0, -2]);
    expect(internals.objectMutationQueues.has(objectId)).toBe(false);
  });

  it('merges higher-revision position and rotation into an idle runtime pose without scale-only jumps', () => {
    const item = precisionHelicopterCatalogItem();
    const editor = createVehicleBindingTestEditor(item);
    const objectId = 'vehicle-object-authoritative-update';
    bindCatalogObject(editor, item.id, objectId, { revision: 1 });
    editor.applyVehicleRuntimePose(vehicleRuntimePose(objectId, null));

    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      runtimeVehicles: Map<string, LobbyVehicleRuntimePose>;
      upsertObject: (object: LobbyObjectState) => void;
    };
    const record = internals.records.get(objectId)!;
    internals.upsertObject({ ...record.state, scale: 1.4, revision: 2 });
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({ x: 12, y: 0, z: -8 });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(0.9, 8);
    expect(record.root.position.toArray()).toEqual([12, 0, -8]);
    expect(record.root.rotation.y).toBeCloseTo(0.9, 8);
    expect(record.root.scale.toArray()).toEqual([1.4, 1.4, 1.4]);

    internals.upsertObject({
      ...record.state,
      position: { x: 6, y: 1, z: 7 },
      revision: 3,
    });
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({ x: 6, y: 1, z: 7 });
    expect(internals.runtimeVehicles.get(objectId)?.yaw).toBeCloseTo(0.9, 8);
    expect(record.root.position.toArray()).toEqual([6, 1, 7]);

    internals.upsertObject({ ...record.state, rotationY: -0.4, revision: 4 });
    expect(internals.runtimeVehicles.get(objectId)).toMatchObject({ x: 6, y: 1, z: 7, yaw: -0.4 });
    expect(record.root.position.toArray()).toEqual([6, 1, 7]);
    expect(record.root.rotation.y).toBeCloseTo(-0.4, 8);
  });

  it('keeps the high-detail helicopter root authoritative while animating its rotors and pilot controls', () => {
    const module = getLobbyPropModule('precision-rescue-helicopter')!;
    const root = module.createLobbyProp();
    const rootPosition = root.position.toArray();
    const rootQuaternion = root.quaternion.toArray();
    const rootScale = root.scale.toArray();
    let meshes = 0;
    let triangles = 0;
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      meshes += 1;
      const geometry = child.geometry;
      triangles += geometry.index
        ? geometry.index.count / 3
        : (geometry.getAttribute('position')?.count ?? 0) / 3;
    });
    expect(meshes).toBe(118);
    expect(triangles).toBe(8_340);
    expect(triangles).toBeLessThan(50_000);

    const mainRotor = root.getObjectByName('MainRotorSpin')!;
    const tailRotor = root.getObjectByName('TailRotorSpin')!;
    const pilot = root.getObjectByName('CockpitPilot')!;
    const cyclic = root.getObjectByName('PilotCyclicControl')!;
    const collective = root.getObjectByName('PilotCollectiveControl')!;
    const visualRig = root.getObjectByName('HelicopterVisualRig')!;
    expect(pilot.visible).toBe(false);

    const visualState = {
      phase: 'driving' as const,
      speed: 5.2,
      normalizedSpeed: 0.7,
      throttle: 0.8,
      steering: 0.55,
      pitch: -0.32,
      roll: -0.41,
      vertical: 0.65,
      grounded: false,
    };
    module.updateLobbyVehicleVisual?.(root, visualState, 10);
    module.updateLobbyProp?.(root, 10);
    module.updateLobbyVehicleVisual?.(root, visualState, 10.1);
    module.updateLobbyProp?.(root, 10.1);

    expect(mainRotor.rotation.y).not.toBe(0);
    expect(tailRotor.rotation.z).not.toBe(0);
    expect(pilot.visible).toBe(true);
    expect(cyclic.rotation.x).not.toBe(0);
    expect(cyclic.rotation.z).not.toBe(0);
    expect(collective.rotation.z).toBeGreaterThan(-0.5);
    expect(visualRig.rotation.x).toBe(0);
    expect(visualRig.rotation.z).toBe(0);
    expect(root.position.toArray()).toEqual(rootPosition);
    expect(root.quaternion.toArray()).toEqual(rootQuaternion);
    expect(root.scale.toArray()).toEqual(rootScale);
  });

  it('passes each code prop its own created root for update and interaction', () => {
    for (const code of ['glow-cube', 'soft-bench', 'light-arch']) {
      const module = getLobbyPropModule(code)!;
      const root = module.createLobbyProp();
      expect(() => module.updateLobbyProp?.(root, 1.25)).not.toThrow();
      expect(() => module.interactLobbyProp?.(root)).not.toThrow();
      if (code === 'glow-cube') expect(root.userData.active).toBe(true);
      else expect(root.userData.palette).toBe(1);
    }
  });

  it('runs the Starship launch and automatic recovery without moving its shared root', () => {
    const module = getLobbyPropModule('spacex-starship')!;
    const root = module.createLobbyProp();
    const rig = root.getObjectByName('StarshipFlightRig')!;
    const rootPosition = root.position.toArray();
    const rootRotation = root.rotation.toArray();
    const rootScale = root.scale.toArray();

    module.updateLobbyProp?.(root, 10);
    module.interactLobbyProp?.(root);
    expect(root.userData).toMatchObject({ active: true, interactionState: 'ignition', launchCount: 1 });

    module.updateLobbyProp?.(root, 12);
    expect(root.userData.interactionState).toBe('ascent');
    expect(root.userData.altitude).toBeGreaterThan(0);
    expect(rig.position.y).toBeGreaterThan(0);
    module.interactLobbyProp?.(root);
    expect(root.userData.launchCount).toBe(1);

    module.updateLobbyProp?.(root, 16.5);
    expect(root.userData.interactionState).toBe('flip');
    expect(Math.abs(rig.rotation.z)).toBeGreaterThan(0.2);

    module.updateLobbyProp?.(root, 23.1);
    expect(root.userData.interactionState).toBe('recovered');
    expect(rig.position.y).toBe(0);

    module.updateLobbyProp?.(root, 24.2);
    expect(root.userData).toMatchObject({ active: false, interactionState: 'idle', altitude: 0 });
    expect(rig.position.toArray()).toEqual([0, 0, 0]);
    expect(rig.rotation.toArray()).toEqual([0, 0, 0, 'XYZ']);
    expect(root.position.toArray()).toEqual(rootPosition);
    expect(root.rotation.toArray()).toEqual(rootRotation);
    expect(root.scale.toArray()).toEqual(rootScale);

    module.interactLobbyProp?.(root);
    expect(root.userData.launchCount).toBe(2);
  });

  it('keeps separate Starship instances and their mission state isolated', () => {
    const module = getLobbyPropModule('spacex-starship')!;
    const first = module.createLobbyProp();
    const second = module.createLobbyProp();
    module.updateLobbyProp?.(first, 3);
    module.updateLobbyProp?.(second, 3);
    module.interactLobbyProp?.(first);
    module.updateLobbyProp?.(first, 5);
    module.updateLobbyProp?.(second, 5);

    expect(first.userData.interactionState).toBe('ascent');
    expect(second.userData).toMatchObject({ active: false, interactionState: 'idle', launchCount: 0 });
    expect(second.getObjectByName('StarshipFlightRig')?.position.y).toBe(0);
  });

  it('reversibly transforms the Ember Shift Sentinel without moving its shared root', () => {
    const module = getLobbyPropModule('ember-shift-sentinel')!;
    const root = module.createLobbyProp();
    const rootPosition = root.position.toArray();
    const rootRotation = root.rotation.toArray();
    const rootScale = root.scale.toArray();
    const torso = root.getObjectByName('SentinelTorsoPivot')!;
    const head = root.getObjectByName('SentinelHeadPivot')!;
    const frontWheel = root.getObjectByName('SentinelFrontWheel-L')!;

    expect(root.userData).toMatchObject({
      interactionState: 'robot',
      vehicleAmount: 0,
      targetVehicleAmount: 0,
      transformCount: 0,
      collisionVersion: 0,
    });
    module.updateLobbyProp?.(root, 10);
    module.interactLobbyProp?.(root);
    expect(root.userData).toMatchObject({
      interactionState: 'transforming-to-vehicle',
      targetVehicleAmount: 1,
      transformCount: 1,
    });

    module.updateLobbyProp?.(root, 11.3);
    expect(root.userData.vehicleAmount).toBeCloseTo(0.5, 5);
    expect(torso.position.y).toBeGreaterThan(0.72);
    expect(torso.position.y).toBeLessThan(2.22);

    module.updateLobbyProp?.(root, 12.6);
    expect(root.userData).toMatchObject({ interactionState: 'vehicle', vehicleAmount: 1, collisionVersion: 1 });
    expect(torso.position.z).toBeCloseTo(0.96, 5);
    expect(head.scale.x).toBeCloseTo(0.35, 5);
    expect(frontWheel.position.y).toBeCloseTo(0.4, 5);

    module.interactLobbyProp?.(root);
    module.updateLobbyProp?.(root, 15.2);
    expect(root.userData).toMatchObject({
      interactionState: 'robot',
      vehicleAmount: 0,
      targetVehicleAmount: 0,
      transformCount: 2,
      collisionVersion: 0,
    });
    expect(root.position.toArray()).toEqual(rootPosition);
    expect(root.rotation.toArray()).toEqual(rootRotation);
    expect(root.scale.toArray()).toEqual(rootScale);
    expect(root.getObjectByName('SentinelWheelSpinner-FL')?.rotation.x).toBeCloseTo(0, 8);

    let triangles = 0;
    let renderables = 0;
    let shadowCasters = 0;
    const materials = new Set<THREE.Material>();
    root.traverse((child) => {
      if (child instanceof THREE.Points) {
        renderables += 1;
        materials.add(child.material as THREE.Material);
        return;
      }
      if (!(child instanceof THREE.Mesh)) return;
      renderables += 1;
      if (child.castShadow) shadowCasters += 1;
      const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of meshMaterials) materials.add(material);
      const geometry = child.geometry;
      const instances = child instanceof THREE.InstancedMesh ? child.count : 1;
      triangles += (geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3) * instances;
    });
    expect(triangles).toBeGreaterThan(1_000);
    expect(triangles).toBeLessThan(50_000);
    expect(renderables).toBeLessThan(110);
    expect(shadowCasters).toBeLessThan(60);
    expect(materials.size).toBeLessThan(16);
  });

  it('keeps the Ember Shift Sentinel above the floor throughout its articulated transform', () => {
    const module = getLobbyPropModule('ember-shift-sentinel')!;
    const root = module.createLobbyProp();
    const rig = root.getObjectByName('SentinelArticulationRig')!;
    module.updateLobbyProp?.(root, 0);
    module.interactLobbyProp?.(root);

    let minimumY = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame <= 26; frame += 1) {
      module.updateLobbyProp?.(root, frame * 0.1);
      root.updateWorldMatrix(true, true);
      minimumY = Math.min(minimumY, new THREE.Box3().setFromObject(rig).min.y);
    }
    expect(root.userData.interactionState).toBe('vehicle');
    expect(minimumY).toBeGreaterThanOrEqual(-0.01);

    const rigSize = new THREE.Box3().setFromObject(rig).getSize(new THREE.Vector3());
    expect(rigSize.x).toBeGreaterThan(1.7);
    expect(rigSize.x).toBeLessThan(2.3);
    expect(rigSize.y).toBeGreaterThan(0.8);
    expect(rigSize.y).toBeLessThan(1.5);
    expect(rigSize.z).toBeGreaterThan(2.8);
    expect(rigSize.z).toBeLessThan(3.7);
    const rootSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(rootSize.x).toBeLessThan(rigSize.x + 0.2);
    expect(rootSize.y).toBeLessThan(rigSize.y + 0.12);
    expect(rootSize.z).toBeLessThan(rigSize.z + 0.1);
  });

  it('keeps Ember Shift Sentinel transformation state isolated per instance', () => {
    const module = getLobbyPropModule('ember-shift-sentinel')!;
    const first = module.createLobbyProp();
    const second = module.createLobbyProp();
    module.updateLobbyProp?.(first, 4);
    module.updateLobbyProp?.(second, 4);
    module.interactLobbyProp?.(first);
    module.updateLobbyProp?.(first, 6.6);
    module.updateLobbyProp?.(second, 6.6);

    expect(first.userData).toMatchObject({ interactionState: 'vehicle', vehicleAmount: 1 });
    expect(second.userData).toMatchObject({ interactionState: 'robot', vehicleAmount: 0, transformCount: 0 });
  });
});

describe('lobby object validation', () => {
  it('moves click-to-add placement past the protected spawn when entering from third person', () => {
    const point = lobbyPlacementInFront(
      new THREE.Vector3(0, 1.62, 7.6),
      new THREE.Vector3(0, 0, -1),
    );
    expect(point.x).toBe(0);
    expect(point.y).toBeCloseTo(-0.4);
    expect(isLobbyPlacementProtected(point.x, point.y)).toBe(false);
  });

  it('normalizes transforms to the exact shared-lobby bounds', () => {
    expect(normalizeLobbyObject({
      id: 'prop-001',
      catalogId: 'code-glow-cube',
      position: { x: 99, y: -4, z: -99 },
      rotationY: Math.PI * 4,
      scale: 9,
      revision: 12,
    })).toEqual({
      id: 'prop-001',
      catalogId: 'code-glow-cube',
      position: { x: 54, y: 0, z: -54 },
      rotationY: 0,
      scale: 3,
      locked: false,
      system: false,
      createdBy: null,
      plotId: 'plot-049',
      interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
      revision: 12,
    });
  });

  it('preserves valid creator metadata and fails closed for invalid creator IDs', () => {
    const owned = normalizeLobbyObject({
      id: 'prop-owned-001',
      catalogId: 'code-glow-cube',
      position: [0, 0, 0],
      createdBy: 'owner-client-001',
    });
    const unknown = normalizeLobbyObject({
      id: 'prop-legacy-001',
      catalogId: 'code-glow-cube',
      position: [0, 0, 0],
      createdBy: '../spoof',
    });

    expect(owned?.createdBy).toBe('owner-client-001');
    expect(unknown?.createdBy).toBeNull();
  });

  it('normalizes authoritative shared interaction state and rejects partial state', () => {
    const synced = normalizeLobbyObject({
      id: 'prop-shared-001',
      catalogId: 'code-glow-cube',
      position: [0, 0, 0],
      interaction: {
        sequence: 3,
        startedAt: '2026-07-13T00:00:00.000Z',
        by: 'owner-client-001',
        requestId: 'interaction-request-0001',
      },
    });
    const partial = normalizeLobbyObject({
      id: 'prop-partial-001',
      catalogId: 'code-glow-cube',
      position: [0, 0, 0],
      interaction: { sequence: 4 },
    });

    expect(synced?.interaction.sequence).toBe(3);
    expect(synced?.interaction.requestId).toBe('interaction-request-0001');
    expect(partial?.interaction).toEqual({ sequence: 0, startedAt: null, by: null, requestId: null });
  });

  it('identifies only the exact authoritative response to a local interaction request', () => {
    const authoritative = { sequence: 8, requestId: 'interaction-local-0001' };
    expect(isAuthoritativeLocalLobbyInteraction(authoritative, 'interaction-local-0001', 7)).toBe(true);
    expect(isAuthoritativeLocalLobbyInteraction(authoritative, 'interaction-remote-0002', 7)).toBe(false);
    expect(isAuthoritativeLocalLobbyInteraction(authoritative, 'interaction-local-0001', 6)).toBe(false);
  });

  it('emits the local interaction callback only from its matching successful request', async () => {
    const item = parseLobbyCatalog({ items: [{
      id: 'code-glow-cube',
      name: '呼吸光立方',
      category: '氛围',
      kind: 'code',
      code: 'glow-cube',
      defaultScale: 1,
      interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 150 },
    }] })[0]!;
    const editor = createVehicleBindingTestEditor(item);
    const onLocalPropInteraction = vi.fn();
    const onPropInteraction = vi.fn();
    Object.assign((editor as unknown as { options: Record<string, unknown> }).options, {
      onLocalPropInteraction,
      onPropInteraction,
    });
    bindCatalogObject(editor, item.id, 'local-interaction-object');
    const internals = editor as unknown as {
      records: Map<string, { state: LobbyObjectState; root: THREE.Group }>;
      objectMutationQueues: Map<string, Promise<void>>;
      requestInteraction(record: unknown): void;
      upsertObject(object: LobbyObjectState): void;
    };
    const original = internals.records.get('local-interaction-object')!;
    const mutate = vi.fn(async (
      _path: string,
      _method: string,
      body: Record<string, unknown>,
    ) => ({
      object: {
        ...original.state,
        revision: 1,
        interaction: {
          sequence: 1,
          startedAt: new Date().toISOString(),
          by: 'owner-client-001',
          requestId: body.requestId,
        },
      },
    }));
    Object.assign(editor, { mutate });

    internals.requestInteraction(original);
    await internals.objectMutationQueues.get(original.state.id);

    expect(onLocalPropInteraction).toHaveBeenCalledOnce();
    expect(onLocalPropInteraction).toHaveBeenCalledWith(expect.objectContaining({
      objectId: original.state.id,
      sequence: 1,
      root: original.root,
    }));

    const afterLocal = internals.records.get(original.state.id)!;
    internals.upsertObject({
      ...afterLocal.state,
      revision: 2,
      interaction: {
        sequence: 2,
        startedAt: new Date().toISOString(),
        by: 'remote-client-002',
        requestId: 'interaction-remote-0002',
      },
    });

    expect(onPropInteraction).toHaveBeenCalledTimes(2);
    expect(onLocalPropInteraction).toHaveBeenCalledOnce();
  });

  it('maps the same shared sequence to the same prop state on every client', () => {
    for (const code of ['glow-cube', 'soft-bench', 'light-arch']) {
      const module = getLobbyPropModule(code)!;
      const first = module.createLobbyProp();
      const second = module.createLobbyProp();
      module.applyLobbyPropInteraction?.(first, { sequence: 5, ageSeconds: 0 }, 10);
      module.applyLobbyPropInteraction?.(second, { sequence: 5, ageSeconds: 0 }, 42);
      expect(first.userData.active).toBe(second.userData.active);
      expect(first.userData.palette).toBe(second.userData.palette);
      expect(first.userData.interactionState).toBe(second.userData.interactionState);
    }
  });

  it('reconstructs the Starship timeline for late-joining clients', () => {
    const module = getLobbyPropModule('spacex-starship')!;
    const first = module.createLobbyProp();
    const second = module.createLobbyProp();
    module.applyLobbyPropInteraction?.(first, { sequence: 2, ageSeconds: 6.5 }, 20);
    module.applyLobbyPropInteraction?.(second, { sequence: 2, ageSeconds: 6.5 }, 100);
    expect(first.userData.interactionState).toBe('flip');
    expect(second.userData.interactionState).toBe('flip');
    expect(first.userData.missionElapsed).toBeCloseTo(second.userData.missionElapsed, 5);

    module.applyLobbyPropInteraction?.(second, { sequence: 2, ageSeconds: 14.2 }, 108);
    expect(second.userData.interactionState).toBe('idle');
    expect(second.userData.active).toBe(false);
  });

  it('never permits editing locked or system objects', () => {
    expect(canEditLobbyObject({ locked: false, system: false })).toBe(true);
    expect(canEditLobbyObject({ locked: true, system: false })).toBe(false);
    expect(canEditLobbyObject({ locked: false, system: true })).toBe(false);
  });

  it('permits every member of a channel to edit and delete ordinary objects', () => {
    const object = { createdBy: 'owner-client-001', locked: false, system: false };
    expect(lobbyObjectOwnership(object, 'owner-client-001')).toBe('self');
    expect(lobbyObjectOwnership(object, 'other-client-001')).toBe('other');
    expect(canDeleteLobbyObject(object, 'owner-client-001')).toBe(true);
    expect(canDeleteLobbyObject(object, 'other-client-001')).toBe(true);
    expect(canEditLobbyObject(object)).toBe(true);
  });

  it('protects home objects by stable owner identity while public and legacy objects stay collaborative', () => {
    const claim = normalizeLobbyPlotClaim({
      id: 'plot-001',
      ownerId: 'owner-client-001',
      ownerNickname: '海东',
      claimedAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:01.000Z',
    });
    expect(claim).not.toBeNull();
    const publicObject = { locked: false, system: false, plotId: null };
    const homeObject = { locked: false, system: false, plotId: 'plot-001' };
    expect(canEditLobbyObjectForOwner(publicObject, 'other-client-001', null)).toBe(true);
    expect(canEditLobbyObjectForOwner(homeObject, 'owner-client-001', claim)).toBe(true);
    expect(canEditLobbyObjectForOwner(homeObject, 'other-client-001', claim)).toBe(false);
    expect(canEditLobbyObjectForOwner(homeObject, 'owner-client-001', null)).toBe(false);
  });

  it('derives plot protection from position across the now-continuous home grid', () => {
    expect(normalizeLobbyObject({
      id: 'home-prop-001', catalogId: 'code-glow-cube', position: [-24, 0, -24],
    })?.plotId).toBe('plot-001');
    expect(normalizeLobbyObject({
      id: 'shared-edge-001', catalogId: 'code-glow-cube', position: [18, 0, 0],
    })?.plotId).toBe('plot-007');
    expect(normalizeLobbyObject({
      id: 'stale-edge-metadata-001', catalogId: 'code-glow-cube', position: [18, 0, 0], plotId: 'plot-001',
    })?.plotId).toBe('plot-007');
  });

  it('normalizes doorplate nicknames to the platform-safe Unicode contract', () => {
    expect(sanitizeLobbyOwnerNickname('  小明🎮!/ A_B-1.  ')).toBe('小明 A_B-1.');
    expect(sanitizeLobbyOwnerNickname('！！！')).toBe('访客');
    expect([...sanitizeLobbyOwnerNickname('家'.repeat(40))]).toHaveLength(24);
  });

  it('keeps every claimed home for one owner and selects a specific plot for release', () => {
    const claims = [
      normalizeLobbyPlotClaim({
        id: 'plot-003', ownerId: 'owner-client-001', ownerNickname: '海东',
        claimedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
      }),
      normalizeLobbyPlotClaim({
        id: 'plot-001', ownerId: 'owner-client-001', ownerNickname: '海东',
        claimedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
      }),
      normalizeLobbyPlotClaim({
        id: 'plot-002', ownerId: 'owner-client-002', ownerNickname: '小明',
        claimedAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
      }),
    ].filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));

    expect(lobbyHomeClaimsForOwner(claims, 'owner-client-001').map((claim) => claim.id)).toEqual([
      'plot-001', 'plot-003',
    ]);
    expect(selectedLobbyHomePlotId(claims, 'owner-client-001', 'plot-003')).toBe('plot-003');
    expect(selectedLobbyHomePlotId(claims, 'owner-client-001', 'plot-002')).toBe('plot-001');
    expect(selectedLobbyHomePlotId(claims, null, 'plot-003')).toBeNull();
  });

  it('does not save a continuous-grid boundary position when an object was only clicked', () => {
    const boundary = { x: 18, z: 0 };
    expect(lobbyDragPositionChanged(boundary, boundary)).toBe(false);
    expect(lobbyDragPositionChanged(boundary, { x: 18 + 1e-6, z: 0 })).toBe(false);
    expect(lobbyDragPositionChanged(boundary, { x: 14, z: 0 })).toBe(true);
  });

  it('allows ownerless legacy props but never deletes protected objects', () => {
    expect(lobbyObjectOwnership({ createdBy: null, locked: false, system: false }, 'owner-client-001')).toBe('unknown');
    expect(canDeleteLobbyObject({ createdBy: null, locked: false, system: false }, 'owner-client-001')).toBe(true);
    expect(canDeleteLobbyObject({ createdBy: 'owner-client-001', locked: true, system: false }, 'owner-client-001')).toBe(false);
    expect(canDeleteLobbyObject({ createdBy: 'owner-client-001', locked: false, system: true }, 'owner-client-001')).toBe(false);
  });

  it('reads the platform objectId from SSE delete changes', () => {
    expect(lobbyDeletedObjectId({ type: 'object.deleted', objectId: 'prop-002' })).toBe('prop-002');
    expect(lobbyDeletedObjectId({ type: 'object.deleted', objectId: '../escape' })).toBeNull();
  });

  it('keeps pending local objects immutable until the canonical id arrives', () => {
    expect(isPendingLobbyObjectId('local-0f2f')).toBe(true);
    expect(isPendingLobbyObjectId('0f2f')).toBe(false);
  });

  it('rejects stale object responses and delete resurrection per object', () => {
    expect(acceptsLobbyObjectRevision(8, 9, undefined)).toBe(false);
    expect(acceptsLobbyObjectRevision(9, 9, undefined)).toBe(true);
    expect(acceptsLobbyObjectRevision(8, undefined, 8)).toBe(false);
    expect(acceptsLobbyObjectRevision(9, undefined, 8)).toBe(true);
    expect(acceptsLobbyObjectRevision(undefined, 3, undefined)).toBe(false);
  });

  it('uses a separate full-snapshot watermark without filtering object events', () => {
    expect(acceptsLobbySnapshotRevision(9, 10)).toBe(false);
    expect(acceptsLobbySnapshotRevision(10, 10)).toBe(true);
    expect(acceptsLobbySnapshotRevision(undefined, 0)).toBe(true);
    expect(acceptsLobbySnapshotRevision(undefined, 1)).toBe(false);
  });

  it('rejects stale plot changes while allowing an idempotent same-revision delivery', () => {
    expect(acceptsLobbyPlotRevision(12, 11)).toBe(true);
    expect(acceptsLobbyPlotRevision(12, 12)).toBe(true);
    expect(acceptsLobbyPlotRevision(11, 12)).toBe(false);
    expect(acceptsLobbyPlotRevision(undefined, 12)).toBe(false);
    expect(acceptsLobbyPlotRevision(undefined, undefined)).toBe(true);
  });

  it('defers a snapshot deletion behind a queued mutation and tombstones its stale response', () => {
    expect(lobbySnapshotMissingAction('prop-queued', true, false)).toBe('defer-tombstone');
    expect(acceptsLobbyObjectRevision(9, 8, 10)).toBe(false);
    expect(lobbySnapshotMissingAction('prop-idle', false, false)).toBe('remove');
    expect(lobbySnapshotMissingAction('local-pending', false, false)).toBe('keep-local');
  });
});
