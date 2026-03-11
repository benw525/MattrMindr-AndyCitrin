const mammoth = require("mammoth");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OCR_MIN_TEXT_LENGTH = 200;
const OCR_MAX_PAGES = 10;

async function ocrPdfBuffer(buffer, filename) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  try {
    const imgPrefix = path.join(tmpDir, "page");
    await new Promise((resolve, reject) => {
      execFile("pdftoppm", [
        "-png", "-r", "300",
        "-l", String(OCR_MAX_PAGES),
        pdfPath, imgPrefix
      ], { timeout: 60000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const imageFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith("page") && f.endsWith(".png"))
      .sort()
      .slice(0, OCR_MAX_PAGES);

    if (imageFiles.length === 0) {
      console.log(`OCR: no page images generated for "${filename}"`);
      return "";
    }

    console.log(`OCR fallback: processing ${imageFiles.length} pages for "${filename}"`);

    const Tesseract = require("tesseract.js");
    const worker = await Tesseract.createWorker("eng");

    let fullText = "";
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tmpDir, imgFile);
      const { data: { text } } = await worker.recognize(imgPath);
      fullText += text + "\n";
    }

    await worker.terminate();
    console.log(`OCR complete: extracted ${fullText.trim().length} chars from ${imageFiles.length} pages`);
    return fullText.trim();
  } finally {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch (cleanupErr) {
      console.error("OCR temp cleanup error:", cleanupErr.message);
    }
  }
}

async function extractText(buffer, contentType, filename) {
  if (contentType === "text/plain") {
    return buffer.toString("utf-8");
  }
  if (contentType === "application/msword" || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }
  if (contentType === "application/pdf") {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    const text = (data.text || "").trim();

    const wordCount = text.split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
    const hasUsefulText = text.length >= OCR_MIN_TEXT_LENGTH && wordCount >= 20;

    if (hasUsefulText) {
      return text;
    }

    console.log(`PDF text extraction yielded ${text.length} chars / ${wordCount} words for "${filename}", attempting OCR...`);
    try {
      const ocrText = await ocrPdfBuffer(buffer, filename);
      if (ocrText.length > text.length) {
        return ocrText;
      }
    } catch (ocrErr) {
      console.error("OCR fallback error:", ocrErr.message);
    }
    return text;
  }
  return "";
}

module.exports = { extractText };
