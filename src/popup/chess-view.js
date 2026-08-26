import { fileOf, legalMoves, rankOf, toAlgebraic } from '../lib/chess.js';
import {
  encodeAccept,
  encodeDecline,
  encodeInvite,
  encodeMove,
  encodeResign,
  isMyTurn,
  readGame,
  sideOf,
} from '../lib/chess-protocol.js';

const el = (id) => document.getElementById(id);

const ui = {
  panel: el('chess-panel'),
  status: el('chess-status'),
  board: el('chess-board'),
  actions: el('chess-actions'),
  promo: el('chess-promo'),
};

const GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

let sendMessage = async () => {};
let game = null;
let selfKaid = null;
/** Square the player has picked up, and where it may legally go. */
let selected = null;
let targets = [];
/** Set while a promotion picker is waiting on a choice. */
let pendingPromotion = null;

/* -------------------------------- sending ------------------------------- */

async function post(text) {
  // Optimistically clear the selection so the board does not look stuck.
  selected = null;
  targets = [];
  await sendMessage(text);
}

/* --------------------------------- board -------------------------------- */

/** Board is drawn from the mover's point of view, so your pieces are nearest. */
function orientation() {
  return sideOf(game, selfKaid) === 'b' ? 'b' : 'w';
}

function squaresInDrawOrder() {
  const squares = [...Array(64).keys()];
  return orientation() === 'b' ? squares.reverse() : squares;
}

function drawBoard() {
  const state = game?.state;
  if (!state) {
    ui.board.replaceChildren();
    ui.board.hidden = true;
    return;
  }
  ui.board.hidden = false;

  const last = game.lastMove
    ? [game.lastMove.slice(0, 2), game.lastMove.slice(2, 4)]
    : [];

  const cells = squaresInDrawOrder().map((sq) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    const dark = (fileOf(sq) + rankOf(sq)) % 2 === 1;

    cell.className = ['sq', dark ? 'sq--dark' : 'sq--light'].join(' ');
    cell.dataset.square = String(sq);

    const name = toAlgebraic(sq);
    if (last.includes(name)) cell.classList.add('sq--last');
    if (selected === sq) cell.classList.add('sq--selected');

    const piece = state.board[sq];
    if (piece) {
      const glyph = document.createElement('span');
      glyph.className = `piece piece--${piece === piece.toUpperCase() ? 'white' : 'black'}`;
      glyph.textContent = GLYPHS[piece];
      cell.append(glyph);
    }

    if (targets.includes(sq)) {
      const dot = document.createElement('span');
      dot.className = piece ? 'target target--capture' : 'target';
      cell.append(dot);
    }

    cell.addEventListener('click', () => onSquare(sq));
    return cell;
  });

  ui.board.replaceChildren(...cells);
}

function onSquare(sq) {
  if (!game || game.phase !== 'playing' || pendingPromotion) return;
  if (!isMyTurn(game, selfKaid)) return;

  const moves = legalMoves(game.state);

  if (selected !== null && targets.includes(sq)) {
    const options = moves.filter((m) => m.from === selected && m.to === sq);
    const promotions = options.filter((m) => m.promotion);

    if (promotions.length) {
      pendingPromotion = { from: selected, to: sq };
      renderPromotion();
      return;
    }

    post(encodeMove(toAlgebraic(selected) + toAlgebraic(sq)));
    return;
  }

  // Picking up (or swapping to) one of your own pieces.
  const mine = moves.filter((m) => m.from === sq);
  if (mine.length) {
    selected = sq;
    targets = [...new Set(mine.map((m) => m.to))];
  } else {
    selected = null;
    targets = [];
  }
  drawBoard();
}

/* ------------------------------- promotion ------------------------------ */

