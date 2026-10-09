import { chromium } from "playwright";

const URL = 'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';


async function main() {
    const browser = await chromium.launch({ headless: false });
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

        console.log('Final URL: ', page.url());
        console.log('Title: ', title);

    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});