/**
 * <gift-guide-hotspot> — one product tile of the gift guide grid (sections/gift-guide-grid.liquid).
 *
 * Owns the tile's "+" hotspot, its quick-view <dialog> and the add-to-cart form inside it:
 *   1. The hotspot opens the dialog as a modal. Native <dialog> handles focus, Escape and
 *      returning focus to the hotspot, and the close button is a `method="dialog"` form.
 *   2. Option radios (colour buttons, size dropdown) are matched against the variant table
 *      Liquid renders into `script[data-variants]` to update the price, image and button state.
 *   3. Submitting adds the variant through the Ajax Cart API. When the variant has every
 *      gift trigger option (for example Black + Medium), the gift variant is added in the
 *      same request, unless the cart already holds it. Then the shopper goes to the cart.
 *
 * Strings and URLs come from data attributes so Liquid owns translations and locale-aware routes.
 */

/**
 * @typedef {object} Variant
 * @property {number} id
 * @property {boolean} available
 * @property {string[]} options - Option values in product option order.
 * @property {string} price - Price already formatted by Liquid's `money` filter.
 * @property {string | null} image - 240px image URL, or null when the variant has no image.
 */

class GiftGuideHotspot extends HTMLElement {
  /** @type {AbortController | undefined} Removes every listener on disconnect. */
  #listeners;

  /** @type {AbortController | undefined} Cancels an in-flight cart request on disconnect. */
  #request;

  /** @type {Variant[]} */
  #variants = [];

  connectedCallback() {
    // Reconnects (theme editor re-renders, DOM moves) replace the previous listeners.
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;

    this.#variants = this.#readVariants();

    this.querySelector('[data-popup-open]')?.addEventListener('click', () => this.open(), { signal });
    this.dialog?.addEventListener('click', this.#handleDialogClick, { signal });
    this.dialog?.addEventListener('keydown', this.#handleDialogKeydown, { signal });
    this.dialog?.addEventListener('close', () => this.#closeDropdowns(), { signal });
    this.form?.addEventListener('change', this.#handleOptionChange, { signal });
    this.form?.addEventListener('submit', this.#handleSubmit, { signal });

    this.#render();
  }

  disconnectedCallback() {
    this.#listeners?.abort();
    this.#request?.abort();
  }

  /** @returns {HTMLDialogElement | null} */
  get dialog() {
    return this.querySelector('dialog[data-popup]');
  }

  /** @returns {HTMLFormElement | null} */
  get form() {
    return this.querySelector('form[data-product-form]');
  }

  /** Opens the quick-view popup. */
  open() {
    if (this.dialog && !this.dialog.open) this.dialog.showModal();
  }

  /** @returns {Variant[]} */
  #readVariants() {
    try {
      return JSON.parse(this.querySelector('script[data-variants]')?.textContent ?? '[]');
    } catch {
      return [];
    }
  }

  /** @returns {HTMLElement[]} One container per product option, in option order. */
  get #optionFields() {
    return Array.from(this.querySelectorAll('[data-option]'));
  }

  /**
   * The chosen value for each option in product option order (fields may render in a
   * different order, so each one carries its 1-based `data-option-position`), or null where
   * nothing is chosen yet.
   * @returns {(string | null)[]}
   */
  #selectedValues() {
    /** @type {(string | null)[]} */
    const values = new Array(this.#optionFields.length).fill(null);

    for (const field of this.#optionFields) {
      const index = Number(field.dataset.optionPosition) - 1;
      const checked = field.querySelector('input[type="radio"]:checked');
      if (index >= 0 && checked instanceof HTMLInputElement) values[index] = checked.value;
    }

    return values;
  }

  /**
   * The variant matching the chosen options; undefined until every option is chosen.
   * Products without options have a single variant.
   * @returns {Variant | undefined}
   */
  #currentVariant() {
    const values = this.#selectedValues();
    if (values.includes(null)) return undefined;

    return this.#variants.find((variant) => variant.options.every((value, index) => value === values[index]));
  }

  /** Syncs the hidden id, price, image, dropdown labels and button with the chosen options. */
  #render() {
    const variant = this.#currentVariant();
    const isComplete = !this.#selectedValues().includes(null);

    const idInput = this.querySelector('input[data-variant-id]');
    if (idInput instanceof HTMLInputElement) idInput.value = variant ? String(variant.id) : '';

    if (variant) {
      const price = this.querySelector('[data-price]');
      if (price) price.textContent = variant.price;

      const image = this.querySelector('.gift-popup__image');
      if (variant.image && image instanceof HTMLImageElement) {
        image.srcset = '';
        image.src = variant.image;
      }
    }

    for (const dropdown of this.querySelectorAll('[data-dropdown]')) {
      const label = dropdown.querySelector('[data-dropdown-value]');
      const checked = dropdown.querySelector('input[type="radio"]:checked');
      if (!(label instanceof HTMLElement)) continue;
      label.textContent = checked instanceof HTMLInputElement ? checked.value : label.dataset.placeholder ?? '';
    }

    // An incomplete choice keeps the button enabled so submitting can explain what is missing.
    if (!isComplete) this.#setButton(this.dataset.textAdd, false);
    else if (!variant) this.#setButton(this.dataset.textUnavailable, true);
    else if (!variant.available) this.#setButton(this.dataset.textSoldOut, true);
    else this.#setButton(this.dataset.textAdd, false);
  }

  /**
   * @param {string | undefined} label
   * @param {boolean} disabled
   */
  #setButton(label, disabled) {
    const button = this.querySelector('button[data-submit]');
    const text = this.querySelector('[data-submit-label]');
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = disabled;
    if (text && label) text.textContent = label;
  }

