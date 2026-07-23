import * as THREE from 'three';

const IDLE_CLIP_PATTERN = /idle|stand|breath/i;
const WALK_CLIP_PATTERN = /walk|run|jog|sprint/i;

export const WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS: ReadonlyArray<readonly [string, string | null]> = Object.freeze([
  ['Root', null],
  ['Hip', 'Root'],
  ['Pelvis', 'Hip'],
  ['L_Thigh', 'Pelvis'],
  ['L_Calf', 'L_Thigh'],
  ['L_Foot', 'L_Calf'],
  ['L_ToeBase', 'L_Foot'],
  ['L_CalfTwist01', 'L_Calf'],
  ['L_CalfTwist02', 'L_CalfTwist01'],
  ['L_ThighTwist01', 'L_Thigh'],
  ['L_ThighTwist02', 'L_ThighTwist01'],
  ['R_Thigh', 'Pelvis'],
  ['R_ThighTwist01', 'R_Thigh'],
  ['R_ThighTwist02', 'R_ThighTwist01'],
  ['R_Calf', 'R_Thigh'],
  ['R_Foot', 'R_Calf'],
  ['R_ToeBase', 'R_Foot'],
  ['R_CalfTwist01', 'R_Calf'],
  ['R_CalfTwist02', 'R_CalfTwist01'],
  ['Waist', 'Hip'],
  ['Spine01', 'Waist'],
  ['Spine02', 'Spine01'],
  ['NeckTwist01', 'Spine02'],
  ['NeckTwist02', 'NeckTwist01'],
  ['Head', 'NeckTwist02'],
  ['L_Clavicle', 'Spine02'],
  ['L_Upperarm', 'L_Clavicle'],
  ['L_Forearm', 'L_Upperarm'],
  ['L_ForearmTwist01', 'L_Forearm'],
  ['L_ForearmTwist02', 'L_ForearmTwist01'],
  ['L_Hand', 'L_Forearm'],
  ['L_UpperarmTwist01', 'L_Upperarm'],
  ['L_UpperarmTwist02', 'L_UpperarmTwist01'],
  ['R_Clavicle', 'Spine02'],
  ['R_Upperarm', 'R_Clavicle'],
  ['R_UpperarmTwist01', 'R_Upperarm'],
  ['R_UpperarmTwist02', 'R_UpperarmTwist01'],
  ['R_Forearm', 'R_Upperarm'],
  ['R_ForearmTwist01', 'R_Forearm'],
  ['R_ForearmTwist02', 'R_ForearmTwist01'],
  ['R_Hand', 'R_Forearm'],
]);

export interface SharedAvatarAnimationClips {
  idle: THREE.AnimationClip | null;
  walk: THREE.AnimationClip | null;
}

export interface ResolvedAvatarAnimationClips {
  idle: THREE.AnimationClip | null;
  walk: THREE.AnimationClip | null;
  idleSource: 'embedded' | 'shared' | 'frozen-walk' | 'none';
  walkSource: 'embedded' | 'shared' | 'none';
}

export interface AvatarAnimationCompatibility {
  compatible: boolean;
  matchedBoneTargets: number;
  totalBoneTargets: number;
}

function trackBoneTarget(track: THREE.KeyframeTrack): string | null {
  try {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (!['position', 'quaternion', 'scale'].includes(parsed.propertyName)) return null;
    if (parsed.objectName === 'bones' && parsed.objectIndex) return parsed.objectIndex;
    return parsed.nodeName || null;
  } catch {
    return null;
  }
}

function skeletonBoneMap(mesh: THREE.SkinnedMesh): Map<string, THREE.Bone> {
  return new Map(mesh.skeleton.bones.filter((bone) => bone.name).map((bone) => [bone.name, bone]));
}

function hasStandardAvatarTopology(bones: ReadonlyMap<string, THREE.Bone>): boolean {
  return WHITE_ROOM_STANDARD_AVATAR_BONE_PARENTS.every(([name, expectedParent]) => {
    const bone = bones.get(name);
    if (!bone) return false;
    const parentName = (bone.parent as THREE.Bone | null)?.isBone ? bone.parent?.name ?? null : null;
    return parentName === expectedParent;
  });
}

function avatarSkeletons(model: THREE.Object3D): Array<Map<string, THREE.Bone>> {
  const skeletons: Array<Map<string, THREE.Bone>> = [];
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) skeletons.push(skeletonBoneMap(mesh));
  });
  return skeletons;
}

export function isWhiteRoomStandardAvatarRig(model: THREE.Object3D): boolean {
  return avatarSkeletons(model).some(hasStandardAvatarTopology);
}

