/**
 * A complete chess implementation: move generation with full legality,
 * castling, en passant, promotion, and check / checkmate / stalemate / draw
 * detection.
 *
 * Board is 64 entries in FEN order, index 0 = a8 through index 63 = h1.
 * Pieces are letters, upper case for white: P N B R Q K.
 *
 * Correctness here is not a matter of taste, so it is checked against known
 * perft counts rather than by eye -- see the tests in the commit that added it.
 */

const WHITE = 'w';
const BLACK = 'b';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const isUpper = (c) => c >= 'A' && c <= 'Z';
const colourOf = (piece) => (isUpper(piece) ? WHITE : BLACK);

export const fileOf = (sq) => sq % 8;
export const rankOf = (sq) => Math.floor(sq / 8);

/** "e4" -> index. */
export function fromAlgebraic(text) {
  const file = text.charCodeAt(0) - 97;
  const rank = 8 - Number(text[1]);
  return rank * 8 + file;
}

/** index -> "e4". */
export function toAlgebraic(sq) {
  return String.fromCharCode(97 + fileOf(sq)) + (8 - rankOf(sq));
}

/* --------------------------------- FEN --------------------------------- */

export function parseFen(fen) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);

  const board = new Array(64).fill(null);
  let sq = 0;
  for (const char of placement) {
    if (char === '/') continue;
    if (char >= '1' && char <= '8') sq += Number(char);
    else board[sq++] = char;
  }

  return {
    board,
    turn,
    castling: {
      K: castling.includes('K'),
      Q: castling.includes('Q'),
      k: castling.includes('k'),
      q: castling.includes('q'),
    },
    ep: ep === '-' ? null : fromAlgebraic(ep),
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function toFen(state) {
  let placement = '';
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = state.board[rank * 8 + file];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) placement += empty;
      empty = 0;
      placement += piece;
    }
    if (empty) placement += empty;
    if (rank < 7) placement += '/';
  }

  const rights =
    (state.castling.K ? 'K' : '') +
    (state.castling.Q ? 'Q' : '') +
    (state.castling.k ? 'k' : '') +
    (state.castling.q ? 'q' : '');

  return [
    placement,
    state.turn,
    rights || '-',
    state.ep === null ? '-' : toAlgebraic(state.ep),
    state.halfmove,
    state.fullmove,
  ].join(' ');
}

/* ---------------------------- move generation --------------------------- */

// Offsets as [fileStep, rankStep] so edge wrapping is impossible by construction.
const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_STEPS = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];
const ROOK_DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

function offset(sq, dFile, dRank) {
  const file = fileOf(sq) + dFile;
  const rank = rankOf(sq) - dRank; // rank index grows downward from rank 8
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}

/** Is `sq` attacked by `by`? Used for check and for castling through check. */
export function isAttacked(board, sq, by) {
  // Pawns: look backwards from the target along the capture diagonals.
  const pawnRank = by === WHITE ? -1 : 1;
  for (const dFile of [-1, 1]) {
    const from = offset(sq, dFile, pawnRank);
    if (from !== -1 && board[from] === (by === WHITE ? 'P' : 'p')) return true;
  }

  for (const [dF, dR] of KNIGHT_STEPS) {
    const from = offset(sq, dF, dR);
    if (from !== -1 && board[from] === (by === WHITE ? 'N' : 'n')) return true;
  }

  for (const [dF, dR] of KING_STEPS) {
    const from = offset(sq, dF, dR);
    if (from !== -1 && board[from] === (by === WHITE ? 'K' : 'k')) return true;
  }

  const slide = (dirs, pieces) => {
    for (const [dF, dR] of dirs) {
      let from = offset(sq, dF, dR);
      while (from !== -1) {
        const piece = board[from];
        if (piece) {
          if (colourOf(piece) === by && pieces.includes(piece.toLowerCase())) return true;
          break;
        }
        from = offset(from, dF, dR);
      }
    }
    return false;
  };

  return slide(ROOK_DIRS, ['r', 'q']) || slide(BISHOP_DIRS, ['b', 'q']);
}

