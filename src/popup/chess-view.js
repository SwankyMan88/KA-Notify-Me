import {
  applyMove,
  fileOf,
  fromAlgebraic,
  legalMoves,
  rankOf,
  toAlgebraic,
} from '../lib/chess.js';
import { MOVE_COOLDOWN_MS } from '../lib/constants.js';
import {
  encodeAccept,
  encodeDecline,
  encodeInvite,
  encodeMoves,
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
  error: el('chess-error'),
  cooldown: el('chess-cooldown'),
};

const GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const MOVE_MS = 190;

/** @returns {Promise<boolean>} whether the message actually sent */
let sendMessage = async () => false;

let game = null;
let selfKaid = null;

/**
 * A move is shown the instant you make it rather than after Khan Academy has
 * accepted the message. This holds that guess; it is dropped as soon as the
 * real thread catches up, and rolled back if the send failed.
 */
let optimistic = null;
let sendError = null;

/** The move still to be animated in, and the last one already animated. */
let pendingAnimation = null;
let animatedMove = null;

let selected = null;
let targets = [];
let pendingPromotion = null;

/**
 * When your own last move was posted. Khan Academy rate-limits comments and a
 * fast exchange looks like spam, so the board is held for a minute afterwards.
 */
let lastMoveAt = 0;
let cooldownTimer = null;

function cooldownLeft() {
  return Math.max(0, MOVE_COOLDOWN_MS - (Date.now() - lastMoveAt));
}

function drawCooldown() {
  const left = cooldownLeft();

  if (left <= 0) {
    ui.cooldown.hidden = true;
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    return;
  }

  ui.cooldown.hidden = false;
  ui.cooldown.querySelector('.cooldown-text').textContent =
    `You can move again in ${Math.ceil(left / 1000)}s`;

  // One ticker, not one per render.
  if (!cooldownTimer) {
    cooldownTimer = setInterval(() => {
      drawCooldown();
      if (cooldownLeft() <= 0) paint();
    }, 250);
  }
}

/* --------------------------- what to draw ------------------------------- */

/** The position on screen: the optimistic guess while it is ahead of the thread. */
function shown() {
  if (game && optimistic && optimistic.moveCount > (game.moveCount ?? 0)) {
    return {
      ...game,
      state: optimistic.state,
      moves: optimistic.moves,
      lastMove: optimistic.uci,
      moveCount: optimistic.moveCount,
    };
  }
  return game;
}

/* -------------------------------- sending ------------------------------- */

async function post(text) {
  selected = null;
  targets = [];
  sendError = null;
  paint();

  if ((await sendMessage(text)) === false) {
    sendError = 'That did not send. Try again.';
    paint();
  }
}

/**
 * Plays the move locally first, then sends. Waiting on the round trip made
 * every move feel like a stall; this shows it at once and puts it back if the
 * message never lands.
 */
async function postMove(uci, move) {
  if (cooldownLeft() > 0) return;

  const previous = optimistic;
  const previousMoveAt = lastMoveAt;
  const view = shown();

  optimistic = {
    state: applyMove(view.state, move),
    uci,
    moves: [...(view.moves ?? []), uci],
    moveCount: (view.moveCount ?? 0) + 1,
  };
  pendingAnimation = { uci, captured: Boolean(view.state.board[move.to]) };

  selected = null;
  targets = [];
  sendError = null;
  lastMoveAt = Date.now();
  paint();

  // The whole game travels with every move, so the one it replaces can go.
  if ((await sendMessage(encodeMoves(optimistic.moves), { chessMove: true })) === false) {
    lastMoveAt = previousMoveAt;
    // Put the board back exactly as it was, and say why it moved back.
    optimistic = previous;
    pendingAnimation = null;
    animatedMove = null;
    sendError = 'That move did not send — putting it back.';
    paint();
  }
}

/* --------------------------------- board -------------------------------- */

function orientation() {
  return sideOf(game, selfKaid) === 'b' ? 'b' : 'w';
}

function squaresInDrawOrder() {
  const squares = [...Array(64).keys()];
  return orientation() === 'b' ? squares.reverse() : squares;
}

function drawBoard() {
  const view = shown();
  const state = view?.state;

  if (!state) {
    ui.board.replaceChildren();
    ui.board.hidden = true;
    return;
  }
  ui.board.hidden = false;

  const last = view.lastMove ? [view.lastMove.slice(0, 2), view.lastMove.slice(2, 4)] : [];

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
  runAnimation();
}

/**
 * Slides the moved piece from where it was to where it now is.
 *
 * The board is rebuilt from scratch each time, so the piece is already in its
 * final place: offset it back to the old square and let it travel forwards.
 * Nothing here can fail visibly -- if the squares cannot be found the piece
 * simply appears, which is what used to happen anyway.
 */
