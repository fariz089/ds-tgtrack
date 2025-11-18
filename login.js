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
    await page.waitForSelector("#form_item_account", { timeout: 10000 });
    console.log("form udah ready");

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
      await page.goto(this.config.login.url, { waitUntil: "networkidle2" });

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
    } finally {
      // hapus file temp
      if (fs.existsSync("./captcha_temp.png")) {
        fs.unlinkSync("./captcha_temp.png");
      }
    }
  }
}

module.exports = LoginManager;