function findKing(board, colour) {
  const king = colour === WHITE ? 'K' : 'k';
  return board.indexOf(king);
}

export function inCheck(state, colour = state.turn) {
  const king = findKing(state.board, colour);
  if (king === -1) return false;
  return isAttacked(state.board, king, colour === WHITE ? BLACK : WHITE);
}

function pushMove(list, from, to, extra = {}) {
  list.push({ from, to, ...extra });
}

/** Pseudo-legal moves: may leave the mover's own king in check. */
function pseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  const enemy = turn === WHITE ? BLACK : WHITE;

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || colourOf(piece) !== turn) continue;
    const kind = piece.toLowerCase();

    if (kind === 'p') {
      const forward = turn === WHITE ? 1 : -1;
      const startRank = turn === WHITE ? 6 : 1;
      const promoRank = turn === WHITE ? 0 : 7;

      const one = offset(from, 0, forward);
      if (one !== -1 && !board[one]) {
        if (rankOf(one) === promoRank) {
          for (const p of ['q', 'r', 'b', 'n']) pushMove(moves, from, one, { promotion: p });
        } else {
          pushMove(moves, from, one);
          if (rankOf(from) === startRank) {
            const two = offset(from, 0, forward * 2);
            if (two !== -1 && !board[two]) pushMove(moves, from, two, { double: true });
          }
        }
      }

      for (const dFile of [-1, 1]) {
        const to = offset(from, dFile, forward);
        if (to === -1) continue;

        const target = board[to];
        if (target && colourOf(target) === enemy) {
          if (rankOf(to) === promoRank) {
            for (const p of ['q', 'r', 'b', 'n']) pushMove(moves, from, to, { promotion: p });
          } else {
            pushMove(moves, from, to);
          }
        } else if (!target && to === state.ep) {
          pushMove(moves, from, to, { enPassant: true });
        }
      }
      continue;
    }

    if (kind === 'n' || kind === 'k') {
      const steps = kind === 'n' ? KNIGHT_STEPS : KING_STEPS;
      for (const [dF, dR] of steps) {
        const to = offset(from, dF, dR);
        if (to === -1) continue;
        const target = board[to];
        if (!target || colourOf(target) === enemy) pushMove(moves, from, to);
      }
      continue;
    }

    const dirs =
      kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];

    for (const [dF, dR] of dirs) {
      let to = offset(from, dF, dR);
      while (to !== -1) {
        const target = board[to];
        if (!target) {
          pushMove(moves, from, to);
        } else {
          if (colourOf(target) === enemy) pushMove(moves, from, to);
          break;
        }
        to = offset(to, dF, dR);
      }
    }
  }

  // Castling: rights, empty path, and the king may not start, cross, or land
  // on an attacked square.
  const home = turn === WHITE ? 60 : 4;
  const king = board[home];
  if (king && king.toLowerCase() === 'k' && colourOf(king) === turn) {
    const rights = turn === WHITE ? ['K', 'Q'] : ['k', 'q'];
    if (state.castling[rights[0]] && !board[home + 1] && !board[home + 2]) {
      if (
        !isAttacked(board, home, enemy) &&
        !isAttacked(board, home + 1, enemy) &&
        !isAttacked(board, home + 2, enemy)
      ) {
        pushMove(moves, home, home + 2, { castle: 'k' });
      }
    }
    if (state.castling[rights[1]] && !board[home - 1] && !board[home - 2] && !board[home - 3]) {
      if (
        !isAttacked(board, home, enemy) &&
        !isAttacked(board, home - 1, enemy) &&
        !isAttacked(board, home - 2, enemy)
      ) {
        pushMove(moves, home, home - 2, { castle: 'q' });
      }
    }
  }

  return moves;
}

