const mammoth = require("mammoth");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OCR_MIN_TEXT_LENGTH = 200;
const OCR_MAX_PAGES = 10;

async function ocrPdfBuffer(buffer, filename) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.log("GEMINI_API_KEY not set, falling back to tesseract OCR");
    return ocrPdfBufferTesseract(buffer, filename);
  }

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
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)/)?.[1] || "0", 10);
        const numB = parseInt(b.match(/(\d+)/)?.[1] || "0", 10);
        return numA - numB;
      })
      .slice(0, OCR_MAX_PAGES);

    if (imageFiles.length === 0) {
      console.log(`Gemini OCR: no page images generated for "${filename}"`);
      return "";
    }

    console.log(`Gemini OCR: processing ${imageFiles.length} pages for "${filename}"`);

    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });

    let fullText = "";
    const batchSize = 5;
    for (let i = 0; i < imageFiles.length; i += batchSize) {
      const batch = imageFiles.slice(i, i + batchSize);
      const imageParts = batch.map(imgFile => {
        const imgPath = path.join(tmpDir, imgFile);
        const imgData = fs.readFileSync(imgPath);
        return {
          inlineData: {
            data: imgData.toString("base64"),
            mimeType: "image/png"
          }
        };
      });

      const prompt = batch.length > 1
        ? `Extract ALL text from these ${batch.length} document page images. Return the complete text content exactly as it appears, preserving the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase — output the raw text only, with no commentary.`
        : "Extract ALL text from this document page image. Return the complete text content exactly as it appears, preserving the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase — output the raw text only, with no commentary.";

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      const pageText = response.text();
      fullText += pageText + "\n";
    }

    const geminiWordCount = fullText.trim().split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
    console.log(`Gemini OCR complete: extracted ${fullText.trim().length} chars / ${geminiWordCount} words from ${imageFiles.length} pages`);

    if (geminiWordCount < 5) {
      console.log("Gemini OCR returned very little text, falling back to tesseract...");
      try {
        const tesseractText = await ocrPdfBufferTesseract(buffer, filename);
        if (tesseractText.length > fullText.trim().length) {
          return tesseractText;
        }
      } catch (fallbackErr) {
        console.error("Tesseract fallback after Gemini quality check failed:", fallbackErr.message);
      }
    }

    return fullText.trim();
  } catch (geminiErr) {
    console.error("Gemini OCR error:", geminiErr.message);
    console.log("Falling back to tesseract OCR...");
    try {
      return await ocrPdfBufferTesseract(buffer, filename);
    } catch (fallbackErr) {
      console.error("Tesseract fallback also failed:", fallbackErr.message);
      return "";
    }
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

async function ocrPdfBufferTesseract(buffer, filename) {
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
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)/)?.[1] || "0", 10);
        const numB = parseInt(b.match(/(\d+)/)?.[1] || "0", 10);
        return numA - numB;
      })
      .slice(0, OCR_MAX_PAGES);

    if (imageFiles.length === 0) {
      console.log(`Tesseract OCR: no page images generated for "${filename}"`);
      return "";
    }

    console.log(`Tesseract OCR fallback: processing ${imageFiles.length} pages for "${filename}"`);

    const Tesseract = require("tesseract.js");
    const worker = await Tesseract.createWorker("eng");

    let fullText = "";
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tmpDir, imgFile);
      const { data: { text } } = await worker.recognize(imgPath);
      fullText += text + "\n";
    }

    await worker.terminate();
    console.log(`Tesseract OCR complete: extracted ${fullText.trim().length} chars from ${imageFiles.length} pages`);
    return fullText.trim();
  } finally {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch (cleanupErr) {
      console.error("Tesseract OCR temp cleanup error:", cleanupErr.message);
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
