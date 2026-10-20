const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Statik dosyalar
app.use(express.static(path.join(__dirname)));

// Browser instance
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return browser;
}

// Health check - API calisiyor mu test et
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0' });
});

// Ana API endpoint
app.post('/api/generate', upload.single('image'), async (req, res) => {
  const {
    name, surname, birth_date, gender,
    tckn, document_number, valid_until,
    mother_name, father_name
  } = req.body;

  if (!name || !surname || !birth_date || !tckn || !document_number || !valid_until || !mother_name || !father_name) {
    return res.status(400).json({ success: false, error: 'Tum alanlar zorunludur.' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Fotograf (image) zorunludur.' });
  }

  const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.evaluate((data) => {
      function escapeHtml(str) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return str.replace(/[&<>"']/g, (c) => map[c]);
      }
      function dateFormat(dateStr) {
        const parts = dateStr.split('-');
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
      }
      function latinize(str) {
        return str
          .replace(/Ğ/gim,'G').replace(/Ü/gim,'U').replace(/Ş/gim,'S')
          .replace(/İ/gim,'I').replace(/Ö/gim,'O').replace(/Ç/gim,'C')
          .replace(/ğ/gim,'g').replace(/ü/gim,'u').replace(/ş/gim,'s')
          .replace(/ı/gim,'i').replace(/ö/gim,'o').replace(/ç/gim,'c');
      }

      const n = dateFormat(data.birth_date);
      const l = dateFormat(data.valid_until);

      document.querySelector('.name').innerText = data.name;
      document.querySelector('.surname').innerText = data.surname;
      document.querySelector('.birth_date').innerText = n;
      document.querySelector('.gender').innerText = data.gender;
      document.querySelector('.tckn').innerText = data.tckn;
      document.querySelector('.document_number').innerText = data.document_number;
      document.querySelector('.valid_until').innerText = l;
      document.querySelector('.mother_name').innerText = data.mother_name;
      document.querySelector('.father_name').innerText = data.father_name;

      const mrzEl = document.querySelector('.mrz');
      mrzEl.innerHTML = escapeHtml(`I<TUR${data.document_number}2<${data.tckn}<<<`) + '<br><br>';

      const nd = n.split('.');
      const ld = l.split('.');
      const nShort = nd[2].slice(-2) + nd[1] + nd[0];
      const lShort = ld[2].slice(-2) + ld[1] + ld[0];
      const genderCode = data.gender.split('/')[1].trim();
      mrzEl.innerHTML += escapeHtml(`${nShort}1${genderCode}${lShort}2TUR<<<<<<<<<<<2`) + '<br><br>';

      const nameClean = latinize(data.name).toUpperCase();
      const surnameClean = latinize(data.surname).toUpperCase();
      const total = nameClean.length + surnameClean.length;
      const padding = total < 28 ? '<'.repeat(28 - total) : '';
      mrzEl.innerHTML += escapeHtml(`${surnameClean}<<${nameClean}${padding}`) + '<br><br>';

      document.querySelector('.face').src = data.image;
      document.querySelector('.face-right').src = data.image;
    }, { name, surname, birth_date, gender, tckn, document_number, valid_until, mother_name, father_name, image: imageBase64 });

    // Fotografin yuklenmesini bekle
    await page.waitForFunction(() => {
      const img = document.querySelector('.face');
      return img && img.complete && img.naturalHeight > 0;
    }, { timeout: 10000 });

    await new Promise(r => setTimeout(r, 800));

    const frontEl = await page.$('.front');
    const frontBuffer = await frontEl.screenshot({ type: 'png' });

    const backEl = await page.$('.back');
    const backBuffer = await backEl.screenshot({ type: 'png' });

    await page.close();

    return res.json({
      success: true,
      front: `data:image/png;base64,${frontBuffer.toString('base64')}`,
      back: `data:image/png;base64,${backBuffer.toString('base64')}`
    });

  } catch (err) {
    if (page) await page.close().catch(() => {});
    browser = null;
    console.error('[API ERROR]', err.message);
    return res.status(500).json({ success: false, error: 'Kimlik olusturulamadi.', details: err.message });
  }
});

// Diger tum istekler → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu calisiyor: http://localhost:${PORT}`);
});
