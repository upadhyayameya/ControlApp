// Print one catalogue HTML file to a US Letter PDF with Chromium.
//   node render.cjs page.html out.pdf ["footer text"]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [, , input, output, footer] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(input), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await page.pdf({
    path: output,
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: Boolean(footer),
    headerTemplate: '<span></span>',
    footerTemplate: footer
      ? `<div style="width:100%;font:7.5px Inter,Helvetica,sans-serif;color:#6b7280;text-align:center">${esc(footer)}</div>`
      : '<span></span>',
  });
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
