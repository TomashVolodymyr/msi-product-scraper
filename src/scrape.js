import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const URL = 'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';
const OUTPUT_PATH = 'output/product.json';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Page readers: get raw data from the live page
// ---------------------------------------------------------------------------

async function getDataLayerProduct(page) {
    const handle = await page.waitForFunction(() => {
        const entries = Array.isArray(window.dataLayer) ? window.dataLayer : [];
        return entries.find(entry => entry[0] === 'event' && entry[1] === 'view_item');
    }, null, { timeout: 30_000 });

    const event = await handle.jsonValue();
    return event?.[2]?.items?.[0] ?? null;
}

async function getText(page, selector) {
    const texts = await page.$$eval(selector, (elements) =>
        elements.map((element) => element.textContent.replace(/\s+/g, ' ').trim()),
    );

    return texts[0] || null;
}

async function getRatingText(page) {
    try {
        await page.waitForFunction(
            () => document.querySelector('#average-rating-info')?.textContent.trim(),
            null,
            { timeout: 10_000 },
        );
    } catch {
        return null;
    }

    return getText(page, '#average-rating-info');
}

async function getCategoryTree(page) {
    const crumbs = await page.$$eval(
        'ol.breadcrumb li.breadcrumb-item:not(.active)',
        (items) => {
            return items.map(li => {
                const link = li.querySelector('a');
                return {
                    name: li.textContent.trim(),
                    url: link ? link.href : null
                }
            });
        }
    );

    return crumbs.filter(crumb => crumb.name.toLowerCase() !== 'home');
}

async function getImageUrls(page) {
    const urls = await page.$$eval(
        '.product-detail .col-md-6:has(#imagePopup) img:not(.product-detail-thumb-bto)',
        (images) => images.map((img) => img.src).filter(Boolean),
    );

    const unique = [...new Set(urls)];
    return {
        image_url: unique[0] ?? null,
        additional_image_urls: unique.slice(1),
    };
}

async function getSpecs(page) {
    return page.$$eval('table tr', (rows) =>
        rows
            .map((row) => {
                const nameCell = row.querySelector('th');
                const valueCell = row.querySelector('td');
                if (!nameCell || !valueCell) return null;

                const clean = (text) => text.replace(/\s+/g, ' ').trim();
                const value = clean(valueCell.textContent);

                return {
                    name: clean(nameCell.textContent),
                    value: value && value !== '-' ? value : null,
                };
            })
            .filter(Boolean),
    );
}

// ---------------------------------------------------------------------------
// Normalizers: turn raw values into schema values
// ---------------------------------------------------------------------------

function roundPrice(val) {
    return Math.round(val * 100) / 100;
}

function mapDataLayerFields(item) {
    const paid = Number.isFinite(item?.price) ? item.price : null;
    const discount = Number.isFinite(item?.discount) ? item.discount : 0;
    const hasDiscount = paid !== null && discount > 0;

    return {
        item_id: item?.id ?? null,
        title: item?.name ?? null,
        price: hasDiscount ? roundPrice(paid + discount) : paid,
        sale_price: hasDiscount ? paid : null,
    }
}

function toCategoryPath(categoryTree) {
    return categoryTree.length > 0 ? categoryTree.map(crumb => crumb.name).join(' > ') : null;
}

function toAvailability(text) {
    if (!text) return null;

    const value = text.toLowerCase();
    if (value.includes('pre-order') || value.includes('preorder')) return 'pre_order';
    if (value.includes('out of stock') || value.includes('notify me')) return 'out_of_stock';
    if (value.includes('in stock') || value.includes('add to cart')) return 'in_stock';
    return null;
}

function parseRating(text) {
    const match = text?.match(/([\d.]+)\s*\((\d+)\)/);
    if (!match) return { star_rating: null, review_count: null };

    return {
        star_rating: Number(match[1]),
        review_count: Number(match[2]),
    };
}

function extractBrand(pageTitle, productTitle) {
    if (!pageTitle || !productTitle || !pageTitle.includes(productTitle)) return null;
    return pageTitle.split(productTitle)[0].trim() || null;
}

function findSpecValue(specs, namePattern) {
    return specs.find((spec) => namePattern.test(spec.name))?.value ?? null;
}

// ---------------------------------------------------------------------------
// Result: assemble the product object and save it
// ---------------------------------------------------------------------------

async function scrapeProduct(page, pageTitle) {
    const dataLayerItem = mapDataLayerFields(await getDataLayerProduct(page));
    const categoryTree = await getCategoryTree(page);
    const images = await getImageUrls(page);
    const specs = await getSpecs(page);
    const rating = parseRating(await getRatingText(page));
    const buyBlockText = await getText(page, '.product-detail .row:has(> #prices-wrapper)');

    return {
        url: page.url(),
        item_id: dataLayerItem.item_id,
        title: dataLayerItem.title,
        brand: extractBrand(pageTitle, dataLayerItem.title),
        product_category: toCategoryPath(categoryTree),
        category_tree: categoryTree,
        description: await getText(page, '.product-detail h2.title + div'),
        price: dataLayerItem.price,
        sale_price: dataLayerItem.sale_price,
        availability: toAvailability(buyBlockText),
        image_url: images.image_url,
        additional_image_urls: images.additional_image_urls,
        specs,
        star_rating: rating.star_rating,
        review_count: rating.review_count,
        gtin: findSpecValue(specs, /upc|ean|gtin/i),
        mpn: findSpecValue(specs, /manufacturer number|mpn|part number/i),
        scraped_at: new Date().toISOString(),
    };
}

async function saveJson(filePath, data) {
    await mkdir('output', { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });

    try {
        const context = await browser.newContext({
            userAgent: USER_AGENT,
            locale: 'en-US',
            viewport: { width: 1366, height: 900 },
        });
        const page = await context.newPage();

        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        const pageTitle = await page.title();
        if (/access denied/i.test(pageTitle)) {
            throw new Error('Blocked by the site: got "Access Denied" page');
        }

        const product = await scrapeProduct(page, pageTitle);
        await saveJson(OUTPUT_PATH, product);
        console.log(`Saved ${OUTPUT_PATH}: ${product.title}, ${product.specs.length} specs`);
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});