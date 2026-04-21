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
if (!fs.existsSync(casesFile)) fs.writeFileSync(casesFile, JSON.stringify({}, null, 2));

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
  fs.writeFileSync(casesFile, JSON.stringify(data, null, 2));
}
function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
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
    signatures: null,
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
  if (!item) return res.status(404).json({ ok: false, message: '找不到案件' });
  res.json({
    ok: true,
    caseId: item.id,
    status: item.status,
    pages: item.pages.map((p, index) => ({
      index,
      title: p.title,
      imageUrl: `/files/${p.file}`
    }))
  });
});

app.post('/api/cases/:id/sign', async (req, res) => {
  try {
    const caseId = req.params.id;
    const caseFile = path.join(dataDir, `${caseId}.json`);

    if (!fs.existsSync(caseFile)) {
      return res.status(404).json({ ok: false, message: '案件不存在' });
    }

    const caseData = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
    const payload = req.body || {};

    caseData.signed = true;
    caseData.signerName = payload.signerName || '';

    caseData.signData = {
      applicant: payload.applicant || {},
      insured: payload.insured || {}
    };

    fs.writeFileSync(caseFile, JSON.stringify(caseData, null, 2), 'utf8');

    const downloadUrl = `/api/cases/${caseId}/download`;

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
        if (signerName) {
          page.drawText(signerName, {
            x: 48,
            y: 52,
            size: 14,
            font,
            color: rgb(0.15, 0.15, 0.15)
          });
        }
        page.drawText(new Date().toLocaleString('zh-TW', { hour12: false }), {
          x: 48,
          y: 34,
          size: 10,
          font,
          color: rgb(0.35, 0.35, 0.35)
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfName = `${req.params.id}.pdf`;
    const pdfPath = path.join(outputDir, pdfName);
    fs.writeFileSync(pdfPath, pdfBytes);

    item.status = 'signed';
    item.signatures = signatures.map((_, idx) => ({ page: idx, signedAt: new Date().toISOString() }));
    item.signerName = signerName;
    item.pdfPath = `output/${pdfName}`;
    saveCases(cases);

    res.json({ ok: true, downloadUrl: `${getBaseUrl(req)}/api/cases/${req.params.id}/download` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, message: '產生 PDF 失敗' });
  }
});

app.get('/api/cases/:id/download', (req, res) => {
  const cases = loadCases();
  const item = cases[req.params.id];
  if (!item || !item.pdfPath) {
    return res.status(404).send('PDF 尚未產生');
  }
  const filePath = path.join(dataDir, item.pdfPath);
  if (!fs.existsSync(filePath)) return res.status(404).send('檔案不存在');
  res.download(filePath, `signed-${req.params.id}.pdf`);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
