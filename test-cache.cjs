const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://localhost:5173');
  // Wait a bit for JS to execute
  await page.waitForTimeout(2000);
  
  const ls = await page.evaluate(() => {
    return {
      terminal: localStorage.getItem('cashier:terminal'),
      root: localStorage.getItem('cashier:root'),
      cookies: document.cookie
    };
  });
  
  console.log("LOCALSTORAGE TERMINAL:", ls.terminal);
  console.log("LOCALSTORAGE ROOT:", ls.root);
  console.log("COOKIES:", ls.cookies);
  
  await browser.close();
})();
