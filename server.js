const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Fontları yükle
const calibriPath = path.join(__dirname, 'font', 'calibri.ttf');
const ocrPath = path.join(__dirname, 'font', 'ocr-b.otf');

if (fs.existsSync(calibriPath)) {
  GlobalFonts.registerFromPath(calibriPath, 'Calibri');
}
if (fs.existsSync(ocrPath)) {
  GlobalFonts.registerFromPath(ocrPath, 'OCR-B');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Statik frontend dosyalarını sun
app.use(express.static(path.join(__dirname)));

// Sağlık kontrolü
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0',
    engine: 'Napi-Canvas',
    message: 'API aktif ve hazir!'
  });
});

// Türkçe karakterleri MRZ için dönüştürme
function latinize(str) {
  if (!str) return '';
  return str.toString()
    .replace(/Ğ/gim, 'G').replace(/Ü/gim, 'U').replace(/Ş/gim, 'S')
    .replace(/İ/gim, 'I').replace(/Ö/gim, 'O').replace(/Ç/gim, 'C')
    .replace(/ğ/gim, 'g').replace(/ü/gim, 'u').replace(/ş/gim, 's')
    .replace(/ı/gim, 'i').replace(/ö/gim, 'o').replace(/ç/gim, 'c');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  // YYYY-MM-DD ise DD.MM.YYYY yap
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
}

// Görseli al (URL, base64, buffer)
async function fetchImageBuffer(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') {
    if (input.startsWith('data:image')) {
      const base64Data = input.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const resp = await axios.get(input, { responseType: 'arraybuffer', timeout: 8000 });
      return Buffer.from(resp.data);
    }
  }
  return null;
}

// Kimlik Kartı Çizme Motoru
async function generateIdCards(data) {
  const frontBg = await loadImage(path.join(__dirname, 'img', 'front.png'));
  const backBg = await loadImage(path.join(__dirname, 'img', 'back.png'));

  // 1. ÖN YÜZ (1200 x 700)
  const frontCanvas = createCanvas(1200, 700);
  const fCtx = frontCanvas.getContext('2d');
  fCtx.drawImage(frontBg, 0, 0, 1200, 700);

  // Fotoğraf çizimi
  const photoBuf = await fetchImageBuffer(data.image);
  if (photoBuf) {
    try {
      const photoImg = await loadImage(photoBuf);

      // Sol büyük fotoğraf (grayscale)
      fCtx.save();
      fCtx.filter = 'grayscale(100%)';
      // 300px genişlik, oranlı yükseklik
      const pWidth = 300;
      const pHeight = Math.round((photoImg.height / photoImg.width) * pWidth);
      // bottom: 70px -> y = 700 - 70 - pHeight
      const pY = Math.max(160, 700 - 70 - pHeight);
      fCtx.drawImage(photoImg, 50, pY, pWidth, pHeight);
      fCtx.restore();

      // Sağ küçük şeffaf fotoğraf
      fCtx.save();
      fCtx.globalAlpha = 0.15;
      fCtx.filter = 'grayscale(100%) brightness(110%)';
      const sWidth = 100;
      const sHeight = Math.round((photoImg.height / photoImg.width) * sWidth);
      const sY = Math.max(300, 700 - 190 - sHeight);
      fCtx.drawImage(photoImg, 1015, sY, sWidth, sHeight);
      fCtx.restore();
    } catch (err) {
      console.warn('Fotoğraf işlenirken hata oluştu:', err.message);
    }
  }

  // Ön Yüz Metinleri
  fCtx.fillStyle = '#111';
  fCtx.textBaseline = 'top';

  fCtx.font = '500 47px Calibri, Arial, sans-serif';
  fCtx.fillText(data.tckn || '', 70, 160);

  fCtx.font = '500 44px Calibri, Arial, sans-serif';
  fCtx.fillText(data.surname || '', 410, 280);
  fCtx.fillText(data.name || '', 410, 360);
  fCtx.fillText(data.birth_date || '', 409, 445);
  fCtx.fillText(data.gender || '', 730, 445);
  fCtx.fillText(data.document_number || '', 408, 529);
  fCtx.fillText(data.valid_until || '', 407, 610);

  // 2. ARKA YÜZ (1200 x 700)
  const backCanvas = createCanvas(1200, 700);
  const bCtx = backCanvas.getContext('2d');
  bCtx.drawImage(backBg, 0, 0, 1200, 700);

  bCtx.fillStyle = '#111';
  bCtx.textBaseline = 'top';

  bCtx.font = '500 44px Calibri, Arial, sans-serif';
  bCtx.fillText(data.mother_name || '', 375, 165);
  bCtx.fillText(data.father_name || '', 375, 250);

  // MRZ Hesaplama ve Çizim
  const docNum = (data.document_number || '').toUpperCase();
  const tckn = data.tckn || '';
  const bDate = data.birth_date || '';
  const vDate = data.valid_until || '';
  const genderCode = (data.gender && data.gender.includes('/')) ? data.gender.split('/')[1].trim() : 'M';

  // Tarihleri MRZ formatına çevir (YYMMDD)
  const bParts = bDate.split('.');
  const nShort = bParts.length === 3 ? (bParts[2].slice(-2) + bParts[1] + bParts[0]) : '000101';

  const vParts = vDate.split('.');
  const lShort = vParts.length === 3 ? (vParts[2].slice(-2) + vParts[1] + vParts[0]) : '300101';

  const line1 = `I<TUR${docNum}2<${tckn}<<<`;
  const line2 = `${nShort}1${genderCode}${lShort}2TUR<<<<<<<<<<<2`;

  const cleanName = latinize(data.name || '').toUpperCase();
  const cleanSurname = latinize(data.surname || '').toUpperCase();
  const totalChars = cleanName.length + cleanSurname.length;
  const padding = totalChars < 28 ? '<'.repeat(28 - totalChars) : '';
  const line3 = `${cleanSurname}<<${cleanName}${padding}`;

  bCtx.font = '47px "OCR-B", monospace';
  bCtx.fillText(line1, 85, 450);
  bCtx.fillText(line2, 85, 515);
  bCtx.fillText(line3, 85, 580);

  return {
    frontBuffer: frontCanvas.toBuffer('image/png'),
    backBuffer: backCanvas.toBuffer('image/png')
  };
}