export function applyMove(state, move) {
  const board = [...state.board];
  const piece = board[move.from];
  const kind = piece.toLowerCase();
  const turn = state.turn;

  board[move.to] = move.promotion
    ? turn === WHITE
      ? move.promotion.toUpperCase()
      : move.promotion
    : piece;
  board[move.from] = null;

  if (move.enPassant) {
    // The captured pawn sits beside the destination, not on it.
    board[move.to + (turn === WHITE ? 8 : -8)] = null;
  }

  if (move.castle === 'k') {
    board[move.to - 1] = board[move.to + 1];
    board[move.to + 1] = null;
  } else if (move.castle === 'q') {
    board[move.to + 1] = board[move.to - 2];
    board[move.to - 2] = null;
  }

  const castling = { ...state.castling };
  if (kind === 'k') {
    if (turn === WHITE) castling.K = castling.Q = false;
    else castling.k = castling.q = false;
  }
  // Losing a rook, by moving it or having it captured, costs that right.
  for (const [square, right] of [
    [63, 'K'],
    [56, 'Q'],
    [7, 'k'],
    [0, 'q'],
  ]) {
    if (move.from === square || move.to === square) castling[right] = false;
  }

  const captured = state.board[move.to];

  return {
    board,
    turn: turn === WHITE ? BLACK : WHITE,
    castling,
    ep: move.double ? (move.from + move.to) / 2 : null,
    halfmove: kind === 'p' || captured || move.enPassant ? 0 : state.halfmove + 1,
    fullmove: turn === BLACK ? state.fullmove + 1 : state.fullmove,
  };
}

/** Fully legal moves. */
export function legalMoves(state) {
  const mover = state.turn;
  return pseudoMoves(state).filter((move) => {
    const next = applyMove(state, move);
    return !inCheck(next, mover);
  });
}

export function isLegal(state, from, to, promotion) {
  return legalMoves(state).some(
    (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promotion),
  );
}

/* --------------------------------- status ------------------------------- */

/** Insufficient material: K vs K, K+B vs K, K+N vs K. */
function insufficientMaterial(board) {
  const pieces = board.filter(Boolean).map((p) => p.toLowerCase());
  if (pieces.some((p) => p === 'p' || p === 'r' || p === 'q')) return false;
  const minor = pieces.filter((p) => p === 'b' || p === 'n');
  return minor.length <= 1;
}

/**
 * @returns {{ over: boolean, result: 'white'|'black'|'draw'|null, reason: string }}
 */
export function status(state) {
  const moves = legalMoves(state);
  const checked = inCheck(state);

  if (!moves.length) {
    if (checked) {
      return {
        over: true,
        result: state.turn === WHITE ? 'black' : 'white',
        reason: 'checkmate',
      };
    }
    return { over: true, result: 'draw', reason: 'stalemate' };
  }

  if (insufficientMaterial(state.board)) {
    return { over: true, result: 'draw', reason: 'insufficient material' };
  }
  if (state.halfmove >= 100) {
    return { over: true, result: 'draw', reason: 'fifty-move rule' };
  }

  return { over: false, result: null, reason: checked ? 'check' : '' };
}

/* --------------------------------- moves -------------------------------- */

/** Compact wire form: "e2e4", or "e7e8q" when promoting. */
export function encodeMove(move) {
  return toAlgebraic(move.from) + toAlgebraic(move.to) + (move.promotion ?? '');
}

/**
 * Applies a wire move to a position, returning the new state, or null when the
 * move is not legal there -- which is how a tampered or out-of-order message
 * from the thread gets rejected instead of corrupting the board.
 */
export function playMove(state, text) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) return null;

  const from = fromAlgebraic(text.slice(0, 2));
  const to = fromAlgebraic(text.slice(2, 4));
  const promotion = text[4] ?? null;

  const move = legalMoves(state).find(
    (m) => m.from === from && m.to === to && (m.promotion ?? null) === promotion,
  );
  return move ? applyMove(state, move) : null;
}

export function newGame() {
  return parseFen(START_FEN);
}

/** Nodes at a given depth. Only used by the tests, but it lives with the rules. */
export function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;

  let nodes = 0;
  for (const move of moves) nodes += perft(applyMove(state, move), depth - 1);
  return nodes;
}
