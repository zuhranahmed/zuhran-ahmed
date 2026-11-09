/**
 * <gift-guide-menu> — the gift guide banner's brand bar (sections/gift-guide-banner.liquid).
 *
 * Below the desktop breakpoint the tagline and gift button collapse behind a hamburger
 * toggle. This element owns only that open/closed state: it mirrors it on the toggle's
 * `aria-expanded` and on its own `open` attribute, which the section CSS uses to show the
 * panel. On desktop the CSS always shows the panel, so the state is reset there.
 *
 * Without this script the CSS keeps the panel visible, so the links stay reachable.
 */

const DESKTOP_QUERY = window.matchMedia('(min-width: 990px)');

class GiftGuideMenu extends HTMLElement {
  /** @type {AbortController | undefined} Removes every listener on disconnect. */
  #controller;

  connectedCallback() {
    // Reconnects (theme editor re-renders, DOM moves) replace the previous listeners.
    this.#controller?.abort();
    this.#controller = new AbortController();
    const { signal } = this.#controller;

    this.toggle?.addEventListener('click', this.#handleToggleClick, { signal });
    this.addEventListener('keydown', this.#handleKeydown, { signal });
    DESKTOP_QUERY.addEventListener('change', this.#handleBreakpointChange, { signal });
  }

  disconnectedCallback() {
    this.#controller?.abort();
  }

  /** @returns {HTMLButtonElement | null} */
  get toggle() {
    return this.querySelector('button[data-menu-toggle]');
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.hasAttribute('open');
  }

  /**
   * Opens or closes the panel and keeps the toggle's state in sync.
   * @param {boolean} open
   */
  setOpen(open) {
    this.toggleAttribute('open', open);
    this.toggle?.setAttribute('aria-expanded', String(open));
  }

  #handleToggleClick = () => {
    this.setOpen(!this.isOpen);
  };

  /** Escape closes the panel and returns focus to the toggle. @param {KeyboardEvent} event */
  #handleKeydown = (event) => {
    if (event.key !== 'Escape' || !this.isOpen) return;

    this.setOpen(false);
    this.toggle?.focus();
  };

  /** @param {MediaQueryListEvent} event */
  #handleBreakpointChange = (event) => {
    if (event.matches) this.setOpen(false);
  };
}

if (!customElements.get('gift-guide-menu')) {
  customElements.define('gift-guide-menu', GiftGuideMenu);
}