function trackChanges(track: THREE.KeyframeTrack, minimumDelta = 0.015): boolean {
  const valueSize = track.getValueSize();
  if (valueSize <= 0 || track.values.length < valueSize * 2) return false;
  for (let offset = valueSize; offset + valueSize <= track.values.length; offset += valueSize) {
    let squaredDelta = 0;
    for (let component = 0; component < valueSize; component += 1) {
      const delta = track.values[offset + component]! - track.values[component]!;
      squaredDelta += delta * delta;
    }
    if (Math.sqrt(squaredDelta) >= minimumDelta) return true;
  }
  return false;
}

function isGenericLocomotionClip(clip: THREE.AnimationClip): boolean {
  let leftLegMoves = false;
  let rightLegMoves = false;
  for (const track of clip.tracks) {
    const target = trackBoneTarget(track);
    if (!target || !trackChanges(track)) continue;
    if (/^L_(?:Thigh|Calf|Foot|ToeBase)/.test(target) || /left.*(?:upleg|leg|foot)/i.test(target)) leftLegMoves = true;
    if (/^R_(?:Thigh|Calf|Foot|ToeBase)/.test(target) || /right.*(?:upleg|leg|foot)/i.test(target)) rightLegMoves = true;
  }
  return leftLegMoves && rightLegMoves;
}

/**
 * Shared clips are safe only when their tracks can bind directly to the uploaded
 * skeleton. This deliberately rejects "similar looking" rigs with different
 * bone names instead of silently deforming them.
 */
export function avatarAnimationCompatibility(
  model: THREE.Object3D,
  clip: THREE.AnimationClip | null,
): AvatarAnimationCompatibility {
  if (!clip) return { compatible: false, matchedBoneTargets: 0, totalBoneTargets: 0 };
  const skeletons = avatarSkeletons(model);
  const targets = new Set(clip.tracks.map(trackBoneTarget).filter((name): name is string => Boolean(name)));
  const totalBoneTargets = targets.size;
  const matchedBySkeleton = skeletons.map((bones) => [...targets].filter((name) => bones.has(name)).length);
  const matchedBoneTargets = Math.max(0, ...matchedBySkeleton);
  return {
    compatible: totalBoneTargets > 0 && skeletons.some((bones) => (
      hasStandardAvatarTopology(bones) && [...targets].every((name) => bones.has(name))
    )),
    matchedBoneTargets,
    totalBoneTargets,
  };
}

function namedClone(clip: THREE.AnimationClip | null | undefined, name: string): THREE.AnimationClip | null {
  if (!clip) return null;
  const result = clip.clone();
  result.name = name;
  return result;
}

/**
 * Uploaded files often expose a single exporter-generated clip such as
 * "NlaTrack". Keep that authored motion as locomotion, and add the WhiteRoom
 * standing/walk clips only when their bone targets match the uploaded rig.
 */
export function resolveUploadedAvatarAnimationClips(
  model: THREE.Object3D,
  embedded: readonly THREE.AnimationClip[],
  shared: SharedAvatarAnimationClips,
  avatarId: string,
): ResolvedAvatarAnimationClips {
  const explicitIdle = embedded.find((clip) => IDLE_CLIP_PATTERN.test(clip.name)) ?? null;
  const explicitWalk = embedded.find((clip) => WALK_CLIP_PATTERN.test(clip.name)) ?? null;
  const genericLocomotion = embedded.find((clip) => (
    clip !== explicitIdle && clip !== explicitWalk && isGenericLocomotionClip(clip)
  )) ?? null;
  const frozenEmbeddedPose = embedded.find((clip) => clip !== explicitWalk) ?? null;
  const sharedIdle = avatarAnimationCompatibility(model, shared.idle).compatible ? shared.idle : null;
  const sharedWalk = avatarAnimationCompatibility(model, shared.walk).compatible ? shared.walk : null;

  const walk = explicitWalk ?? genericLocomotion ?? sharedWalk;
  const idle = explicitIdle ?? sharedIdle ?? walk ?? frozenEmbeddedPose;
  const clipPrefix = avatarId || 'uploaded-avatar';
  return {
    idle: namedClone(idle, `${clipPrefix}:idle`),
    walk: namedClone(walk, `${clipPrefix}:walk`),
    idleSource: explicitIdle
      ? 'embedded'
      : sharedIdle
        ? 'shared'
        : idle
          ? 'frozen-walk'
          : 'none',
    walkSource: explicitWalk || genericLocomotion ? 'embedded' : sharedWalk ? 'shared' : 'none',
  };
}
