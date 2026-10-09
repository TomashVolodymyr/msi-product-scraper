import { chromium } from "playwright";

const URL = 'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function getDataLayerProduct(page) {
    const handle = await page.waitForFunction(() => {
        const entries = Array.isArray(window.dataLayer) ? window.dataLayer : [];
        return entries.find(entry => entry[0] === 'event' && entry[1] === 'view_item');
    }, null, { timeout: 30_000 });

    const event = await handle.jsonValue();
    return event?.[2]?.items?.[0] ?? null;
}

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

function toCategoryPath(categoryTree) {
    return categoryTree.length > 0 ? categoryTree.map(crump => crump.name).join(' > ') : null;
}

async function getText(page, selector) {
    const texts = await page.$$eval(selector, (elements) =>
        elements.map((element) => element.textContent.replace(/\s+/g, ' ').trim()),
    );

    return texts[0] || null;
}

function toAvailability(text) {
    if (!text) return null;

    const value = text.toLowerCase();
    if (value.includes('pre-order') || value.includes('preorder')) return 'pre_order';
    if (value.includes('out of stock') || value.includes('notify me')) return 'out_of_stock';
    if (value.includes('in stock') || value.includes('add to cart')) return 'in_stock';
    return null;
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

async function main() {
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    try {
        const context = await browser.newContext({
            userAgent: USER_AGENT,
            locale: 'en-US',
            viewport: { width: 1366, height: 900 }
        });

        const page = await context.newPage();
        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        const title = await page.title();
        if (/access denied/i.test(title)) {
            throw new Error('Blocked by the site: got "Access Denied" page');
        }

        const dataLayerProduct = await getDataLayerProduct(page);
        const fromDataLayer = mapDataLayerFields(dataLayerProduct);
        console.log(fromDataLayer);

        const categoryTree = await getCategoryTree(page);
        console.log(categoryTree);
        console.log(toCategoryPath(categoryTree));

        const description = await getText(page, '.product-detail h2.title + div');
        console.log(description);

        const buyBlockText = await getText(page, '.product-detail .row:has(> #prices-wrapper)');
        console.log(toAvailability(buyBlockText));

        const images = await getImageUrls(page);
        console.log(images);
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});