// Ana API Endpoint: Hem GET hem POST destekler!
async function handleGenerate(req, res) {
  try {
    // Hem query paramdan hem body'den oku
    const params = { ...req.query, ...req.body };

    // Dosya upload edilmişse
    let imageInput = null;
    if (req.file) {
      imageInput = req.file.buffer;
    } else if (params.image) {
      imageInput = params.image;
    }

    const data = {
      name: params.name || '',
      surname: params.surname || '',
      birth_date: formatDate(params.birth_date),
      gender: params.gender || 'E / M',
      tckn: params.tckn || '',
      document_number: params.document_number || '',
      valid_until: formatDate(params.valid_until),
      mother_name: params.mother_name || '',
      father_name: params.father_name || '',
      image: imageInput
    };

    if (!data.name || !data.surname || !data.tckn) {
      return res.status(400).json({
        success: false,
        error: 'name, surname ve tckn alanlari zorunludur.',
        example: '/api/generate?name=Ahmet&surname=Yilmaz&tckn=11111111110&document_number=A12B34567&birth_date=1995-05-15&valid_until=2030-01-01&mother_name=Ayse&father_name=Ali&gender=E+/+M'
      });
    }

    const { frontBuffer, backBuffer } = await generateIdCards(data);

    // 1. Tarayıcıda doğrudan Ön Yüz PNG görmek isterse
    if (params.side === 'front') {
      res.setHeader('Content-Type', 'image/png');
      return res.send(frontBuffer);
    }
    // 2. Tarayıcıda doğrudan Arka Yüz PNG görmek isterse
    if (params.side === 'back') {
      res.setHeader('Content-Type', 'image/png');
      return res.send(backBuffer);
    }

    const frontBase64 = `data:image/png;base64,${frontBuffer.toString('base64')}`;
    const backBase64 = `data:image/png;base64,${backBuffer.toString('base64')}`;

    // 3. Tarayıcıdan direkt URL ile girilmişse ve HTML görmek istiyorsa veya Accept header text/html ise
    if (params.format === 'html' || (req.method === 'GET' && !params.format && req.headers.accept && req.headers.accept.includes('text/html'))) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Kimlik Önizleme</title>
          <style>
            body { background: #0d1117; color: #fff; font-family: sans-serif; text-align: center; padding: 20px; }
            img { max-width: 90%; width: 600px; border-radius: 12px; margin: 15px auto; display: block; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            .btn { display: inline-block; padding: 10px 20px; background: #238636; color: white; text-decoration: none; border-radius: 6px; margin: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>✅ Kimlik Kartı Başarıyla Oluşturuldu</h2>
          <h3>Ön Yüz</h3>
          <img src="${frontBase64}" alt="Ön Yüz" />
          <a class="btn" href="${frontBase64}" download="on-yuz.png">Ön Yüzü İndir</a>
          
          <h3>Arka Yüz</h3>
          <img src="${backBase64}" alt="Arka Yüz" />
          <a class="btn" href="${backBase64}" download="arka-yuz.png">Arka Yüzü İndir</a>
        </body>
        </html>
      `);
    }

    // 4. Varsayılan JSON Base64 yanıtı (Botlar ve API istemcileri için)
    return res.json({
      success: true,
      front: frontBase64,
      back: backBase64
    });

  } catch (err) {
    console.error('Olusturma hatasi:', err);
    return res.status(500).json({
      success: false,
      error: 'Kimlik olusturulurken sunucu hatasi olustu.',
      details: err.message
    });
  }
}

// GET & POST Route Tanımları
app.get('/api/generate', handleGenerate);
app.post('/api/generate', upload.single('image'), handleGenerate);

// Web fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Canvas API Aktif: http://localhost:${PORT}`);
});
