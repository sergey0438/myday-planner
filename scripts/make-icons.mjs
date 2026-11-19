// Renders the app icon to PNG sizes with the preinstalled Chromium.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const rounded = svg.replace('<rect width="512" height="512" fill="url(#g)"/>', '<rect width="512" height="512" rx="112" fill="url(#g)"/>');
writeFileSync(new URL('../public/favicon.svg', import.meta.url), rounded);
const maskable = svg.replace('translate(256 262)', 'translate(256 262) scale(.78)');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(src, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/${out}`, import.meta.url).pathname, omitBackground: true });
}
await render(svg, 180, 'apple-touch-icon.png');
await render(svg, 192, 'icon-192.png');
await render(svg, 512, 'icon-512.png');
await render(maskable, 512, 'icon-maskable-512.png');
await browser.close();
