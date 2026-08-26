import { newGame, playMove, status } from './chess.js';

/**
 * A game is carried by ordinary chat messages. There is no side channel and no
 * shared state to keep in sync: the thread *is* the game record, and both
 * players rebuild the position by replaying it. Whoever reads the same messages
 * sees the same board.
 *
 * Messages look like `[chess] e2e4`. They are plain text in a public comment
 * thread, so nothing here is trusted: every move is checked for legality and
 * for having come from the player whose turn it actually is.
 */

export const PREFIX = '[chess]';

const INVITE = /^\[chess\]\s+invite\s+([wb])$/i;
const ACCEPT = /^\[chess\]\s+accept$/i;
const DECLINE = /^\[chess\]\s+decline$/i;
const RESIGN = /^\[chess\]\s+resign$/i;
const MOVE = /^\[chess\]\s+([a-h][1-8][a-h][1-8][qrbn]?)$/i;

/**
 * Khan Academy stores comments as markdown, so a posted "[chess] e2e4" can come
 * back as "\[chess\] e2e4" -- the brackets escaped. Your own optimistic copy
 * is the raw text and matched fine, while the server's echo did not, which is
 * why a game message could hide for you and show for everyone else. Strip the
 * escapes and any invisible characters before matching.
 */
export function normaliseGameText(content) {
  return String(content ?? '')
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/\\([[\]\\*_`~])/g, '$1')
    .trim();
}

/** Recognises a game message so the chat view can keep it out of the bubbles. */
export function parseGameMessage(content) {
  const text = normaliseGameText(content);
  if (!text.toLowerCase().startsWith(PREFIX)) return null;

  let match;
  if ((match = text.match(INVITE))) return { type: 'invite', side: match[1].toLowerCase() };
  if (ACCEPT.test(text)) return { type: 'accept' };
  if (DECLINE.test(text)) return { type: 'decline' };
  if (RESIGN.test(text)) return { type: 'resign' };
  if ((match = text.match(MOVE))) return { type: 'move', uci: match[1].toLowerCase() };

  // Starts with our prefix but is not something we understand. Still hidden
  // from the chat, so a future version's messages do not litter old clients.
  return { type: 'unknown' };
}

export const encodeInvite = (side) => `${PREFIX} invite ${side}`;
export const encodeAccept = () => `${PREFIX} accept`;
export const encodeDecline = () => `${PREFIX} decline`;
export const encodeResign = () => `${PREFIX} resign`;
export const encodeMove = (uci) => `${PREFIX} ${uci}`;

export function isGameMessage(content) {
  return parseGameMessage(content) !== null;
}

/**
 * Rebuilds the current game from a room's messages.
 *
 * Read forwards rather than by hunting for the last invitation, because
 * whether an invitation counts depends on what came before it: **a game is
 * between exactly two people**, and while one is running only those two can
 * start the next. A third person posting an invitation into the middle of a
 * game is ignored, and once someone has accepted, the pair is fixed.
 *
 * @returns {{
 *   phase: 'none'|'invited'|'declined'|'playing'|'over',
 *   white, black,              // author objects
 *   state,                     // chess position, once playing
 *   moveCount, lastMove,
 *   result, reason,            // when over
 *   inviter, side, isMine,     // when invited
 *   ignored                    // messages rejected as illegal, out of turn,
 *                              // or from someone who is not a player
 * }}
 */
export function readGame(messages, selfKaid = null) {
  let game = null;
  let ignored = 0;

  const isPlayer = (kaid) =>
    game && (kaid === game.white?.kaid || kaid === game.black?.kaid || kaid === game.inviter?.kaid);

  for (const message of messages ?? []) {
    const parsed = parseGameMessage(message.content);
    if (!parsed) continue;

    const author = message.author;

    if (parsed.type === 'invite') {
      // A new game may only start when none is running, or when one of the two
      // people already playing is the one proposing it.
      if (game && !game.finished && !isPlayer(author.kaid)) {
        ignored++;
        continue;
      }
      game = {
        phase: 'invited',
        inviter: author,
        side: parsed.side,
        finished: false,
        white: null,
        black: null,
        state: null,
        moveCount: 0,
        lastMove: null,
        result: null,
        reason: '',
      };
      continue;
    }

    if (!game) {
      ignored++;
      continue;
    }

    if (parsed.type === 'accept') {
      // You cannot accept your own invitation, and only the first taker plays.
      if (game.phase !== 'invited' || author.kaid === game.inviter.kaid) {
        ignored++;
        continue;
      }
      game.white = game.side === 'w' ? game.inviter : author;
      game.black = game.side === 'w' ? author : game.inviter;
      game.state = newGame();
      game.phase = 'playing';
      continue;
    }

    if (parsed.type === 'decline') {
      if (game.phase !== 'invited') {
        ignored++;
        continue;
      }
      game.phase = 'declined';
      game.finished = true;
      continue;
    }

    if (parsed.type === 'resign') {
      if (game.phase !== 'playing' || !isPlayer(author.kaid)) {
        ignored++;
        continue;
      }
      game.phase = 'over';
      game.finished = true;
      game.result = author.kaid === game.white.kaid ? 'black' : 'white';
      game.reason = 'resignation';
      continue;
    }

    if (parsed.type === 'move') {
      if (game.phase !== 'playing') {
        ignored++;
        continue;
      }
      // Anyone can reply in a public thread, so a move only counts when it
      // comes from the player who is actually to move.
      const expected = game.state.turn === 'w' ? game.white : game.black;
      if (author.kaid !== expected.kaid) {
        ignored++;
        continue;
      }

      const next = playMove(game.state, parsed.uci);
      if (!next) {
        ignored++;
        continue;
      }

      game.state = next;
      game.moveCount++;
      game.lastMove = parsed.uci;

      const outcome = status(next);
      if (outcome.over) {
        game.phase = 'over';
        game.finished = true;
        game.result = outcome.result;
        game.reason = outcome.reason;
      }
      continue;
    }

    ignored++; // an unknown [chess] message
  }

  if (!game) return { phase: 'none', ignored };

  if (game.phase === 'invited') {
    return {
      phase: 'invited',
      inviter: game.inviter,
      side: game.side,
      isMine: selfKaid !== null && game.inviter.kaid === selfKaid,
      ignored,
    };
  }

  if (game.phase === 'declined') {
    return { phase: 'declined', inviter: game.inviter, side: game.side, ignored };
  }

  // A live game still needs its running status, for "check" and for draws that
  // are not reached by a move (fifty-move, insufficient material).
  const live = game.phase === 'playing' ? status(game.state) : null;

  return {
    phase: live?.over ? 'over' : game.phase,
    white: game.white,
    black: game.black,
    state: game.state,
    moveCount: game.moveCount,
    lastMove: game.lastMove,
    result: live?.over ? live.result : game.result,
    reason: live?.over ? live.reason : live ? live.reason : game.reason,
    ignored,
  };
}

/** Which colour you are in a reconstructed game, or null if you are watching. */
export function sideOf(game, selfKaid) {
  if (!game || !selfKaid) return null;
  if (game.white?.kaid === selfKaid) return 'w';
  if (game.black?.kaid === selfKaid) return 'b';
  return null;
}

export function isMyTurn(game, selfKaid) {
  return game?.phase === 'playing' && sideOf(game, selfKaid) === game.state.turn;
}