function runAnimation() {
  const move = pendingAnimation;
  pendingAnimation = null;
  if (!move || !ui.board.isConnected) return;

  const fromCell = ui.board.querySelector(`[data-square="${fromAlgebraic(move.uci.slice(0, 2))}"]`);
  const toCell = ui.board.querySelector(`[data-square="${fromAlgebraic(move.uci.slice(2, 4))}"]`);
  const piece = toCell?.querySelector('.piece');
  if (!fromCell || !toCell || !piece) return;

  const from = fromCell.getBoundingClientRect();
  const to = toCell.getBoundingClientRect();
  const dx = Math.round(from.left - to.left);
  const dy = Math.round(from.top - to.top);
  if (!dx && !dy) return;

  piece.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    { duration: MOVE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  );

  toCell.classList.add(move.captured ? 'sq--captured' : 'sq--landed');
  setTimeout(() => toCell.classList.remove('sq--captured', 'sq--landed'), MOVE_MS + 220);
}

function onSquare(sq) {
  const view = shown();
  if (!view || view.phase !== 'playing' || pendingPromotion) return;
  if (!isMyTurn(view, selfKaid)) return;
  if (cooldownLeft() > 0) return;

  const moves = legalMoves(view.state);

  if (selected !== null && targets.includes(sq)) {
    const options = moves.filter((m) => m.from === selected && m.to === sq);
    if (options.some((m) => m.promotion)) {
      pendingPromotion = { from: selected, to: sq };
      renderPromotion();
      return;
    }
    postMove(toAlgebraic(selected) + toAlgebraic(sq), options[0]);
    return;
  }

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

  const view = shown();
  const white = view.state.turn === 'w';

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

        const move = legalMoves(shown().state).find(
          (m) => m.from === from && m.to === to && m.promotion === kind,
        );
        postMove(toAlgebraic(from) + toAlgebraic(to) + kind, move);
      });
      return button;
    }),
  );
}

/* -------------------------------- status -------------------------------- */

function statusLine() {
  const view = shown();
  if (!view || view.phase === 'none') return 'No game yet.';

  if (view.phase === 'invited') {
    return view.isMine
      ? `Invitation sent — you as ${view.side === 'w' ? 'White' : 'Black'}.`
      : `${view.inviter.nickname} wants to play, as ${view.side === 'w' ? 'White' : 'Black'}.`;
  }

  if (view.phase === 'declined') return 'That invitation was declined.';

  const names = `${view.white.nickname} (White) v ${view.black.nickname} (Black)`;

  if (view.phase === 'over') {
    const winner = view.result === 'white' ? view.white.nickname : view.black.nickname;
    const outcome =
      view.result === 'draw' ? `Draw by ${view.reason}` : `${winner} wins by ${view.reason}`;
    return `${outcome}. ${names}`;
  }

  const turnName = view.state.turn === 'w' ? view.white.nickname : view.black.nickname;
  const check = view.reason === 'check' ? ' — check!' : '';

  if (!sideOf(view, selfKaid)) return `${turnName} to move${check}. ${names}`;
  return isMyTurn(view, selfKaid) ? `Your move${check}.` : `Waiting for ${turnName}${check}.`;
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
  const view = shown();
  const phase = view?.phase ?? 'none';
  const buttons = [];

  if (phase === 'none' || phase === 'declined' || phase === 'over') {
    buttons.push(action('Play as White', encodeInvite('w')));
    buttons.push(action('Play as Black', encodeInvite('b')));
  } else if (phase === 'invited') {
    if (view.isMine) {
      buttons.push(action('Cancel', encodeDecline(), 'chess-btn--quiet'));
    } else {
      buttons.push(action('Accept', encodeAccept()));
      buttons.push(action('Decline', encodeDecline(), 'chess-btn--quiet'));
    }
  } else if (phase === 'playing' && sideOf(view, selfKaid)) {
    buttons.push(action('Resign', encodeResign(), 'chess-btn--quiet'));
  }

  ui.actions.replaceChildren(...buttons);
}

/* --------------------------------- paint -------------------------------- */

function paint() {
  ui.status.textContent = statusLine();
  drawCooldown();
  ui.error.textContent = sendError ?? '';
  ui.error.hidden = !sendError;
  drawBoard();
  drawActions();
}

/* ---------------------------------- api --------------------------------- */

export function isOpen() {
  return !ui.panel.hidden;
}

export function toggle() {
  ui.panel.hidden = !ui.panel.hidden;
}

export function close() {
  ui.panel.hidden = true;
}

export function hasGame(messages, kaid) {
  const g = readGame(messages, kaid);
  return g.phase === 'invited' || g.phase === 'playing';
}

export function render(chat, kaid) {
  selfKaid = kaid;
  const next = readGame(chat.messages, kaid);

  // Once the thread has caught up, the guess is no longer needed.
  if (optimistic && (next.moveCount ?? 0) >= optimistic.moveCount) {
    optimistic = null;
    sendError = null;
  }

  // A move that arrived from the other player should slide in too.
  if (next.lastMove && next.lastMove !== animatedMove && next.moveCount !== game?.moveCount) {
    if (!optimistic) pendingAnimation = { uci: next.lastMove, captured: false };
    animatedMove = next.lastMove;
  }

  if (game?.phase !== next.phase || game?.moveCount !== next.moveCount) {
    selected = null;
    targets = [];
    pendingPromotion = null;
    ui.promo.hidden = true;
  }

  game = next;
  paint();
}

export function setup({ onSend }) {
  sendMessage = onSend;
}
