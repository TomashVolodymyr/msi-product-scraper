# MSI Product Page Scraper

A small Playwright scraper that extracts product data from one MSI US Store product page
and saves it as JSON.

Target page: https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI

## Requirements

- Node.js 18+

## Run

```bash
npm install
npx playwright install chromium
npm run scrape
```

The result is written to `output/product.json` (created or overwritten on every run).

## Where the data comes from

| Field | Source |
| --- | --- |
| `item_id`, `title`, `price`, `sale_price` | `window.dataLayer`, GA4 `view_item` event |
| `brand` | Page `<title>`: the text before the product title |
| `product_category`, `category_tree` | Breadcrumbs `ol.breadcrumb`, without "Home" and the current product |
| `description` | Short summary under the product title |
| `availability` | Text of the buy block next to the price ("Out of stock", "Notify Me", "Add to cart", "Pre-order") |
| `image_url`, `additional_image_urls` | Full-size images of the product gallery, thumbnails skipped, duplicates removed |
| `specs` | Specification tables, one `th`/`td` pair per row |
| `star_rating`, `review_count` | Rating widget `#average-rating-info`, e.g. `4.7 (3)` |
| `mpn` | Spec row "Manufacturer Number" |
| `gtin` | Spec row with UPC/EAN/GTIN; not present on this page, so `null` |

## Notes

- **Headless mode.** The default Playwright headless build (`chromium-headless-shell`) gets an
  "Access Denied" page from the site. The scraper runs the full Chromium build in headless mode
  (`channel: 'chromium'`), which `npx playwright install chromium` already installs.
- **Prices.** In GA4, `price` is the price actually paid and `discount` is the discount amount.
  When `discount > 0`, the regular price is `price + discount` and `sale_price` is `price`.
- **Rating.** The rating widget is rendered by JavaScript after page load, so the scraper waits
  for it up to 10 seconds and returns `null` if it never appears.
- Missing values are `null`; list fields are empty arrays when nothing is found.