const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  
  // Set up local storage
  await context.addInitScript(() => {
    // We just need a valid auth and cashier terminal in localStorage to bypass login
    const terminal = {
      posDeviceId: 27,
      name: "St Catharines Till 1",
      locationId: 10,
      settings: {}
    };
    window.localStorage.setItem("cashier:terminal", JSON.stringify(terminal));
    
    // Auth token doesn't matter much if the proxy intercepts it, but we need something to avoid redirect
    const authState = {
      user: { id: 3, role_id: 3, locationId: 10 },
      token: "fake-jwt",
      locations: [{ locationId: 10, legalBusinessName: "Aerosports St Catharines" }]
    };
    window.localStorage.setItem("persist:root", JSON.stringify({
      auth: JSON.stringify(authState)
    }));
  });

  const page = await context.newPage();
  
  // Intercept all API responses
  page.on('response', async response => {
    if (response.url().includes('/api/bookings/all')) {
      console.log('API Status:', response.status());
      try {
        const body = await response.json();
        console.log('API Body length:', body?.data?.length);
      } catch(e) {
        console.log('API Body:', await response.text());
      }
    }
  });

  // Intercept console
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('api') || msg.text().includes('fetch')) {
      console.log('BROWSER CONSOLE:', msg.text());
    }
  });

  await page.goto('http://localhost:5173/#/find');
  await page.waitForTimeout(2000);
  
  // See if we are redirected to login
  console.log("Current URL:", page.url());
  
  // Type into search
  try {
    await page.fill('input[placeholder*="guest name"]', 'john');
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log("Couldn't type in search. Page content:", await page.content());
  }

  await browser.close();
})();
