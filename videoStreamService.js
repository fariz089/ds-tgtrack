// videoStreamService.js
class VideoStreamService {
  constructor() {
    this.videoPage = null;
    this.browser = null;
    this.isInitialized = false;
  }

  /**
   * Set browser instance dari main app
   */
  setBrowser(browser) {
    this.browser = browser;
  }

  /**
   * Initialize dedicated page untuk video streaming (lazy init)
   */
  async initVideoPage() {
    if (!this.videoPage && this.browser) {
      console.log("📹 Initializing video streaming page...");

      this.videoPage = await this.browser.newPage();

      await this.videoPage.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
      );

      await this.videoPage.setExtraHTTPHeaders({
        "Accept-Language": "en-GB,en;q=0.9,id;q=0.8",
        DNT: "1",
        Origin: "https://ds.tgtrack.com",
        Referer: "https://ds.tgtrack.com/",
      });

      // Navigate to ds.tgtrack.com untuk set proper Referer
      await this.videoPage.goto("https://ds.tgtrack.com/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      this.isInitialized = true;
      console.log("✅ Video streaming page ready");
    }

    return this.videoPage;
  }

  /**
   * Get video stream URL
   * @param {string} imei - Device IMEI
   * @param {number} channel - Camera channel (1-8)
   * @returns {string} Stream URL
   */
  getStreamUrl(imei, channel = 1) {
    return `https://tripsdd.com:9089/mdvr/live/${imei}_${channel}.flv`;
  }

  /**
   * Fetch video stream using Puppeteer (on-demand)
   * @param {string} imei - Device IMEI
   * @param {number} channel - Camera channel (1-8)
   * @param {number} durationSeconds - Duration in seconds
   * @returns {Promise<Buffer>} Video buffer
   */
  async fetchStream(imei, channel = 1, durationSeconds = 5) {
    try {
      const vPage = await this.initVideoPage();
      const videoUrl = this.getStreamUrl(imei, channel);

      console.log(`📹 Fetching: ${imei} camera ${channel} (${durationSeconds}s)`);

      // Fetch video using page.evaluate
      const videoBuffer = await vPage.evaluate(
        async (url, duration) => {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "*/*",
              Origin: "https://ds.tgtrack.com",
              Referer: "https://ds.tgtrack.com/",
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const reader = response.body.getReader();
          const chunks = [];
          let totalBytes = 0;
          const maxBytes = duration * 100 * 1024; // ~100KB per second

          while (totalBytes < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.length;
          }

          // Cancel remaining stream
          reader.cancel();

          // Combine chunks
          const combined = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          return Array.from(combined);
        },
        videoUrl,
        durationSeconds
      );

      console.log(`✅ Fetched ${(videoBuffer.length / 1024).toFixed(2)} KB`);
      return Buffer.from(videoBuffer);
    } catch (err) {
      console.error(`❌ Error fetching video: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if video stream is available
   * @param {string} imei - Device IMEI
   * @param {number} channel - Camera channel (1-8)
   * @returns {Promise<boolean>}
   */
  async checkAvailability(imei, channel = 1) {
    try {
      const buffer = await this.fetchStream(imei, channel, 1);
      return buffer.length > 1000; // At least 1KB
    } catch (err) {
      console.error(`Camera ${channel} not available: ${err.message}`);
      return false;
    }
  }

  /**
   * Get all camera URLs (1-8) without checking availability
   * @param {string} imei - Device IMEI
   * @returns {Array} Array of camera info
   */
  getCameraList(imei) {
    return Array.from({ length: 8 }, (_, i) => ({
      channel: i + 1,
      url: this.getStreamUrl(imei, i + 1),
      available: null, // Unknown until checked
    }));
  }

  /**
   * Check availability for all cameras (1-8)
   * @param {string} imei - Device IMEI
   * @returns {Promise<Array>} Array of camera info with availability
   */
  async checkAllCameras(imei) {
    console.log(`🔍 Checking all cameras for ${imei}...`);

    const checks = Array.from({ length: 8 }, (_, i) => i + 1).map(async (channel) => {
      try {
        const available = await this.checkAvailability(imei, channel);
        return {
          channel,
          available,
          url: this.getStreamUrl(imei, channel),
        };
      } catch (err) {
        return {
          channel,
          available: false,
          url: this.getStreamUrl(imei, channel),
          error: err.message,
        };
      }
    });

    const results = await Promise.all(checks);
    const availableCount = results.filter((r) => r.available).length;

    console.log(`✅ Found ${availableCount}/8 available cameras`);

    return results;
  }

  /**
   * Close video page
   */
  async close() {
    if (this.videoPage) {
      await this.videoPage.close();
      this.videoPage = null;
      this.isInitialized = false;
      console.log("🔒 Video streaming page closed");
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      hasPage: !!this.videoPage,
      hasBrowser: !!this.browser,
    };
  }
}

module.exports = VideoStreamService;
