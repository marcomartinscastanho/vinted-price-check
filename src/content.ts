import "./styles.css";
import styles from "./styles.css?inline";

const HOST_ID = "vinted-price-extractor-host";
const TOGGLE_CLASS = "vpe-listing-toggle";

interface Listing {
  id: string;
  price: string;
  card: HTMLElement;
}

interface ExtractorHost extends HTMLDivElement {
  updatePrices?: () => void;
}

function isCatalogPage(): boolean {
  return location.hostname === "www.vinted.pt" && location.pathname === "/catalog";
}

function normalizeSellerPrice(text: string): string | null {
  const cleaned = text.replace(/[\u00a0\u202f\s€]/g, "");

  if (!/^\d+(?:\.\d{3})*(?:,\d+)?$/.test(cleaned)) {
    return null;
  }

  const amount = Number(cleaned.replace(/\./g, "").replace(",", "."));

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return amount.toString().replace(".", ",");
}

/**
 * Stores inclusion state by Vinted listing ID.
 * Listings are included by default when first encountered.
 * This Map is deliberately in-memory only, so a page reload
 * resets all listings to included.
 */
const includedListings = new Map<string, boolean>();

function isListingIncluded(id: string): boolean {
  return includedListings.get(id) ?? true;
}

function getListings(): Listing[] {
  const listings = new Map<string, Listing>();

  document.querySelectorAll<HTMLElement>('[data-testid="grid-item"]').forEach((card) => {
    // Ignore seller profile closet items.
    if (card.closest('article[class*="closet__item"], [data-testid^="closet-item-"]')) {
      return;
    }

    const prices = card.querySelectorAll<HTMLElement>('[data-testid$="--price-text"]');

    for (const priceElement of prices) {
      const testId = priceElement.dataset.testid ?? "";
      const match = testId.match(/^product-item-id-(\d+)--price-text$/);

      if (!match) continue;

      const id = match[1];

      const product = priceElement.closest<HTMLElement>(`[data-testid="product-item-id-${id}"]`);

      if (!product || !card.contains(product)) continue;

      const price = normalizeSellerPrice(priceElement.textContent ?? "");

      if (price !== null && !listings.has(id)) {
        listings.set(id, { id, price, card });
      }

      break;
    }
  });

  return [...listings.values()];
}

function findResultsHeader(): HTMLElement | null {
  const resultCount = Array.from(document.querySelectorAll<HTMLElement>("span")).find((element) =>
    /^\d+\+*\s+resultados?\.?$/i.test((element.textContent ?? "").trim()),
  );

  if (!resultCount) return null;

  return (
    resultCount.closest<HTMLElement>('div[class*="u-justify-content-between"][class*="u-align-items-center"]') ??
    resultCount.parentElement
  );
}

