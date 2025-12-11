// login.js
const Captcha = require("2captcha");
const fs = require("fs");
const { sleep, waitForTargetUrl } = require("./utils");

class LoginManager {
  constructor(config) {
    this.config = config;
    this.solver = new Captcha.Solver(config.captcha.apiKey);
  }

  async solveCaptcha(page) {
    console.log("ambil captcha...");
    const captchaElement = await page.$("img.tg-image");

    if (!captchaElement) {
      throw new Error("captcha ga ketemu");
    }

    await captchaElement.screenshot({ path: "./captcha_temp.png" });
    console.log("captcha disimpen");

    console.log("solve captcha, tunggu 10-30 detik...");
    const captchaBase64 = fs.readFileSync("./captcha_temp.png", "base64");
    const result = await this.solver.imageCaptcha(captchaBase64);

    console.log("captcha solved:", result.data);
    return result.data;
  }

  async fillLoginForm(page) {
    // ✅ Tunggu dengan timeout lebih panjang + multiple attempts
    console.log("tunggu form login muncul...");

    let formReady = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!formReady && attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}/${maxAttempts} - checking form...`);
      
      await sleep(10000);
      
      try {
        await page.waitForSelector("#form_item_account", {
          timeout: 15000,
          visible: true,
        });
        formReady = true;
        console.log("✓ form udah ready");
      } catch (error) {
        console.log(`⚠ Form belum muncul (attempt ${attempts})`);

        if (attempts < maxAttempts) {
          console.log("Tunggu 3 detik dan coba lagi...");
          await sleep(3000);

          // ✅ Scroll ke atas (kadang form di luar viewport)
          await page.evaluate(() => window.scrollTo(0, 0));

          // ✅ Cek URL masih di login page atau tidak
          const currentUrl = page.url();
          console.log(`Current URL: ${currentUrl}`);

          if (!currentUrl.includes("login")) {
            throw new Error(`Not on login page: ${currentUrl}`);
          }
        } else {
          // ✅ Screenshot untuk debugging
          const screenshotPath = `./logs/form-not-found-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`📸 Screenshot saved: ${screenshotPath}`);

          throw new Error("Form login tidak muncul setelah 3 attempts");
        }
      }
    }

    console.log("isi username...");
    await page.type("#form_item_account", this.config.login.username, {
      delay: 100,
    });

    console.log("isi password...");
    await page.type("#form_item_password", this.config.login.password, {
      delay: 100,
    });
  }

  async submitLogin(page, captchaCode) {
    console.log("isi captcha...");
    await page.type("#form_item_verify_code", captchaCode, { delay: 100 });

    await sleep(1000);

    console.log("klik login...");
    const navigationPromise = page.waitForNavigation({
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const loginButton = buttons.find((btn) => btn.textContent.trim() === "Login");
      if (loginButton) loginButton.click();
    });

    try {
      await navigationPromise;
      console.log("redirect pertama selesai");
    } catch (error) {
      console.log("timeout navigation, cek manual...");
    }
  }

  async login(page) {
    try {
      console.log("buka halaman login...");

      // ✅ Goto dengan retry
      let pageLoaded = false;
      let gotoAttempts = 0;
      const maxGotoAttempts = 3;

      while (!pageLoaded && gotoAttempts < maxGotoAttempts) {
        gotoAttempts++;
        console.log(`Loading login page (attempt ${gotoAttempts}/${maxGotoAttempts})...`);

        try {
          await page.goto(this.config.login.url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          pageLoaded = true;
          console.log("✓ Login page loaded");
        } catch (error) {
          console.log(`⚠ Page load failed (attempt ${gotoAttempts}): ${error.message}`);

          if (gotoAttempts < maxGotoAttempts) {
            console.log("Retry in 5 seconds...");
            await sleep(5000);
          } else {
            throw new Error("Failed to load login page after all attempts");
          }
        }
      }

      // ✅ Wait extra untuk Vue.js render
      console.log("tunggu Vue.js render...");
      await sleep(5000); // Tambah delay untuk SPA

      // ✅ Scroll ke atas
      await page.evaluate(() => window.scrollTo(0, 0));

      await this.fillLoginForm(page);
      await sleep(2000);

      const captchaCode = await this.solveCaptcha(page);
      await this.submitLogin(page, captchaCode);

      console.log("tunggu redirect ke monitor page...");
      const reachedTarget = await waitForTargetUrl(page, this.config.target.url, this.config.target.timeout);

      if (reachedTarget) {
        console.log("berhasil! skrg di:", page.url());
        return { success: true, url: page.url() };
      } else {
        console.log("ga sampe monitor page dalam 30 detik");
        return { success: false, url: page.url() };
      }
    } catch (error) {
      console.error("❌ Error during login:", error.message);

      // ✅ Screenshot error
      try {
        const screenshotPath = `./logs/login-error-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Error screenshot: ${screenshotPath}`);
      } catch (screenshotErr) {
        // Ignore
      }

      return { success: false, url: page.url(), error: error.message };
    } finally {
      // hapus file temp
      if (fs.existsSync("./captcha_temp.png")) {
        fs.unlinkSync("./captcha_temp.png");
      }
    }
  }
}

module.exports = LoginManager;
