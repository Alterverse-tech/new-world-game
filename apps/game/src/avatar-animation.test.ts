import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  avatarAnimationCompatibility,
  isWhiteRoomStandardAvatarRig,
  resolveUploadedAvatarAnimationClips,
  type SharedAvatarAnimationClips,
  WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS,
} from './avatar-animation';

const STANDARD_BONES = WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS.map(([name]) => name);

function rig(
  topology: ReadonlyArray<readonly [string, string | null]> = WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS,
): THREE.Group {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name] of topology) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones.set(name, bone);
  }
  for (const [name, parent] of topology) {
    const bone = bones.get(name)!;
    if (parent) bones.get(parent)?.add(bone);
  }
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const rootBones = topology.filter(([, parent]) => parent === null).map(([name]) => bones.get(name)!);
  mesh.add(...rootBones);
  mesh.bind(new THREE.Skeleton([...bones.values()]));
  root.add(mesh);
  return root;
}

function clip(name: string, bones = STANDARD_BONES, duration = 1): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, bones.map((bone, index) => new THREE.QuaternionKeyframeTrack(
    `${bone}.quaternion`,
    [0, duration],
    [0, 0, 0, 1, 0, Math.sin((index + 1) * 0.01), 0, Math.cos((index + 1) * 0.01)],
  )));
}

const shared: SharedAvatarAnimationClips = {
  idle: clip('NlaTrack', STANDARD_BONES, 2),
  walk: clip('NlaTrack', STANDARD_BONES, 1.2),
};

describe('uploaded Avatar animation resolution', () => {
  it('uses the authored generic clip for running and the compatible shared pose for standing', () => {
    const authored = clip('NlaTrack', STANDARD_BONES, 1.29);
    const result = resolveUploadedAvatarAnimationClips(rig(), [authored], shared, 'avatar-person-pose');
    expect(result.idle?.name).toBe('avatar-person-pose:idle');
    expect(result.walk?.name).toBe('avatar-person-pose:walk');
    expect(result.idleSource).toBe('shared');
    expect(result.walkSource).toBe('embedded');
    expect(result.idle).not.toBe(shared.idle);
    expect(result.walk).not.toBe(authored);
    expect(isWhiteRoomStandardAvatarRig(rig())).toBe(true);
  });

  it('animates a compatible static rig from the shared idle and walk clips', () => {
    const result = resolveUploadedAvatarAnimationClips(rig(), [], shared, 'avatar-static-rig');
    expect(result.idleSource).toBe('shared');
    expect(result.walkSource).toBe('shared');
    expect(result.idle?.tracks).toHaveLength(STANDARD_BONES.length);
    expect(result.walk?.tracks).toHaveLength(STANDARD_BONES.length);
  });

  it('does not apply shared tracks to an incompatible skeleton', () => {
    const otherTopology: ReadonlyArray<readonly [string, string | null]> = [
      ['mixamorigHips', null], ['mixamorigSpine', 'mixamorigHips'], ['mixamorigLeftLeg', 'mixamorigHips'],
    ];
    const model = rig(otherTopology);
    expect(avatarAnimationCompatibility(model, shared.walk)).toEqual({
      compatible: false,
      matchedBoneTargets: 0,
      totalBoneTargets: STANDARD_BONES.length,
    });
    expect(resolveUploadedAvatarAnimationClips(model, [], shared, 'avatar-other-rig')).toMatchObject({
      idle: null,
      walk: null,
      idleSource: 'none',
      walkSource: 'none',
    });
  });

  it('freezes an authored generic clip as a safe standing pose when shared tracks cannot bind', () => {
    const ownTopology: ReadonlyArray<readonly [string, string | null]> = [
      ['mixamorigHips', null], ['mixamorigLeftLeg', 'mixamorigHips'], ['mixamorigRightLeg', 'mixamorigHips'],
    ];
    const ownBones = ownTopology.map(([name]) => name);
    const authored = clip('Take 001', ownBones, 1.4);
    const result = resolveUploadedAvatarAnimationClips(rig(ownTopology), [authored], shared, 'avatar-other-rig');
    expect(result.idleSource).toBe('frozen-walk');
    expect(result.walkSource).toBe('embedded');
    expect(result.idle?.name).toBe('avatar-other-rig:idle');
    expect(result.walk?.name).toBe('avatar-other-rig:walk');
    expect(result.idle?.uuid).not.toBe(result.walk?.uuid);
  });

  it('prefers explicit embedded idle and run names', () => {
    const idle = clip('Breathing Idle');
    const run = clip('Fast Run');
    const result = resolveUploadedAvatarAnimationClips(rig(), [idle, run], shared, 'avatar-named');
    expect(result.idleSource).toBe('embedded');
    expect(result.walkSource).toBe('embedded');
    expect(result.idle?.duration).toBe(idle.duration);
    expect(result.walk?.duration).toBe(run.duration);
  });

  it('rejects loose bones and a partial standard skeleton without a bound SkinnedMesh', () => {
    const loose = new THREE.Group();
    for (const [name] of WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS) {
      const bone = new THREE.Bone();
      bone.name = name;
      loose.add(bone);
    }
    expect(avatarAnimationCompatibility(loose, shared.idle).compatible).toBe(false);
    expect(isWhiteRoomStandardAvatarRig(loose)).toBe(false);
    expect(avatarAnimationCompatibility(rig(WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS.slice(0, 20)), shared.idle).compatible).toBe(false);
  });

  it('does not mistake a static unnamed pose clip for locomotion', () => {
    const values = [0, 0, 0, 1, 0, 0, 0, 1];
    const pose = new THREE.AnimationClip('NlaTrack', 1, [
      new THREE.QuaternionKeyframeTrack('L_Thigh.quaternion', [0, 1], values),
      new THREE.QuaternionKeyframeTrack('R_Thigh.quaternion', [0, 1], values),
    ]);
    const result = resolveUploadedAvatarAnimationClips(rig(), [pose], { idle: null, walk: null }, 'avatar-pose');
    expect(result.idleSource).toBe('frozen-walk');
    expect(result.walkSource).toBe('none');
    expect(result.idle?.name).toBe('avatar-pose:idle');
    expect(result.walk).toBeNull();
  });
});
