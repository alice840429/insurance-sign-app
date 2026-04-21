import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(dataDir, 'uploads');
const outputDir = path.join(dataDir, 'output');
const casesFile = path.join(dataDir, 'cases.json');

for (const dir of [dataDir, uploadsDir, outputDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(casesFile)) {
  fs.writeFileSync(casesFile, JSON.stringify({}, null, 2), 'utf8');
}

const templatePages = [
  { file: 'assets/pdpa.jpg', title: '個資法同意書' },
  { file: 'assets/analysis-1.jpg', title: '書面分析評估暨業務員報告書（第 1 頁）' },
  { file: 'assets/analysis-2.jpg', title: '書面分析評估暨業務員報告書（第 2 頁）' },
  { file: 'assets/solicitation.jpg', title: '瞭解要保人需求及適合度分析評估暨招攬人員報告書' }
];

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/files', express.static(dataDir));
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage });

function loadCases() {
  return JSON.parse(fs.readFileSync(casesFile, 'utf8'));
}

function saveCases(data) {
  fs.writeFileSync(casesFile, JSON.stringify(data, null, 2), 'utf8');
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function resolvePagePath(relativeFile) {
  if (relativeFile.startsWith('assets/')) {
    return path.join(publicDir, relativeFile);
  }
  return path.join(dataDir, relativeFile);
}

function getImageBytesAndType(filePath) {
  const bytes = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return {
    bytes,
    isPng: ext === '.png'
  };
}

// 以你提供的 JPG 尺寸為基準：1448 x 2048
// 以下座標都用「左上角」為原點
function drawTextTop(page, text, x, yTop, font, size = 22, color = rgb(0.1, 0.1, 0.1)) {
  if (!text) return;
  const y = page.getHeight() - yTop - size;
  page.drawText(String(text), { x, y, size, font, color });
}

function drawImageTop(page, image, x, yTop, width, height) {
  if (!image) return;
  const y = page.getHeight() - yTop - height;
  page.drawImage(image, { x, y, width, height });
}

function getTodayParts() {
  const now = new Date();
  return {
    y: String(now.getFullYear() - 1911), // 民國年
    m: String(now.getMonth() + 1),
    d: String(now.getDate())
  };
}

function birthText(data = {}) {
  const y = data.birthY || '';
  const m = data.birthM || '';
  const d = data.birthD || '';
  if (!y && !m && !d) return '';
  return `${y}/${m}/${d}`;
}

function stampTemplatePage({
  page,
  pageInfo,
  font,
  signerName,
  applicant,
  insured,
  applicantSignImage,
  insuredSignImage
}) {
  const today = getTodayParts();
  const file = pageInfo.file;

  const applicantName = signerName || '';
  const insuredName = insured?.sameAsApplicant ? applicantName : (insured?.name || '');

  // 1. 個資法同意書
  if (file === 'assets/pdpa.jpg') {
    // 要保人簽名
    drawImageTop(page, applicantSignImage, 285, 1540, 220, 60);
    // 被保人簽名
    drawImageTop(page, insuredSignImage, 925, 1540, 220, 60);

    // 身分證號
    drawTextTop(page, applicant?.idno || '', 290, 1618, font, 24);
    drawTextTop(page, insured?.idno || '', 965, 1618, font, 24);

    // 日期（民國年 / 月 / 日）
    drawTextTop(page, today.y, 275, 1864, font, 24);
    drawTextTop(page, today.m, 940, 1864, font, 24);
    drawTextTop(page, today.d, 1195, 1864, font, 24);

    return;
  }

  // 2. 書面分析報告書（第 1 頁）
  if (file === 'assets/analysis-1.jpg') {
    // 姓名
    drawTextTop(page, applicantName, 320, 392, font, 24);
    drawTextTop(page, insuredName, 985, 392, font, 24);

    // 生日
    drawTextTop(page, birthText(applicant), 320, 510, font, 24);
    drawTextTop(page, birthText(insured), 985, 510, font, 24);

    // 身分證字號/統編
    drawTextTop(page, applicant?.idno || '', 320, 628, font, 24);
    drawTextTop(page, insured?.idno || '', 985, 628, font, 24);

    return;
  }

  // 3. 書面分析報告書（第 2 頁）
  if (file === 'assets/analysis-2.jpg') {
    // 要保人簽名
    drawImageTop(page, applicantSignImage, 235, 1378, 240, 64);
    // 被保人簽名
    drawImageTop(page, insuredSignImage, 875, 1378, 240, 64);

    // 日期（民國年 / 月 / 日）
    drawTextTop(page, today.y, 285, 1890, font, 24);
    drawTextTop(page, today.m, 925, 1890, font, 24);
    drawTextTop(page, today.d, 1220, 1890, font, 24);

    return;
  }

  // 4. 招攬報告書
  if (file === 'assets/solicitation.jpg') {
    // 上方姓名線
    drawTextTop(page, applicantName, 305, 155, font, 24);
    drawTextTop(page, insuredName, 915, 155, font, 24);

    // 下方簽名區（依你要求先放指定位置）
    drawImageTop(page, applicantSignImage, 250, 1812, 210, 56);
    drawImageTop(page, insuredSignImage, 930, 1812, 210, 56);

    // 日期（民國年 / 月 / 日）
    drawTextTop(page, today.y, 315, 1965, font, 24);
    drawTextTop(page, today.m, 685, 1965, font, 24);
    drawTextTop(page, today.d, 1205, 1965, font, 24);

    return;
  }

  // 其他上傳文件：暫時不自動蓋
}

app.post('/api/cases', upload.array('uploadedForms', 20), (req, res) => {
  const caseId = uuidv4();

  const files = (req.files || []).map(file => ({
    fileName: file.filename,
    originalName: file.originalname,
    relativeUrl: `uploads/${file.filename}`,
    title: file.originalname
  }));

  const pages = [
    ...templatePages.map(p => ({ ...p, isTemplate: true })),
    ...files.map(f => ({ file: f.relativeUrl, title: f.title, isTemplate: false }))
  ];

  const cases = loadCases();
  cases[caseId] = {
    id: caseId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    pages,
    signData: null,
    signerName: '',
    pdfPath: null
  };
  saveCases(cases);

  const base = getBaseUrl(req);
  res.json({
    ok: true,
    caseId,
    signerUrl: `${base}/signer.html?case=${caseId}`,
    downloadUrl: `${base}/api/cases/${caseId}/download`
  });
});
app.get('/api/cases/:id', (req, res) => {
  const cases = loadCases();
  const item = cases[req.params.id];
  if (!item) {
    return res.status(404).json({ ok: false, message: '找不到案件' });
  }

  res.json({
    ok: true,
    caseId: item.id,
    status: item.status,
    documents: item.pages.map((p, index) => ({
      index,
      title: p.title,
      imageUrl: p.isTemplate ? `/${p.file}` : `/files/${p.file}`
    }))
  });
});
app.post('/api/cases/:id/sign', async (req, res) => {
  try {
    const caseId = req.params.id;
    const cases = loadCases();
    const item = cases[caseId];

    if (!item) {
      return res.status(404).json({ ok: false, message: '案件不存在' });
    }

    const payload = req.body || {};
    const signerName = payload.signerName || '';
    const applicant = payload.applicant || {};
    const insured = payload.insured || {};

    if (!signerName.trim()) {
      return res.status(400).json({ ok: false, message: '請填寫簽署人姓名' });
    }
    if (!applicant.signature) {
      return res.status(400).json({ ok: false, message: '缺少要保人簽名' });
    }
    if (!insured.signature) {
      return res.status(400).json({ ok: false, message: '缺少被保人簽名' });
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const applicantSignBase64 = applicant.signature.split(',')[1];
    const insuredSignBase64 = insured.signature.split(',')[1];

    const applicantSignImage = applicant.signature.includes('image/png')
      ? await pdfDoc.embedPng(Buffer.from(applicantSignBase64, 'base64'))
      : await pdfDoc.embedJpg(Buffer.from(applicantSignBase64, 'base64'));

    const insuredSignImage = insured.signature.includes('image/png')
      ? await pdfDoc.embedPng(Buffer.from(insuredSignBase64, 'base64'))
      : await pdfDoc.embedJpg(Buffer.from(insuredSignBase64, 'base64'));

    for (const pageInfo of item.pages) {
      const imgPath = resolvePagePath(pageInfo.file);
      if (!fs.existsSync(imgPath)) continue;

      const { bytes, isPng } = getImageBytesAndType(imgPath);
      const bgImage = isPng
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      const { width, height } = bgImage.scale(1);
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(bgImage, { x: 0, y: 0, width, height });

      stampTemplatePage({
        page,
        pageInfo,
        font,
        signerName,
        applicant,
        insured,
        applicantSignImage,
        insuredSignImage
      });
    }

    const pdfBytes = await pdfDoc.save();
    const pdfName = `${caseId}.pdf`;
    const pdfPath = path.join(outputDir, pdfName);
    fs.writeFileSync(pdfPath, pdfBytes);

    item.status = 'signed';
    item.signerName = signerName;
    item.signData = {
      applicant,
      insured
    };
    item.pdfPath = `output/${pdfName}`;
    saveCases(cases);

    const downloadUrl = `${getBaseUrl(req)}/api/cases/${caseId}/download`;

    return res.json({
      ok: true,
      message: '簽署完成',
      downloadUrl
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: '簽署失敗' });
  }
});

app.get('/api/cases/:id/download', (req, res) => {
  const cases = loadCases();
  const item = cases[req.params.id];

  if (!item || !item.pdfPath) {
    return res.status(404).send('PDF 尚未產生');
  }

  const filePath = path.join(dataDir, item.pdfPath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('檔案不存在');
  }

  res.download(filePath, `signed-${req.params.id}.pdf`);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
