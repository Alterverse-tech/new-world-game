import './style.css';
import './openai-theme.css';
import { AccountController } from './account-controller';
import { AccountAuthService } from './account-auth-service';
import { captureRecoveryHash } from './account-recovery-flow';
import { WhiteRoomGame } from './white-room-game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('WhiteRoom canvas was not found');

const recoveryHash = captureRecoveryHash({ location: window.location, replaceState: window.history.replaceState.bind(window.history) });
const account = new AccountController(new AccountAuthService(), recoveryHash);
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
