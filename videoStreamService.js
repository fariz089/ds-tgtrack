const axios = require("axios");

class VideoStreamService {
  constructor() {
    this.videoPage = null;
    this.browser = null;
    this.isInitialized = false;
    this.token = null;
    this.organizeId = null;
  }

  /**
   * Set browser instance dan auth dari main app
   */
  setBrowser(browser) {
    this.browser = browser;
  }

  /**
   * Set token dan organizeId untuk API calls
   */
  setAuth(token, organizeId) {
    this.token = token;
    this.organizeId = organizeId;
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
   * Get stream URL dari Gateway API
   * @param {string} imei - Device IMEI
   * @param {number} channel - Camera channel (1-8)
   * @returns {Promise<Object>} Stream info (http, m3u8, rtmp, ws)
   */
  async getStreamInfo(imei, channel = 1) {
    try {
      if (!this.token || !this.organizeId) {
        throw new Error("Token or OrganizeId not set");
      }

      console.log(`🔍 Getting stream info for ${imei} channel ${channel}...`);

      const response = await axios.post(
        "https://ds.tgtrack.com/api/gateway/live/play",
        {
          zone: "",
          imei: imei,
          chn: channel,
          video_data_type: 0,
          stream: 1,
          protocol: "jtt1078",
        },
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json;charset=UTF-8",
            OrganizeId: this.organizeId,
            Origin: "https://ds.tgtrack.com",
            Referer: "https://ds.tgtrack.com/",
            TimeZone: "+07:00",
            "X-Api-Version": "1.0.4",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 10000,
        }
      );

      if (response.data.code === 0 && response.data.result?.data) {
        const data = response.data.result.data;
        console.log(`✅ Stream info: ${data.http}`);
        return {
          stream_id: data.stream_id,
          http: data.http,
          m3u8: data.m3u8,
          rtmp: data.rtmp,
          ws: data.ws,
          is_present: data.is_present,
        };
      } else {
        throw new Error(`API error: ${response.data.msg || "Unknown error"}`);
      }
    } catch (err) {
      console.error(`❌ Error getting stream info: ${err.message}`);
      throw err;
    }
  }

  /**
   * Fetch video stream using Puppeteer
   * @param {string} streamUrl - Stream URL from API
   * @param {number} durationSeconds - Duration in seconds
   * @returns {Promise<Buffer>} Video buffer
   */
  async fetchStream(streamUrl, durationSeconds = 5) {
    try {
      const vPage = await this.initVideoPage();

      console.log(`📹 Fetching stream: ${streamUrl} (${durationSeconds}s)`);

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

          reader.cancel();

          const combined = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          return Array.from(combined);
        },
        streamUrl,
        durationSeconds
      );

      console.log(`✅ Fetched ${(videoBuffer.length / 1024).toFixed(2)} KB`);
      return Buffer.from(videoBuffer);
    } catch (err) {
      console.error(`❌ Error fetching stream: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if video stream is available
   */
  async checkAvailability(imei, channel = 1) {
    try {
      const streamInfo = await this.getStreamInfo(imei, channel);
      return streamInfo.is_present;
    } catch (err) {
      console.error(`Camera ${channel} not available: ${err.message}`);
      return false;
    }
  }

  /**
   * Get all camera URLs (1-8) without checking availability
   */
  getCameraList(imei) {
    return Array.from({ length: 8 }, (_, i) => ({
      channel: i + 1,
      imei: imei,
      available: null, // Unknown until checked
    }));
  }

  /**
   * Check availability for all cameras (1-8)
   */
  async checkAllCameras(imei) {
    console.log(`🔍 Checking all cameras for ${imei}...`);

    const checks = Array.from({ length: 8 }, (_, i) => i + 1).map(async (channel) => {
      try {
        const streamInfo = await this.getStreamInfo(imei, channel);
        return {
          channel,
          available: streamInfo.is_present,
          http: streamInfo.http,
          m3u8: streamInfo.m3u8,
        };
      } catch (err) {
        return {
          channel,
          available: false,
          error: err.message,
        };
      }
    });

    const results = await Promise.all(checks);
    const availableCount = results.filter((r) => r.available).length;

    console.log(`✅ Found ${availableCount}/8 available cameras`);

    return results;
  }

  async close() {
    if (this.videoPage) {
      await this.videoPage.close();
      this.videoPage = null;
      this.isInitialized = false;
      console.log("🔒 Video streaming page closed");
    }
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      hasPage: !!this.videoPage,
      hasBrowser: !!this.browser,
      hasAuth: !!(this.token && this.organizeId),
    };
  }
}

module.exports = VideoStreamService;