function renderPromotion() {
  if (!pendingPromotion) {
    ui.promo.hidden = true;
    return;
  }

  const white = game.state.turn === 'w';
  ui.promo.hidden = false;
  ui.promo.replaceChildren(
    Object.assign(document.createElement('span'), {
      className: 'promo-label',
      textContent: 'Promote to',
    }),
    ...['q', 'r', 'b', 'n'].map((kind) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'promo-pick';
      button.textContent = GLYPHS[white ? kind.toUpperCase() : kind];
      button.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[kind];
      button.addEventListener('click', () => {
        const { from, to } = pendingPromotion;
        pendingPromotion = null;
        ui.promo.hidden = true;
        post(encodeMove(toAlgebraic(from) + toAlgebraic(to) + kind));
      });
      return button;
    }),
  );
}

/* -------------------------------- status -------------------------------- */

function statusLine() {
  if (!game || game.phase === 'none') return 'No game yet.';

  if (game.phase === 'invited') {
    return game.isMine
      ? `Invitation sent — you as ${game.side === 'w' ? 'White' : 'Black'}.`
      : `${game.inviter.nickname} wants to play, as ${game.side === 'w' ? 'White' : 'Black'}.`;
  }

  if (game.phase === 'declined') return 'That invitation was declined.';

  const me = sideOf(game, selfKaid);
  const names = `${game.white.nickname} (White) v ${game.black.nickname} (Black)`;

  if (game.phase === 'over') {
    const outcome =
      game.result === 'draw'
        ? `Draw by ${game.reason}`
        : `${game.result === 'w' || game.result === 'white' ? game.white.nickname : game.black.nickname} wins by ${game.reason}`;
    return `${outcome}. ${names}`;
  }

  const turnName = game.state.turn === 'w' ? game.white.nickname : game.black.nickname;
  const check = game.reason === 'check' ? ' — check!' : '';

  if (!me) return `${turnName} to move${check}. ${names}`;
  return isMyTurn(game, selfKaid)
    ? `Your move${check}.`
    : `Waiting for ${turnName}${check}.`;
}

/* -------------------------------- actions ------------------------------- */

function action(label, text, kind = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ['chess-btn', kind].filter(Boolean).join(' ');
  button.textContent = label;
  button.addEventListener('click', () => post(text));
  return button;
}

function drawActions() {
  const buttons = [];
  const phase = game?.phase ?? 'none';

  if (phase === 'none' || phase === 'declined' || phase === 'over') {
    buttons.push(action('Play as White', encodeInvite('w')));
    buttons.push(action('Play as Black', encodeInvite('b')));
  } else if (phase === 'invited') {
    if (game.isMine) {
      buttons.push(action('Cancel', encodeDecline(), 'chess-btn--quiet'));
    } else {
      buttons.push(action('Accept', encodeAccept()));
      buttons.push(action('Decline', encodeDecline(), 'chess-btn--quiet'));
    }
  } else if (phase === 'playing' && sideOf(game, selfKaid)) {
    buttons.push(action('Resign', encodeResign(), 'chess-btn--quiet'));
  }

  ui.actions.replaceChildren(...buttons);
}

/* --------------------------------- api ---------------------------------- */

export function isOpen() {
  return !ui.panel.hidden;
}

export function toggle() {
  ui.panel.hidden = !ui.panel.hidden;
}

export function close() {
  ui.panel.hidden = true;
}

/** True when the room has a game worth flagging on the button. */
export function hasGame(messages, kaid) {
  const g = readGame(messages, kaid);
  return g.phase === 'invited' || g.phase === 'playing';
}

export function render(chat, kaid) {
  selfKaid = kaid;
  const next = readGame(chat.messages, kaid);

  // A new position invalidates whatever the player had picked up.
  if (game?.moveCount !== next.moveCount || game?.phase !== next.phase) {
    selected = null;
    targets = [];
    pendingPromotion = null;
    ui.promo.hidden = true;
  }
  game = next;

  ui.status.textContent = statusLine();
  drawBoard();
  drawActions();
}

export function setup({ onSend }) {
  sendMessage = onSend;
}
