import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(deployDirectory, '../..');
const gameDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repository, 'public/game');
const indexPath = path.join(gameDirectory, 'index.html');
const overlayName = 'game-experience-20260721.js';
const overlaySource = path.join(deployDirectory, 'whiteroom-game-experience.js');
const overlayTarget = path.join(gameDirectory, 'assets', overlayName);

function replaceExactlyOnce(source, target, replacement, description) {
  const first = source.indexOf(target);
  if (first === -1) throw new Error('Unable to patch ' + description);
  if (source.indexOf(target, first + target.length) !== -1) {
    throw new Error('Ambiguous patch target for ' + description);
  }
  return source.slice(0, first) + replacement + source.slice(first + target.length);
}

await copyFile(overlaySource, overlayTarget);

let html = await readFile(indexPath, 'utf8');
if (!html.includes('id="quit-game-btn"')) {
  const settingsButton = '<button id="settings-btn" class="menu-btn">设置</button>';
  html = replaceExactlyOnce(
    html,
    settingsButton,
    settingsButton + '\n            <button id="quit-game-btn" class="menu-btn danger">退出游戏</button>',
    'pause menu exit action',
  );
}

if (!html.includes('./assets/' + overlayName)) {
  const moduleScript = html.match(/    <script type="module"[^>]+src="\.\/assets\/index-[^"]+\.js[^>]*><\/script>/u)?.[0];
  if (!moduleScript) throw new Error('Unable to locate the game module script');
  html = replaceExactlyOnce(
    html,
    moduleScript,
    '    <script src="./assets/' + overlayName + '?v=game1" defer></script>\n' + moduleScript,
    'game experience script',
  );
}
await writeFile(indexPath, html);

const bundleName = html.match(/src="\.\/assets\/(index-[^"]+\.js)(?:\?[^"]*)?"/u)?.[1];
if (!bundleName) throw new Error('Unable to locate the game bundle');
const bundlePath = path.join(gameDirectory, 'assets', bundleName);
let bundle = await readFile(bundlePath, 'utf8');
const hiddenSelfLabel = 'const a=W0(t.name);a.visible=!i,o.add(r.root,a)';
const visibleSelfLabel = 'const a=W0(t.name);a.visible=!0,o.add(r.root,a)';
if (bundle.includes(hiddenSelfLabel)) {
  bundle = replaceExactlyOnce(
    bundle,
    hiddenSelfLabel,
    visibleSelfLabel,
    'third-person self nickname',
  );
  await writeFile(bundlePath, bundle);
} else if (!bundle.includes(visibleSelfLabel)) {
  throw new Error('Unable to verify the third-person self nickname patch');
}

console.log('WhiteRoom game experience patch applied');
