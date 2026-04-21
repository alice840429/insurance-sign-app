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
  // template: assets/xxx.jpg -> public/assets/xxx.jpg
  if (relativeFile.startsWith('assets/')) {
    return path.join(publicDir, relativeFile);
  }
  // upload: uploads/xxx.jpg -> data/uploads/xxx.jpg
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

function birthText(data = {}) {
  const y = data.birthY || '';
  const m = data.birthM || '';
  const d = data.birthD || '';
  if (!y && !m && !d) return '';
  return `${y}/${m}/${d}`;
}

// 簽名與文字的通用蓋章位置
// 先做成可用版：每頁自動帶入同一組資料與簽名
function drawStampBlock(page, font, pageWidth, applicant, insured) {
  const marginX = 48;
  const bottomY = 34;

  const applicantIdno = applicant?.idno || '';
  const applicantBirth = birthText(applicant);
  const insuredIdno = insured?.idno || '';
  const insuredBirth = birthText(insured);

  page.drawText(`要保人身分證：${applicantIdno}`, {
    x: marginX,
    y: bottomY + 34,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(`要保人生日：${applicantBirth}`, {
    x: marginX,
    y: bottomY + 20,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(`被保人身分證：${insuredIdno}`, {
    x: marginX + 220,
    y: bottomY + 34,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(`被保人生日：${insuredBirth}`, {
    x: marginX + 220,
    y: bottomY + 20,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(new Date().toLocaleString('zh-TW', { hour12: false }), {
    x: marginX,
    y: bottomY,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35)
  });

  // applicant sign
  if (applicant?.signature) {
    page.drawImage(applicant.signature, {
      x: pageWidth - 250,
      y: 28,
      width: 90,
      height: 36
    });
  }

  // insured sign
  if (insured?.signature) {
    page.drawImage(insured.signature, {
      x: pageWidth - 140,
      y: 28,
      width: 90,
      height: 36
    });
  }
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
      imageUrl: `/files/${p.file}`
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

      drawStampBlock(
        page,
        font,
        width,
        {
          ...applicant,
          signature: applicantSignImage
        },
        {
          ...insured,
          signature: insuredSignImage
        }
      );

      if (signerName) {
        page.drawText(`簽署人：${signerName}`, {
          x: 48,
          y: height - 24,
          size: 10,
          font,
          color: rgb(0.15, 0.15, 0.15)
        });
      }
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
