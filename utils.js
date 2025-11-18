// utils.js

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTargetUrl(page, targetUrl, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const currentUrl = page.url();
    if (currentUrl.includes("monitor")) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

// Check apakah sudah login dengan cek URL atau presence elemen tertentu
async function isLoggedIn(page) {
  try {
    const currentUrl = page.url();

    // Jika di halaman login, belum login
    if (currentUrl.includes("/login")) {
      return false;
    }

    // Jika di halaman monitor, sudah login
    if (currentUrl.includes("/monitor")) {
      return true;
    }

    // Cek localStorage ada token atau tidak
    const hasToken = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.some((k) => k.includes("TOKEN") || k.includes("AUTH"));
    });

    return hasToken;
  } catch (error) {
    return false;
  }
}

// Extract Bearer token dari localStorage ATAU cookies
async function extractAuthToken(page) {
  const token = await page.evaluate(() => {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("Authorization") ||
      localStorage.getItem("auth_token")
    );
  });

  if (token) {
    console.log("Token ditemukan di localStorage");
    return token;
  }

  const cookies = await page.cookies();
  const authCookie = cookies.find((c) =>
    ["authorization", "Authorization", "access_token", "token", "auth_token"].includes(c.name)
  );

  if (authCookie) {
    console.log("Token ditemukan di cookies:", authCookie.name);
    return authCookie.value;
  }

  return null;
}

// Extract OrganizeId dari localStorage atau cookies
async function extractOrganizeId(page) {
  const organizeId = await page.evaluate(() => {
    return localStorage.getItem("organizeId") || localStorage.getItem("OrganizeId");
  });

  if (organizeId) return organizeId;

  const cookies = await page.cookies();
  const orgCookie = cookies.find((c) => ["organizeId", "OrganizeId"].includes(c.name));
  return orgCookie ? orgCookie.value : null;
}

// Intercept network request untuk ambil token DAN OrganizeId dari header
async function interceptAuthData(page) {
  return new Promise((resolve) => {
    let token = null;
    let organizeId = null;

    const handler = (request) => {
      const headers = request.headers();

      if (!token && headers["authorization"] && headers["authorization"].startsWith("Bearer ")) {
        token = headers["authorization"].replace("Bearer ", "");
        console.log("Token intercepted dari network request!");
      }

      if (!organizeId && headers["organizeid"]) {
        organizeId = headers["organizeid"];
        console.log("OrganizeId intercepted dari network request:", organizeId);
      }

      if (token && organizeId) {
        page.off("request", handler);
        resolve({ token, organizeId });
      }
    };

    page.on("request", handler);

    setTimeout(() => {
      page.off("request", handler);
      resolve({ token, organizeId });
    }, 15000);
  });
}

// Fetch safety alarm data dengan axios
async function fetchSafetyAlarm(page, axios) {
  let token = await extractAuthToken(page);
  let organizeId = await extractOrganizeId(page);

  if (!token || !organizeId) {
    console.log("Token/OrganizeId tidak lengkap di localStorage/cookies, coba intercept network...");
    const authData = await interceptAuthData(page);

    if (!token) token = authData.token;
    if (!organizeId) organizeId = authData.organizeId;
  }

  if (!token) {
    throw new Error("Token tidak ditemukan di localStorage, cookies, atau network request");
  }

  console.log("Token berhasil diambil:", token.substring(0, 50) + "...");

  if (!organizeId) {
    organizeId = "61a22a23e0584dac";
    console.log("OrganizeId tidak ditemukan, gunakan fallback:", organizeId);
  } else {
    console.log("OrganizeId:", organizeId);
  }

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 60000);

  const formatTime = (date) => {
    const pad = (n) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}:${pad(date.getSeconds())}+07:00`;
  };

  const requestData = {
    page: 1,
    limit: 10,
    start_time: formatTime(startTime),
    end_time: formatTime(endTime),
  };

  console.log("Request data:", requestData);

  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en",
    Authorization: `Bearer ${token}`,
    Connection: "keep-alive",
    "Content-Type": "application/json;charset=UTF-8",
    DNT: "1",
    OrganizeId: organizeId,
    Origin: "https://ds.tgtrack.com",
    Referer: "https://ds.tgtrack.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    TimeZone: "+07:00",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "X-Api-Version": "1.0.4",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };

  try {
    const response = await axios.post("https://ds.tgtrack.com/api/jtt808/alarm/safety", requestData, { headers });
    return response.data;
  } catch (error) {
    console.error("Error fetching safety alarm:", error.response?.data || error.message);
    throw error;
  }
}

// Fetch files untuk alarm tertentu - polling sampai dapat 5 files
async function fetchAlarmFiles(axios, token, organizeId, alarmKey, targetFileCount = 5, maxWaitTime = 120000) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en",
    Authorization: `Bearer ${token}`,
    Connection: "keep-alive",
    DNT: "1",
    OrganizeId: organizeId,
    Referer: "https://ds.tgtrack.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    TimeZone: "+07:00",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "X-Api-Version": "1.0.4",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };

  const startTime = Date.now();
  let retryCount = 0;

  while (Date.now() - startTime < maxWaitTime) {
    try {
      retryCount++;
      const timestamp = Date.now();
      const url = `https://ds.tgtrack.com/api/open/safety/alarm/file?organize_id=${organizeId}&alarm_key=${alarmKey}&_t=${timestamp}`;

      const response = await axios.get(url, { headers });

      if (response.data.code === 0 && response.data.result && response.data.result.length > 0) {
        const fileCount = response.data.result.length;

        if (fileCount >= targetFileCount) {
          console.log(
            `  ✓ File lengkap (${fileCount}/${targetFileCount}) untuk alarm_key ${alarmKey} setelah ${retryCount} retry`
          );
          return response.data.result;
        } else {
          console.log(
            `  ⏳ Retry ${retryCount} - File baru ${fileCount}/${targetFileCount} untuk alarm_key ${alarmKey}, tunggu lagi...`
          );
          await sleep(3000);
        }
      } else {
        console.log(`  ⏳ Retry ${retryCount} - File belum tersedia untuk alarm_key ${alarmKey}`);
        await sleep(3000);
      }
    } catch (error) {
      console.error(
        `  ✗ Error retry ${retryCount} untuk alarm_key ${alarmKey}:`,
        error.response?.data || error.message
      );
      await sleep(3000);
    }
  }

  console.log(`  ⚠ Timeout setelah ${Math.floor(maxWaitTime / 1000)}s, file tidak lengkap untuk alarm_key ${alarmKey}`);
  return [];
}

module.exports = {
  sleep,
  waitForTargetUrl,
  isLoggedIn,
  extractAuthToken,
  extractOrganizeId,
  interceptAuthData,
  fetchSafetyAlarm,
  fetchAlarmFiles,
};
