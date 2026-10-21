# Storefront and workspace design

The React workspace uses the existing authenticated APIs. Overview and observability values come from live server, catalog, key and audit data; no demonstration metrics are fabricated. Integration editing, member roles, invitations and key creation use focused dialogs. Chat retains the per-user gateway path, per-message write approval and visible tool activity. The dashboard is responsive and does not request external fonts or scripts.

The `store/theme` directory is a first-party classic WordPress theme. It changes presentation while WooCommerce continues to own product data, cart sessions, totals, checkout validation, payment selection and orders. Cart and checkout pages use native WooCommerce shortcodes. Bootstrap installs the versioned theme from the image into persistent WordPress content, activates it, and idempotently creates three additional virtual demonstration products. Existing products and orders are retained. Theme activation requires rerunning `store/bootstrap.sh` after deploying a new store image, as with the initial installation.

Products without uploaded images receive a local illustrative photograph selected by their name (journal, planner or general stationery). This also covers products created through MCP chat, without changing the five-tool API or trusting image URLs from a model. Uploaded product photos take precedence. The store clearly identifies the virtual demo and illustrative photography; no payment or physical shipping is promised.

## Image sources

Downloaded, self-hosted JPEGs avoid third-party requests during browsing. Source photography is distributed under each provider's free photo license. These are illustrative photographs, not pictures of a delivered digital file.

- `studio.jpg`: JESHOOTS.COM, [open notebook on a desk](https://unsplash.com/photos/an-open-empty-notebook-on-a-white-desk-next-to-an-iphone-and-a-macbook-pUAM5hPaCRI), [Unsplash license](https://unsplash.com/license).
- `planner.jpg`: Fiona Murray-deGraaff, [notepad and paper clips](https://unsplash.com/photos/a-notepad-pen-and-paper-clips-on-a-white-surface-wFJYe_LC1vM), Unsplash license.
- `journal.jpg`: Kaboompics, [notebook and pencil on beige surface](https://www.pexels.com/photo/notebook-and-pencil-on-beige-surface-8947463/), [Pexels license](https://www.pexels.com/license/).
- `notes.jpg`: Arina Krasnikova, [notebook and pencil on a table](https://www.pexels.com/photo/a-notebook-and-pencil-on-the-table-5712442/), Pexels license.
