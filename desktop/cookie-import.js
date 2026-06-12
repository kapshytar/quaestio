const { session } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Пути к базам данных куки для разных браузеров
const COOKIE_PATHS = {
  chrome: path.join(
    process.env.LOCALAPPDATA,
    'Google/Chrome/User Data/Default/Network/Cookies'
  ),
  edge: path.join(
    process.env.LOCALAPPDATA,
    'Microsoft/Edge/User Data/Default/Network/Cookies'
  )
};

// Домены, которые нас интересуют
const DOMAINS = [
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'x.com'
];

// Функция для извлечения кукис из Chrome/Edge
async function extractCookiesFromBrowser() {
  console.log('🔍 Searching for browser cookies...');
  
  let cookieDbPath = null;
  
  // Определяем, какой браузер доступен
  if (fs.existsSync(COOKIE_PATHS.chrome)) {
    cookieDbPath = COOKIE_PATHS.chrome;
    console.log('✓ Found Chrome cookies');
  } else if (fs.existsSync(COOKIE_PATHS.edge)) {
    cookieDbPath = COOKIE_PATHS.edge;
    console.log('✓ Found Edge cookies');
  } else {
    console.error('✗ No supported browser found');
    return null;
  }

  // Копируем базу данных во временную директорию
  // (браузер блокирует прямой доступ)
  const tempDbPath = path.join(process.env.TEMP, 'cookies_temp.db');
  
  try {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
    fs.copyFileSync(cookieDbPath, tempDbPath);
  } catch (err) {
    console.error('✗ Failed to copy cookie database:', err.message);
    console.log('⚠️  Close your browser and try again');
    return null;
  }

  // Используем sqlite3 для чтения кукис
  const sqlite3 = require('better-sqlite3');
  const db = sqlite3(tempDbPath, { readonly: true });

  const cookies = {};
  
  DOMAINS.forEach(domain => {
    try {
      const rows = db.prepare(`
        SELECT name, value, host_key, path, expires_utc, is_secure, is_httponly
        FROM cookies
        WHERE host_key LIKE ?
      `).all(`%${domain}%`);
      
      if (rows.length > 0) {
        cookies[domain] = rows;
        console.log(`✓ Found ${rows.length} cookies for ${domain}`);
      }
    } catch (err) {
      console.error(`✗ Error reading cookies for ${domain}:`, err.message);
    }
  });

  db.close();
  
  // Удаляем временную базу
  try {
    fs.unlinkSync(tempDbPath);
  } catch (err) {
    // Игнорируем ошибки удаления
  }

  return cookies;
}

// Функция для импорта кукис в WebView
async function importCookiesToWebView(cookies) {
  if (!cookies) {
    console.log('⚠️  No cookies to import');
    return;
  }

  const partitions = {
    'chat.openai.com': 'persist:chatgpt',
    'claude.ai': 'persist:claude',
    'gemini.google.com': 'persist:gemini',
    'x.com': 'persist:grok'
  };

  for (const [domain, cookieList] of Object.entries(cookies)) {
    const partition = partitions[domain];
    if (!partition) continue;

    const ses = session.fromPartition(partition);
    
    console.log(`📥 Importing cookies for ${domain}...`);
    
    for (const cookie of cookieList) {
      try {
        const cookieDetails = {
          url: `https://${cookie.host_key}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.host_key,
          path: cookie.path || '/',
          secure: cookie.is_secure === 1,
          httpOnly: cookie.is_httponly === 1,
          expirationDate: cookie.expires_utc ? cookie.expires_utc / 1000000 - 11644473600 : undefined
        };

        await ses.cookies.set(cookieDetails);
      } catch (err) {
        // Игнорируем ошибки отдельных кукис
      }
    }
    
    console.log(`✓ Imported cookies for ${domain}`);
  }
  
  console.log('✅ Cookie import completed!');
}

module.exports = {
  extractCookiesFromBrowser,
  importCookiesToWebView
};
