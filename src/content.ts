import styles from "./styles.css?inline";

const HOST_ID = "vinted-price-extractor-host";

interface Listing {
  id: string;
  price: string;
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

function getListings(): Listing[] {
  const listings = new Map<string, Listing>();

  document.querySelectorAll<HTMLElement>('[data-testid="grid-item"]').forEach((card) => {
    if (card.closest('article[class*="closet__item"], ' + '[data-testid^="closet-item-"]')) {
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
        listings.set(id, { id, price });
      }

      break;
    }
  });

  return [...listings.values()];
}

function findResultsHeader(): HTMLElement | null {
  const resultCount = Array.from(document.querySelectorAll<HTMLElement>("span")).find((element) =>
    /^\d+\s+resultados?\.?$/i.test((element.textContent ?? "").trim()),
  );

  if (!resultCount) return null;

  return (
    resultCount.closest<HTMLElement>('div[class*="u-justify-content-between"]' + '[class*="u-align-items-center"]') ??
    resultCount.parentElement
  );
}

function mountPanel(): void {
  if (!isCatalogPage()) return;

  if (document.getElementById(HOST_ID)) {
    positionPanel();
    return;
  }

  const host = document.createElement("div");
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

  function update(): void {
    const listings = getListings();

    currentOutput = listings.map((item) => item.price).join(";");

    output.value = currentOutput;
    output.rows = Math.min(4, Math.max(1, Math.ceil(currentOutput.length / 100)));

    count.textContent = `${listings.length} ${listings.length === 1 ? "item" : "items"}`;

    copyButton.disabled = listings.length === 0;
    copyButton.textContent = "Copy prices";
    help.textContent = "Seller prices only";
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

    window.setTimeout(() => {
      copyButton.textContent = "Copy prices";
    }, 1500);
  });

  output.addEventListener("focus", () => output.select());

  // Keep the updater accessible to the observer without
  // introducing React or a framework-specific state layer.
  host.dataset.ready = "true";

  shadow.appendChild(document.createComment("Vinted price extractor"));

  // Store the update function on the host for this script.
  panel.dataset.initialized = "true";
  (host as HTMLElement & { updatePrices?: () => void }).updatePrices = update;

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
  } else if (!host.isConnected) {
    document.body.prepend(host);
  }
}

function refresh(): void {
  const host = document.getElementById(HOST_ID) as (HTMLElement & { updatePrices?: () => void }) | null;

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
