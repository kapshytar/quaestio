const { session } = require('electron');
const fs = require('fs');
const path = require('path');

// Функция импорта кукис из JSON файла
async function importCookiesFromJSON(jsonPath) {
  console.log('📥 Importing cookies from:', jsonPath);
  
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ File not found:', jsonPath);
    return false;
  }

  let cookiesData;
  try {
    console.log('📖 Reading file...');
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    console.log('📄 File size:', fileContent.length, 'bytes');
    console.log('📄 First 200 chars:', fileContent.substring(0, 200));
    
    console.log('🔍 Parsing JSON...');
    cookiesData = JSON.parse(fileContent);
    console.log('✓ JSON parsed successfully');
    console.log('📦 Type:', Array.isArray(cookiesData) ? 'Array' : typeof cookiesData);
    console.log('📦 Items count:', Array.isArray(cookiesData) ? cookiesData.length : 'N/A');
  } catch (err) {
    console.error('❌ Failed to parse JSON:', err.message);
    console.error('❌ Error stack:', err.stack);
    return false;
  }

  // All 4 slot partitions — cookies are imported into ALL slots
  // since any slot can be any service
  const ALL_PARTITIONS = ['persist:shared'];

  // Known domains — import into all slots
  const knownDomains = [
    'openai.com', 'chatgpt.com',
    'claude.ai', 'anthropic.com',
    'google.com', 'googleapis.com', 'gstatic.com', 'doubleclick.net',
    'gemini.google.com', 'aistudio.google.com',
    'x.com', 'twitter.com', 'grok.com',
    'deepseek.com',
    'perplexity.ai'
  ];

  let imported = 0;
  let errors = 0;

  // Обрабатываем массив кукис
  const cookies = Array.isArray(cookiesData) ? cookiesData : [cookiesData];

  for (const cookie of cookies) {
    try {
      // Check if cookie belongs to a known domain
      const cookieDomain = cookie.domain || cookie.host_key || '';

      console.log('Processing cookie:', cookie.name, 'for domain:', cookieDomain);

      const isKnown = knownDomains.some(d => cookieDomain.includes(d));
      if (!isKnown) {
        console.log('  -> Skipped (unknown domain)');
        continue;
      }

      // Import into ALL slot partitions
      const targetPartitions = ALL_PARTITIONS;
      console.log('  -> Importing to all slots');

      // Формируем объект куки для Electron
      const cookieDetails = {
        url: cookie.url || `https://${cookie.domain.replace(/^\./, '')}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure !== undefined ? cookie.secure : true,
        httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : false
      };

      // Добавляем sameSite если есть и не null
      if (cookie.sameSite && cookie.sameSite !== null) {
        const sameSiteMap = {
          'no_restriction': 'no_restriction',
          'none': 'no_restriction',
          'unspecified': 'no_restriction',
          'lax': 'lax',
          'strict': 'strict'
        };
        cookieDetails.sameSite = sameSiteMap[cookie.sameSite] || 'no_restriction';
      } else {
        cookieDetails.sameSite = 'no_restriction';
      }

      // Добавляем expiration если есть
      if (cookie.expirationDate) {
        cookieDetails.expirationDate = cookie.expirationDate;
      } else if (cookie.expires) {
        cookieDetails.expirationDate = cookie.expires;
      }

      // Импортируем куку во ВСЕ целевые партиции
      for (const partition of targetPartitions) {
        try {
          const ses = session.fromPartition(partition);
          await ses.cookies.set(cookieDetails);
          console.log(`  ✓ Imported to ${partition}`);
        } catch (partErr) {
          console.error(`  ✗ Failed to import to ${partition}:`, partErr.message);
        }
      }
      
      imported++;

    } catch (err) {
      errors++;
      console.error('  ✗ Failed to import cookie:', cookie.name);
      console.error('    Error:', err.message);
    }
  }

  console.log(`✅ Import complete: ${imported} imported, ${errors} errors`);
  return imported > 0;
}

module.exports = { importCookiesFromJSON };
