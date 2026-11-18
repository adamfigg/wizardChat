// The Attunement, without page loads (views/attunement.ejs).
//
// Without this script each answer is an ordinary form post that loads the
// next page. With it, the answer is sent in the background, and the page it
// would have loaded is fetched and fitted into the one already on screen:
//
//   - the answered question fades and slides out to the left while the next
//     slides in from the right (and the reverse when going back);
//   - the "Question 3 of 9" count and the line beneath the orb morph from the
//     old words to the new, using the torph package;
//   - the orb fades from its present state to the next.
//
// The server decides everything, exactly as before; this only changes how its
// answer is shown. If anything unexpected happens, it falls back to loading
// the page in the ordinary way.
//
// After changing this file, run `npm run build`.

import { TextMorph } from 'torph';

const root = document.querySelector('[data-attune]');
// Read now: document.currentScript is only available while the script starts.
const styleNonce = document.currentScript ? document.currentScript.nonce : '';
const stillness = window.matchMedia('(prefers-reduced-motion: reduce)');

const SLIDE = 56; // how far, in pixels, a question travels as it leaves or arrives

// torph adds a small stylesheet of its own to the page the first time it
// draws. The site's security policy refuses styles written into a page unless
// they carry the one-time value the server issued with this response, so that
// value is attached to the stylesheet as torph creates it.
function withStyleNonce(draw) {
  if (!styleNonce) return draw();
  const create = Document.prototype.createElement;
  document.createElement = function createElement(tag, ...rest) {
    const el = create.call(this, tag, ...rest);
    if (String(tag).toLowerCase() === 'style') el.nonce = styleNonce;
    return el;
  };
  try {
    return draw();
  } finally {
    delete document.createElement;
  }
}

// Hands an element's text over to torph, which from then on animates changes to it.
function morphing(el) {
  if (!el) return null;
  return withStyleNonce(() => {
    const morph = new TextMorph({ element: el, duration: 650 });
    morph.update(el.textContent.trim());
    return morph;
  });
}

function textOf(scope, selector) {
  const el = scope.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

if (root && window.fetch && window.DOMParser && Element.prototype.animate) {
  const countMorph = morphing(root.querySelector('[data-attune-count]'));
  const captionMorph = morphing(root.querySelector('[data-attune-caption]'));
  let busy = false;

  // The orb for the next state is laid over the present one and faded in.
  function changeOrb(nextRoot) {
    const stack = root.querySelector('.orb-stack');
    const incoming = nextRoot.querySelector('.orb');
    if (!stack || !incoming) return;
    const present = stack.lastElementChild;
    if (present && present.className === incoming.className) return;
    const orb = document.adoptNode(incoming);
    stack.append(orb);
    if (!present) return;
    if (stillness.matches) {
      present.remove();
      return;
    }
    orb.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-out' });
    present
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => present.remove(), () => present.remove());
  }

  // Sends `request`, and shows the page that comes back in place of the
  // question on screen. `direction` is 1 when moving on and -1 when going
  // back. `otherwise` does the same thing the ordinary way, as a fallback.
  async function go(request, direction, otherwise) {
    if (busy) return;
    busy = true;
    const stage = root.querySelector('[data-attune-stage]');
    const panel = stage.parentElement;
    const leaving = stillness.matches
      ? null
      : stage.animate(
          [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${-direction * SLIDE}px)` },
          ],
          { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
        );

    try {
      const [response] = await Promise.all([request(), leaving ? leaving.finished : null]);
      const page = response.ok ? new DOMParser().parseFromString(await response.text(), 'text/html') : null;
      const nextRoot = page && page.querySelector('[data-attune]');
      const nextStage = nextRoot && nextRoot.querySelector('[data-attune-stage]');
      if (!nextStage) {
        // Not a page of the Attunement (logged out, already attuned, an error):
        // go wherever the server sent us.
        window.location.assign(response.url);
        return;
      }

      const heightBefore = panel.offsetHeight;
      stage.replaceChildren(...document.adoptNode(nextStage).childNodes);
      window.history.pushState({}, '', response.url);
      if (countMorph) countMorph.update(textOf(nextRoot, '[data-attune-count]'));
      if (captionMorph) captionMorph.update(textOf(nextRoot, '[data-attune-caption]'));
      changeOrb(nextRoot);

      if (leaving) {
        leaving.cancel();
        const heightAfter = panel.offsetHeight;
        if (heightAfter !== heightBefore) {
          panel.animate([{ height: `${heightBefore}px` }, { height: `${heightAfter}px` }], {
            duration: 360,
            easing: 'cubic-bezier(0.19, 1, 0.22, 1)',
          });
        }
        stage.animate(
          [
            { opacity: 0, transform: `translateX(${direction * SLIDE}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          { duration: 460, easing: 'cubic-bezier(0.19, 1, 0.22, 1)' }
        );
      }

      // Put keyboard and screen-reader users at the new question.
      const heading = stage.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      busy = false;
    } catch {
      otherwise();
    }
  }

  // An answer was chosen.
  root.addEventListener('submit', (event) => {
    const form = event.target;
    const button = event.submitter;
    if (!form.matches('[data-attune-answer]') || !button) return;
    event.preventDefault();
    button.classList.add('is-chosen');
    const body = new URLSearchParams(new FormData(form));
    body.set(button.name, button.value);
    go(
      () => fetch(form.action, { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'text/html' } }),
      1,
      () => {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = button.name;
        field.value = button.value;
        form.append(field);
        form.submit();
      }
    );
  });

  // "Return to the previous question."
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-attune-back]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go(
      () => fetch(link.href, { credentials: 'same-origin', headers: { Accept: 'text/html' } }),
      -1,
      () => window.location.assign(link.href)
    );
  });

  // The browser's own back and forward buttons: show whatever page they land on.
  window.addEventListener('popstate', () => window.location.reload());
}
