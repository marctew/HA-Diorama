// Renders tools/brand/icon.svg into the PNGs Home Assistant and the
// Marketplace show: node tools/brand/make.mjs (needs Playwright's Chromium).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = import.meta.dirname;
const svg = readFileSync(resolve(here, "icon.svg"), "utf8");
const out = resolve(here, "../../custom_components/diorama/brand");

const browser = await chromium.launch();
for (const [name, size] of [["icon.png", 256], ["icon@2x.png", 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: resolve(out, name), omitBackground: true });
  await page.close();
}
await browser.close();
