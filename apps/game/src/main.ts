import './style.css';
import './openai-theme.css';
import { AccountController } from './account-controller';
import { WhiteRoomGame } from './white-room-game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('WhiteRoom canvas was not found');

const account = new AccountController();
await account.initialize();
const game = new WhiteRoomGame(canvas, account);
game.start();

window.render_game_to_text = () => {
  const state = JSON.parse(game.renderGameToText()) as Record<string, unknown>;
  state.account = account.getTextState();
  return JSON.stringify(state);
};
window.advanceTime = (ms: number) => game.advanceTime(ms);
Object.defineProperty(window, '__THREE_GAME_DIAGNOSTICS__', {
  configurable: false,
  enumerable: false,
  get: () => {
    const state = JSON.parse(game.renderGameToText()) as {
      diagnostics: Window['__THREE_GAME_DIAGNOSTICS__'];
    };
    return state.diagnostics;
  },
});
