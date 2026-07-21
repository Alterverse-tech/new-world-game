# Level SDK v1

入口必须自包含并默认导出：

```js
export default function createLevel(sdk) {
  // 构建场景并注册机关
  return { onUpdate(dt, elapsed) {}, onDispose() {} };
}
```

不得 import Three.js。使用 Shell 注入的 `sdk.THREE`；所有对象加入 `sdk.scene`，静态实体同时调用 `sdk.physics.addCollider(mesh)`。

## 当前开放的核心对象

- `sdk.THREE`: 锁定版本的 Three.js。
- `sdk.scene`: 本关根 `THREE.Group`。
- `sdk.random`: `next()`、`range(a,b)`、`pick(array)`，用于可复现随机。
- `sdk.scene`: 本关根 `THREE.Group`，另有 `addBox(options)`、`addCylinder(options)`、`addSphere(options)`、`addText(options)` 便利方法。
- `sdk.player`: `getPosition()`、`spawn(pos,yawDeg?)`、`teleport(pos,yawDeg?)`、`setCheckpoint(pos?,yawDeg?)`。
- `sdk.physics`: `addCollider(object)`。
- `sdk.state`: `setFlag(name,value?)`、`getFlag(name)`、`complete()`/`win()`（仅 custom）、`fail(reason,opts?)`。
- `sdk.objective`: `set(text)`、`updateProgress(text)`。
- `sdk.ui`: `toast(text,ms?)`、`subtitle(text,ms?)`。
- `sdk.env`: `setBackground(colorOrPreset)`、`setFog(color,near,far)`、`addSun(opts)`、`setAmbient(color,intensity)`。

## 机关 helpers

```js
sdk.helpers.triggerZone({ position, size, goal, once, visible, onEnter, onExit });
sdk.helpers.goalZone({ position, size, visible });
sdk.helpers.collectible({ position, mesh, preset: 'orb'|'cube'|'star', id, onCollect });
sdk.helpers.button({ position, label, flag, once, onPress });
sdk.helpers.pressurePlate({ position, size, flag, once, onPress });
sdk.helpers.target({ mesh, hits, onDown });
sdk.helpers.label(position, text, { size, color });
```

`reach_zone`/`escape` 至少注册一个 `goal:true` zone；`collect` 至少注册 required 个 collectible；`puzzle`/`escape` 必须能设置清单里的每个 flag；`eliminate` 至少注册一个 target。

## 场景配方

```js
const { THREE } = sdk;
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(16, 1, 16),
  new THREE.MeshStandardMaterial({ color: 0xe9eef4, roughness: 0.86 })
);
floor.position.set(0, -0.5, 0);
floor.receiveShadow = true;
sdk.scene.add(floor);
sdk.physics.addCollider(floor);
```

还可用 `sdk.interact.register(object,{label,onUse,maxDistance?})` 注册 E 键交互。关卡退出时 Shell 会回收根节点内资源；自建监听器、计时器或非场景资源仍要在 `onDispose` 清理。

未在本页列出的方法当前不属于公开运行时；不要根据完整产品说明书中的预留接口猜测调用。
