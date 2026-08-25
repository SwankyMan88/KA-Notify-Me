/**
 * The little "i" bubbles next to each setting.
 *
 * Built by hand rather than with the browser's `title` attribute, which is slow
 * to appear, unstyleable, and cut off at the popup edge. One bubble element is
 * shared by every dot and lives on <body> with fixed positioning, because the
 * settings list is a scroll container and anything drawn inside it gets clipped
 * at its edge.
 */

const MARGIN = 8;
const GAP = 9;

let bubble = null;
let arrow = null;
let anchor = null;

function build() {
  if (bubble) return;

  bubble = document.createElement('div');
  bubble.className = 'tip';
  bubble.setAttribute('role', 'tooltip');
  bubble.id = 'kanm-tip';

  arrow = document.createElement('div');
  arrow.className = 'tip-arrow';

  document.body.append(bubble, arrow);
}

function place(target) {
  const dot = target.getBoundingClientRect();
  const width = bubble.offsetWidth;
  const height = bubble.offsetHeight;
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;

  // Centre on the dot, then pull back inside whichever edge it would cross.
  let left = dot.left + dot.width / 2 - width / 2;
  left = Math.max(MARGIN, Math.min(left, viewportW - width - MARGIN));

  // Prefer above; drop below when there is not room, which is what happens to
  // the first rows and to any row scrolled up against the top of the list.
  const above = dot.top - GAP - height;
  const below = dot.bottom + GAP;
  const goesBelow = above < MARGIN && below + height <= viewportH - MARGIN;

  // Clamp both ends, not just the top: a row near the bottom of the list would
  // otherwise push its bubble off the end of the popup.
  const top = Math.max(
    MARGIN,
    Math.min(goesBelow ? below : above, viewportH - height - MARGIN),
  );

  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;

  const arrowX = Math.max(
    left + 6,
    Math.min(dot.left + dot.width / 2 - 4.5, left + width - 15),
  );
  arrow.style.left = `${Math.round(arrowX)}px`;
  arrow.style.top = `${Math.round(goesBelow ? top - 5 : top + height - 4)}px`;
  arrow.style.transform = goesBelow ? 'rotate(45deg)' : 'rotate(225deg)';
}

function show(target) {
  const text = target.dataset.tip;
  if (!text) return;

  build();
  anchor = target;
  bubble.textContent = text;

  // Measure with it laid out but still invisible, then position, then reveal.
  bubble.classList.add('tip--shown');
  arrow.classList.add('tip-arrow--shown');
  place(target);

  target.setAttribute('aria-describedby', bubble.id);
}

function hide(target) {
  if (target && target !== anchor) return;
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
  bubble?.classList.remove('tip--shown');
  arrow?.classList.remove('tip-arrow--shown');
}

/**
 * Delegated from the document, so dots added later are covered without
 * rebinding. Keyboard users get the same bubble on focus.
 */
export function setup() {
  build();

  document.addEventListener('mouseover', (event) => {
    const dot = event.target.closest?.('.info');
    if (dot) show(dot);
  });

  document.addEventListener('mouseout', (event) => {
    const dot = event.target.closest?.('.info');
    if (dot) hide(dot);
  });

  document.addEventListener('focusin', (event) => {
    const dot = event.target.closest?.('.info');
    if (dot) show(dot);
  });

  document.addEventListener('focusout', () => hide());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });

  // A bubble pinned to the viewport would drift away from a scrolling row.
  document.addEventListener('scroll', () => hide(), { capture: true, passive: true });
}
