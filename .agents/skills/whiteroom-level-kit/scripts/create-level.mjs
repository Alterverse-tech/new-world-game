#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoverPng, LEVEL_TYPES, parseArgs, slugify } from './lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(SCRIPT_DIR, '../assets/level-template');

function usage() {
  return `用法：
  node create-level.mjs --dir ./my-level --name "关卡名" --author "署名" \\
    --type reach_zone --objective "抵达尽头的光门" [--slug my-level]

类型：reach_zone | collect | puzzle | survive | eliminate | escape | custom`;
}

function mechanicFor(type) {
  const mechanics = {
    reach_zone: `const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(3, 4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x36d9ff, emissive: 0x0b7088 }),
  );
  beacon.position.set(0, 2, -8);
  sdk.scene.add(beacon);
  sdk.helpers.triggerZone({ position: [0, 1.5, -7.4], size: [3, 3, 2], goal: true, visible: false });`,
    collect: `const points = [[-5, 1, -5], [0, 1, -7], [5, 1, -5]];
  sdk.helpers.collectible({ position: points[0], preset: 'orb', id: 'light-1' });
  sdk.helpers.collectible({ position: points[1], preset: 'orb', id: 'light-2' });
  sdk.helpers.collectible({ position: points[2], preset: 'orb', id: 'light-3' });`,
    puzzle: `sdk.helpers.button({ position: [-4, 0.5, -4], label: '左侧信号', flag: 'signal-a', once: true });
  sdk.helpers.button({ position: [0, 0.5, -7], label: '中央信号', flag: 'signal-b', once: true });
  sdk.helpers.button({ position: [4, 0.5, -4], label: '右侧信号', flag: 'signal-c', once: true });`,
    survive: `const safeRing = new THREE.Mesh(
    new THREE.TorusGeometry(4, 0.12, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x36d9ff, emissive: 0x164955 }),
  );
  safeRing.rotation.x = Math.PI / 2;
  safeRing.position.y = 0.04;
  sdk.scene.add(safeRing);
  sdk.ui.toast('留在平台上，直到计时结束', 3200);`,
    eliminate: `const targetMaterial = new THREE.MeshStandardMaterial({ color: 0xff7a70, emissive: 0x5b1814 });
  const makeTarget = (x, z) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2, 16), targetMaterial.clone());
    mesh.position.set(x, 1, z);
    sdk.scene.add(mesh);
    sdk.helpers.target({ mesh, hits: 1, onDown: () => { mesh.visible = false; } });
  };
  makeTarget(-4, -5);
  makeTarget(0, -8);
  makeTarget(4, -5);`,
    escape: `sdk.helpers.button({ position: [-4, 0.5, -4], label: '恢复电力', flag: 'power', once: true });
  sdk.helpers.button({ position: [4, 0.5, -4], label: '取得钥匙', flag: 'key', once: true });
  const exit = new THREE.Mesh(
    new THREE.BoxGeometry(3, 4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x36d9ff, emissive: 0x0b7088 }),
  );
  exit.position.set(0, 2, -8);
  sdk.scene.add(exit);
  sdk.helpers.triggerZone({ position: [0, 1.5, -7.4], size: [3, 3, 2], goal: true, visible: false });`,
    custom: `const finish = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb875ff, emissive: 0x472568 }),
  );
  finish.position.set(0, 1.5, -8);
  sdk.scene.add(finish);
  sdk.helpers.triggerZone({
    position: [0, 1.5, -8],
    size: [2.5, 3, 2.5],
    once: true,
    visible: false,
    onEnter: () => sdk.state.complete(),
  });`,
  };
  return mechanics[type];
}

function winConditionFor(type) {
  if (type === 'collect') return { type, required: 3 };
  if (type === 'puzzle') return { type, flags: ['signal-a', 'signal-b', 'signal-c'] };
  if (type === 'survive') return { type, duration: 45 };
  if (type === 'escape') return { type, flags: ['power', 'key'] };
  return { type };
}

function solutionFor(type) {
  const solutions = {
    reach_zone: '沿完整地面前进，进入尽头青色光门的触发区域。',
    collect: '依次触碰左侧、中央和右侧三枚光球，收集计数达到 3/3。',
    puzzle: '走近三座按钮并按 E，令 signal-a、signal-b、signal-c 全部点亮。',
    survive: '保持在主平台上且不要跌落，存活 45 秒。',
    eliminate: '走近三座红色目标并按 E，各命中一次，清除全部目标。',
    escape: '分别走近电力与钥匙按钮按 E，两个旗标完成后进入尽头出口。',
    custom: '进入尽头紫色球体区域，触发关卡自定义完成判定。',
  };
  return solutions[type];
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    return;
  }
  const name = String(args.name ?? '').trim();
  const author = String(args.author ?? '').trim();
  const type = String(args.type ?? 'reach_zone');
  const objective = String(args.objective ?? '').trim();
  if (!args.dir || !name || !author || !objective || !LEVEL_TYPES.has(type)) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const target = path.resolve(String(args.dir));
  try {
    const existing = await fs.readdir(target);
    if (existing.length > 0 && !args.force) throw new Error(`目标目录非空：${target}（如需覆盖模板文件，添加 --force）`);
  } catch (caught) {
    if (caught.code !== 'ENOENT') throw caught;
  }
  await fs.mkdir(path.join(target, 'assets'), { recursive: true });
  const templateManifest = JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, 'level.json'), 'utf8'));
  const slug = slugify(args.slug ?? name);
  const manifest = {
    ...templateManifest,
    id: `${slug}-000000`,
    name,
    author: { name: author },
    description: String(args.description ?? `${name}：一个由 WhiteRoom 创作者生成的可完成空间。`),
    type,
    winCondition: winConditionFor(type),
    objective,
    difficulty: Number(args.difficulty ?? 2),
    estimatedMinutes: Number(args.minutes ?? 3),
    tags: [type, '几何'],
  };
  if (type === 'custom') manifest.objectiveDetail = String(args['objective-detail'] ?? `${objective}；进入紫色终点后由关卡代码显式完成。`);
  await fs.writeFile(path.join(target, 'level.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const mainTemplate = await fs.readFile(path.join(TEMPLATE_DIR, 'main.js'), 'utf8');
  await fs.writeFile(path.join(target, 'main.js'), mainTemplate.replace('/*__MECHANIC__*/', mechanicFor(type)), 'utf8');
  const solutionTemplate = await fs.readFile(path.join(TEMPLATE_DIR, 'solution.md'), 'utf8');
  await fs.writeFile(
    path.join(target, 'solution.md'),
    solutionTemplate.replaceAll('__NAME__', name).replace('__SOLUTION__', solutionFor(type)),
    'utf8',
  );
  const cover = await createCoverPng(path.join(target, 'cover.png'));
  console.log(JSON.stringify({ ok: true, dir: target, id: manifest.id, type, cover }, null, 2));
}

main().catch((caught) => {
  console.error(`创建失败：${caught.message}`);
  process.exitCode = 1;
});
