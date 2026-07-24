import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { LobbyLocalPropInteractionUse } from './lobby-editor';
import { quitWhiteRoomGame, trumpTowerResidenceForSequence, WhiteRoomGame } from './white-room-game';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quit game', () => {
  it('releases pointer lock before reloading the current URL', () => {
    const calls: string[] = [];

    quitWhiteRoomGame({
      exitPointerLock: () => calls.push('exit-pointer-lock'),
      reload: () => calls.push('reload'),
    });

    expect(calls).toEqual(['exit-pointer-lock', 'reload']);
  });

  it('reloads after a pointer-lock failure and then propagates the original error', () => {
    const failure = new Error('pointer lock failed');
    const calls: string[] = [];

    expect(() => quitWhiteRoomGame({
      exitPointerLock: () => {
        calls.push('exit-pointer-lock');
        throw failure;
      },
      reload: () => calls.push('reload'),
    })).toThrow(failure);

    expect(calls).toEqual(['exit-pointer-lock', 'reload']);
  });

  it('binds the quit button exactly once with the existing pause-menu controls', () => {
    const commonControl = { addEventListener: vi.fn() };
    const quitButton = { addEventListener: vi.fn() };
    const reload = vi.fn();
    vi.stubGlobal('document', {
      getElementById: (id: string) => id === 'quit-game-btn' ? quitButton : commonControl,
    });
    vi.stubGlobal('window', { location: { reload } });
    const game = Object.create(WhiteRoomGame.prototype) as Record<string, unknown>;
    Object.assign(game, {
      ui: new Proxy({}, { get: () => commonControl }),
    });
    const bindUi = (WhiteRoomGame.prototype as unknown as {
      bindUi(this: Record<string, unknown>): void;
    }).bindUi;

    bindUi.call(game);

    expect(quitButton.addEventListener).toHaveBeenCalledOnce();
    expect(quitButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    const click = quitButton.addEventListener.mock.calls[0]?.[1] as () => void;
    click();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('vehicle release acknowledgement recovery', () => {
  const stopAfterTimeoutCheck = new Error('stop-after-timeout-check');

  function exerciseAwaitingRelease(elapsedSeconds: number) {
    const beginPendingVehicleRecovery = vi.fn();
    const setLocalVehicleSafetyHold = vi.fn();
    const game = Object.create(WhiteRoomGame.prototype) as Record<string, unknown>;
    Object.assign(game, {
      activeVehicle: {
        simulation: { state: { yaw: 0 } },
        safeExitMode: 'awaiting-release',
        autolandStartedAt: 100,
      },
      simulationTime: 100 + elapsedSeconds,
      lobbyMultiplayer: { setLocalVehicleSafetyHold },
      beginPendingVehicleRecovery,
      vehicleEnvironment: () => {
        throw stopAfterTimeoutCheck;
      },
    });

    const updateActiveVehicle = (WhiteRoomGame.prototype as unknown as {
      updateActiveVehicle(this: Record<string, unknown>, dt: number, advancePhysics: boolean): void;
    }).updateActiveVehicle;
    expect(() => updateActiveVehicle.call(game, 0, false)).toThrow(stopAfterTimeoutCheck);
    return { beginPendingVehicleRecovery, setLocalVehicleSafetyHold };
  }

  it('waits six full seconds for the release acknowledgement before requesting recovery once', () => {
    const atBoundary = exerciseAwaitingRelease(6);
    expect(atBoundary.beginPendingVehicleRecovery).not.toHaveBeenCalled();

    const timedOut = exerciseAwaitingRelease(6.001);
    expect(timedOut.beginPendingVehicleRecovery).toHaveBeenCalledOnce();
    expect(timedOut.beginPendingVehicleRecovery).toHaveBeenCalledWith(
      'state_loss',
      '离机确认超时 · 已交由服务端完成安全释放',
      true,
    );
    expect(timedOut.setLocalVehicleSafetyHold).toHaveBeenCalledWith(true);
  });
});

describe('local Trump Tower residence interaction', () => {
  it('cycles authoritative interaction sequences through the residences and lobby', () => {
    expect([1, 2, 3, 4, 5].map((sequence) => trumpTowerResidenceForSequence(sequence)?.label)).toEqual([
      '35F 高级公寓',
      '52F 高级公寓',
      'PH 顶层公寓',
      'Lobby 大堂',
      '35F 高级公寓',
    ]);
    expect(trumpTowerResidenceForSequence(0)).toBeNull();
  });

  it('transforms the local destination through the prop root and immediately syncs the camera', () => {
    const root = new THREE.Group();
    root.position.set(8, 1, -6);
    root.rotation.y = Math.PI / 2;
    root.scale.setScalar(1.5);
    root.updateWorldMatrix(true, true);
    const expected = root.localToWorld(new THREE.Vector3(0, 2.72, 0.65));
    const playerPosition = new THREE.Vector3(-2, 0.02, 4);
    const playerVelocity = new THREE.Vector3(3, -1, 2);
    const syncCamera = vi.fn();
    const showToast = vi.fn();
    const game = Object.create(WhiteRoomGame.prototype) as Record<string, unknown>;
    Object.assign(game, { playerPosition, playerVelocity, syncCamera, showToast });
    const handleInteraction = (WhiteRoomGame.prototype as unknown as {
      handleLocalLobbyPropInteraction(
        this: Record<string, unknown>,
        interaction: LobbyLocalPropInteractionUse,
      ): void;
    }).handleLocalLobbyPropInteraction;

    handleInteraction.call(game, {
      objectId: 'tower-object-001',
      catalogId: 'code-trump-tower-residences',
      name: 'Trump 大厦高级公寓',
      sequence: 2,
      ageSeconds: 0,
      durationMs: 0,
      root,
    });

    expect(playerPosition.distanceTo(expected)).toBeLessThan(1e-8);
    expect(playerVelocity.toArray()).toEqual([0, 0, 0]);
    expect(syncCamera).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith('Trump 大厦 · 已抵达 52F 高级公寓', 1800);
  });

  it('does not change the player for unrelated local prop interactions', () => {
    const playerPosition = new THREE.Vector3(1, 2, 3);
    const playerVelocity = new THREE.Vector3(4, 5, 6);
    const syncCamera = vi.fn();
    const showToast = vi.fn();
    const game = Object.create(WhiteRoomGame.prototype) as Record<string, unknown>;
    Object.assign(game, { playerPosition, playerVelocity, syncCamera, showToast });
    const handleInteraction = (WhiteRoomGame.prototype as unknown as {
      handleLocalLobbyPropInteraction(
        this: Record<string, unknown>,
        interaction: LobbyLocalPropInteractionUse,
      ): void;
    }).handleLocalLobbyPropInteraction;

    handleInteraction.call(game, {
      objectId: 'other-object-001',
      catalogId: 'code-glow-cube',
      name: '呼吸光立方',
      sequence: 1,
      ageSeconds: 0,
      durationMs: 0,
      root: new THREE.Group(),
    });

    expect(playerPosition.toArray()).toEqual([1, 2, 3]);
    expect(playerVelocity.toArray()).toEqual([4, 5, 6]);
    expect(syncCamera).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