  /** @param {string} message - Announced through the popup's single status region. */
  #announce(message) {
    const region = this.querySelector('[data-message]');
    if (region) region.textContent = message;
  }

  /** @param {HTMLDetailsElement | null} [except] */
  #closeDropdowns(except = null) {
    for (const dropdown of this.querySelectorAll('details[data-dropdown][open]')) {
      if (dropdown !== except && dropdown instanceof HTMLDetailsElement) dropdown.open = false;
    }
  }

  /**
   * A click on the dialog element itself is a click on the backdrop (the panel fills the box).
   * Any other click closes open dropdowns that do not contain the target.
   * @param {MouseEvent} event
   */
  #handleDialogClick = (event) => {
    if (event.target === this.dialog) {
      this.dialog.close();
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const dropdown = target?.closest('details[data-dropdown]');
    this.#closeDropdowns(dropdown instanceof HTMLDetailsElement ? dropdown : null);
  };

  /**
   * Escape inside an open dropdown closes just the dropdown, not the whole popup.
   * @param {KeyboardEvent} event
   */
  #handleDialogKeydown = (event) => {
    if (event.key !== 'Escape' || !(event.target instanceof Element)) return;

    const dropdown = event.target.closest('details[data-dropdown][open]');
    if (!(dropdown instanceof HTMLDetailsElement)) return;

    event.preventDefault();
    dropdown.open = false;
    dropdown.querySelector('summary')?.focus();
  };

  /** @param {Event} event */
  #handleOptionChange = (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'radio') return;

    // Choosing a dropdown value closes the list and returns focus to its toggle.
    const dropdown = event.target.closest('details[data-dropdown]');
    if (dropdown instanceof HTMLDetailsElement) {
      dropdown.open = false;
      dropdown.querySelector('summary')?.focus();
    }

    this.#announce('');
    this.#render();
  };

  /** @param {SubmitEvent} event */
  #handleSubmit = async (event) => {
    event.preventDefault();

    // Ask for the first missing option: open its dropdown, or focus its first choice.
    const missing = this.#optionFields.find((field) => !field.querySelector('input[type="radio"]:checked'));
    if (missing) {
      this.#announce(missing.dataset.requiredMessage ?? '');
      const dropdown = missing.querySelector('details[data-dropdown]');
      if (dropdown instanceof HTMLDetailsElement) {
        dropdown.open = true;
        dropdown.querySelector('summary')?.focus();
      } else {
        missing.querySelector('input[type="radio"]')?.focus();
      }
      return;
    }

    const variant = this.#currentVariant();
    if (!variant?.available) return;

    this.#request?.abort();
    this.#request = new AbortController();
    const { signal } = this.#request;

    this.#setBusy(true);
    try {
      /** @type {{ id: number, quantity: number }[]} */
      const items = [{ id: variant.id, quantity: 1 }];
      const giftId = await this.#giftVariantFor(variant, signal);
      if (giftId) items.push({ id: giftId, quantity: 1 });

      const response = await fetch(`${this.dataset.cartAddUrl}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.description || error.message || '');
      }

      window.location.assign(this.dataset.cartUrl ?? '/cart');
    } catch (error) {
      if (signal.aborted) return;
      this.#announce((error instanceof Error && error.message) || this.dataset.textError || '');
      this.#setBusy(false);
    }
  };

  /** @param {boolean} busy */
  #setBusy(busy) {
    const button = this.querySelector('button[data-submit]');
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }

  /**
   * The gift variant id to add alongside `variant`, or null when the gift does not apply.
   * The gift applies when the variant has every trigger value (case-insensitive) and the
   * cart doesn't already contain the gift.
   * @param {Variant} variant
   * @param {AbortSignal} signal
   * @returns {Promise<number | null>}
   */
  async #giftVariantFor(variant, signal) {
    const giftId = Number(this.dataset.giftVariantId);
    if (!giftId || giftId === variant.id) return null;

    const triggers = (this.dataset.giftTrigger ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const values = variant.options.map((value) => value.toLowerCase());
    if (!triggers.length || !triggers.every((trigger) => values.includes(trigger))) return null;

    // If the cart can't be read, still add the gift: a duplicate beats a missing gift.
    try {
      const response = await fetch(`${this.dataset.cartUrl}.js`, { headers: { Accept: 'application/json' }, signal });
      const cart = await response.json();
      if (cart.items?.some((/** @type {{ variant_id: number }} */ item) => item.variant_id === giftId)) return null;
    } catch (error) {
      if (signal.aborted) throw error;
    }

    return giftId;
  }
}

if (!customElements.get('gift-guide-hotspot')) {
  customElements.define('gift-guide-hotspot', GiftGuideHotspot);
}
