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

/** Recognises a game message so the chat view can keep it out of the bubbles. */
export function parseGameMessage(content) {
  const text = String(content ?? '').trim();
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
 * @returns {{
 *   phase: 'none'|'invited'|'declined'|'playing'|'over',
 *   white, black,              // author objects
 *   state,                     // chess position, when playing or over
 *   moveCount, lastMove,
 *   result, reason,            // when over
 *   inviter, side,             // when invited
 *   ignored                    // moves rejected as illegal or out of turn
 * }}
 */
export function readGame(messages, selfKaid = null) {
  const tagged = (messages ?? [])
    .map((m) => ({ message: m, parsed: parseGameMessage(m.content) }))
    .filter((x) => x.parsed);

  // Only the most recent invitation matters; earlier games are history.
  let start = -1;
  for (let i = tagged.length - 1; i >= 0; i--) {
    if (tagged[i].parsed.type === 'invite') {
      start = i;
      break;
    }
  }
  if (start === -1) return { phase: 'none' };

  const invite = tagged[start];
  const inviter = invite.message.author;

  // The reply has to come from someone else -- you cannot accept your own game.
  let accepted = null;
  let declined = false;
  for (let i = start + 1; i < tagged.length; i++) {
    const { parsed, message } = tagged[i];
    if (parsed.type === 'accept' && message.author.kaid !== inviter.kaid) {
      accepted = tagged[i];
      break;
    }
    if (parsed.type === 'decline') {
      declined = true;
      break;
    }
  }

  if (declined) return { phase: 'declined', inviter, side: invite.parsed.side };
  if (!accepted) {
    return {
      phase: 'invited',
      inviter,
      side: invite.parsed.side,
      isMine: selfKaid !== null && inviter.kaid === selfKaid,
    };
  }

  const white = invite.parsed.side === 'w' ? inviter : accepted.message.author;
  const black = invite.parsed.side === 'w' ? accepted.message.author : inviter;

  let state = newGame();
  let moveCount = 0;
  let lastMove = null;
  let ignored = 0;
  let resignedBy = null;

  for (let i = tagged.indexOf(accepted) + 1; i < tagged.length; i++) {
    const { parsed, message } = tagged[i];

    if (parsed.type === 'resign') {
      if (message.author.kaid === white.kaid || message.author.kaid === black.kaid) {
        resignedBy = message.author;
        break;
      }
      continue;
    }

    if (parsed.type !== 'move') continue;

    // Anyone can reply in a public thread, so a move only counts when it comes
    // from the player who is actually to move.
    const expected = state.turn === 'w' ? white : black;
    if (message.author.kaid !== expected.kaid) {
      ignored++;
      continue;
    }

    const next = playMove(state, parsed.uci);
    if (!next) {
      ignored++;
      continue;
    }

    state = next;
    moveCount++;
    lastMove = parsed.uci;
    if (status(state).over) break;
  }

  if (resignedBy) {
    return {
      phase: 'over',
      white,
      black,
      state,
      moveCount,
      lastMove,
      ignored,
      result: resignedBy.kaid === white.kaid ? 'black' : 'white',
      reason: 'resignation',
    };
  }

  const outcome = status(state);
  return {
    phase: outcome.over ? 'over' : 'playing',
    white,
    black,
    state,
    moveCount,
    lastMove,
    ignored,
    result: outcome.result,
    reason: outcome.reason,
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