function mountPanel(): void {
  if (!isCatalogPage()) return;

  const existingHost = document.getElementById(HOST_ID) as ExtractorHost | null;

  if (existingHost) {
    positionPanel();
    return;
  }

  const host = document.createElement("div") as ExtractorHost;
  host.id = HOST_ID;
  host.style.cssText = "display:block;width:100%;box-sizing:border-box";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const panel = document.createElement("section");
  panel.className = "vpe-panel";

  panel.innerHTML = `
    <div class="vpe-heading">
      <span>Seller prices</span>
      <span class="vpe-count">0 items</span>
    </div>

    <textarea
      class="vpe-output"
      aria-label="Extracted seller prices"
      readonly
      rows="1"
      placeholder="Waiting for catalog results..."
    ></textarea>

    <div class="vpe-actions">
      <button type="button" class="vpe-copy" disabled>
        Copy prices
      </button>
      <span class="vpe-help" aria-live="polite">
        Seller prices only
      </span>
    </div>
  `;

  shadow.appendChild(panel);

  const output = panel.querySelector<HTMLTextAreaElement>(".vpe-output")!;

  const count = panel.querySelector<HTMLElement>(".vpe-count")!;

  const copyButton = panel.querySelector<HTMLButtonElement>(".vpe-copy")!;

  const help = panel.querySelector<HTMLElement>(".vpe-help")!;

  let currentOutput = "";
  let copiedStatusTimer: number | undefined;

  function update(): void {
    const listings = getListings();

    // Add a toggle to every discovered listing and keep its
    // visual state in sync with the inclusion Map.
    for (const listing of listings) {
      addOrUpdateToggle(listing);
    }

    const included = listings.filter((listing) => isListingIncluded(listing.id));

    currentOutput = included.map((listing) => listing.price).join(";");

    output.value = currentOutput;
    output.rows = Math.min(4, Math.max(1, Math.ceil(currentOutput.length / 100)));

    count.textContent = `${included.length} ${included.length === 1 ? "item" : "items"}`;

    copyButton.disabled = included.length === 0;

    if (copiedStatusTimer !== undefined) {
      window.clearTimeout(copiedStatusTimer);
      copiedStatusTimer = undefined;
    }

    copyButton.textContent = "Copy prices";
    help.textContent =
      included.length === listings.length ? "Seller prices only" : `${listings.length - included.length} excluded`;
  }

  function addOrUpdateToggle(listing: Listing): void {
    const existing = listing.card.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}[data-listing-id="${listing.id}"]`);

    const toggle = existing ?? document.createElement("button");

    if (!existing) {
      toggle.type = "button";
      toggle.className = TOGGLE_CLASS;
      toggle.dataset.listingId = listing.id;
      toggle.setAttribute("aria-label", "Toggle whether this listing is included in extracted prices");
      toggle.setAttribute("title", "Include/exclude price");

      toggle.addEventListener("click", (event) => {
        // Prevent the click from opening the product or
        // activating controls elsewhere in the card.
        event.preventDefault();
        event.stopPropagation();

        const id = toggle.dataset.listingId;
        if (!id) return;

        includedListings.set(id, !isListingIncluded(id));

        update();
      });

      toggle.innerHTML = `
        <span class="vpe-toggle-icon" aria-hidden="true">
          <svg
            fill="none"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              d="M8 1.25 10.05 5.4l4.58.67-3.31 3.23.78 4.56L8 11.7l-4.1 2.16.78-4.56-3.31-3.23 4.58-.67L8 1.25Z"
              fill="currentColor"
              stroke="currentColor"
              fill-rule="evenodd"
              clip-rule="evenodd"
            />
          </svg>
        </span>
      `;

      const buttonsContainer = listing.card.querySelector<HTMLElement>('div[class*="u-position-absolute"]');
      if (!!buttonsContainer) {
        buttonsContainer.insertBefore(toggle, buttonsContainer.firstChild);
      }
    }

    const included = isListingIncluded(listing.id);

    toggle.classList.toggle("is-included", included);
    toggle.classList.toggle("is-excluded", !included);

    toggle.setAttribute("aria-pressed", included ? "true" : "false");

    toggle.setAttribute("aria-label", included ? "Exclude from extracted prices." : "Include in extracted prices.");

    toggle.title = included ? "Included" : "Excluded";
  }

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentOutput);
    } catch {
      output.focus();
      output.select();

      const copied = document.execCommand("copy");

      if (!copied) {
        help.textContent = "Copy failed. Select and copy the text manually.";
        return;
      }
    }

    copyButton.textContent = "Copied!";
    help.textContent = "Prices copied to clipboard.";

    if (copiedStatusTimer !== undefined) {
      window.clearTimeout(copiedStatusTimer);
    }

    copiedStatusTimer = window.setTimeout(() => {
      copyButton.textContent = "Copy prices";
      copiedStatusTimer = undefined;
    }, 1500);
  });

  output.addEventListener("focus", () => output.select());

  host.updatePrices = update;

  document.body.appendChild(host);
  positionPanel();
  update();
}

function positionPanel(): void {
  const host = document.getElementById(HOST_ID);
  if (!host) return;

  const header = findResultsHeader();

  if (header) {
    if (host.parentElement !== header.parentElement || host.previousElementSibling !== header) {
      header.insertAdjacentElement("afterend", host);
    }
  } else if (host.parentElement !== document.body) {
    document.body.prepend(host);
  }
}

function refresh(): void {
  const host = document.getElementById(HOST_ID) as ExtractorHost | null;

  if (!host) {
    mountPanel();
    return;
  }

  positionPanel();
  host.updatePrices?.();
}

function start(): void {
  if (!isCatalogPage()) return;

  mountPanel();

  let scheduled = false;

  const observer = new MutationObserver(() => {
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

start();
