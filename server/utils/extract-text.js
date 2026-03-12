const mammoth = require("mammoth");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OCR_MIN_TEXT_LENGTH = 200;
const GEMINI_MAX_BATCH_BYTES = 45 * 1024 * 1024;
const GEMINI_MAX_SINGLE_IMAGE_BYTES = 20 * 1024 * 1024;

function numericSort(a, b) {
  const numA = parseInt(a.match(/(\d+)/)?.[1] || "0", 10);
  const numB = parseInt(b.match(/(\d+)/)?.[1] || "0", 10);
  return numA - numB;
}

function cleanupTmpDir(tmpDir) {
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  } catch (cleanupErr) {
    console.error("OCR temp cleanup error:", cleanupErr.message);
  }
}

async function convertPdfToImages(pdfPath, tmpDir, dpi, maxPages) {
  const imgPrefix = path.join(tmpDir, "page");
  const args = ["-jpeg", "-r", String(dpi)];
  if (maxPages) {
    args.push("-l", String(maxPages));
  }
  args.push(pdfPath, imgPrefix);

  await new Promise((resolve, reject) => {
    execFile("pdftoppm", args, { timeout: 300000, maxBuffer: 50 * 1024 * 1024 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return fs.readdirSync(tmpDir)
    .filter(f => f.startsWith("page") && f.endsWith(".jpg"))
    .sort(numericSort);
}

async function compressImage(imgPath, targetBytes) {
  const sharp = (() => { try { return require("sharp"); } catch { return null; } })();
  if (!sharp) {
    console.warn("sharp not available, cannot compress image");
    return false;
  }

  const stats = fs.statSync(imgPath);
  if (stats.size <= targetBytes) return true;

  const tmpOut = imgPath + ".tmp.jpg";
  const steps = [
    { quality: 60 },
    { quality: 45 },
    { quality: 30 },
    { quality: 20 },
    { quality: 20, width: 2000 },
    { quality: 15, width: 1600 },
    { quality: 10, width: 1200 },
  ];

  for (const step of steps) {
    let pipeline = sharp(imgPath);
    if (step.width) pipeline = pipeline.resize({ width: step.width });
    await pipeline.jpeg({ quality: step.quality }).toFile(tmpOut);
    const newSize = fs.statSync(tmpOut).size;
    if (newSize <= targetBytes) {
      fs.renameSync(tmpOut, imgPath);
      return true;
    }
  }

  fs.renameSync(tmpOut, imgPath);
  const finalSize = fs.statSync(imgPath).size;
  if (finalSize > targetBytes) {
    console.warn(`Could not compress ${path.basename(imgPath)} below ${(targetBytes / (1024 * 1024)).toFixed(0)} MB (final: ${(finalSize / (1024 * 1024)).toFixed(1)} MB)`);
    return false;
  }
  return true;
}

function buildSizeBatches(tmpDir, imageFiles) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const imgFile of imageFiles) {
    const imgPath = path.join(tmpDir, imgFile);
    const fileSize = fs.statSync(imgPath).size;

    if (currentBatch.length > 0 && currentSize + fileSize > GEMINI_MAX_BATCH_BYTES) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(imgFile);
    currentSize += fileSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function ocrPdfDirect31(buffer, filename, geminiKey) {
  const pdfSizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
  console.log(`Gemini 3.1 direct PDF OCR: starting for "${filename}" (${pdfSizeMB} MB)`);

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

  const pdfPart = {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: "application/pdf"
    }
  };

  const prompt = "Extract ALL text from this PDF document. Return the complete text content exactly as it appears, preserving the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase — output the raw text only, with no commentary.";

  const result = await model.generateContent([prompt, pdfPart]);
  const response = await result.response;
  const fullText = response.text();

  const wordCount = fullText.trim().split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
  console.log(`Gemini 3.1 direct PDF OCR complete: extracted ${fullText.trim().length} chars / ${wordCount} words for "${filename}"`);

  if (wordCount < 5) {
    throw new Error("Gemini 3.1 returned very little text");
  }

  return fullText.trim();
}

async function ocrPdfImageBased20(buffer, filename, geminiKey) {
  const pdfSizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
  console.log(`Gemini 2.0 image-based OCR: starting for "${filename}" (${pdfSizeMB} MB)`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  try {
    let dpi = 300;
    if (buffer.length > 100 * 1024 * 1024) {
      dpi = 150;
    } else if (buffer.length > 50 * 1024 * 1024) {
      dpi = 200;
    }

    const imageFiles = await convertPdfToImages(pdfPath, tmpDir, dpi, null);

    if (imageFiles.length === 0) {
      console.log(`Gemini 2.0 OCR: no page images generated for "${filename}"`);
      return "";
    }

    console.log(`Gemini 2.0 OCR: converted ${imageFiles.length} pages at ${dpi} DPI for "${filename}"`);

    const validImageFiles = [];
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tmpDir, imgFile);
      const fileSize = fs.statSync(imgPath).size;
      if (fileSize > GEMINI_MAX_SINGLE_IMAGE_BYTES) {
        console.log(`Gemini 2.0 OCR: compressing ${imgFile} (${(fileSize / (1024 * 1024)).toFixed(1)} MB)`);
        const compressed = await compressImage(imgPath, GEMINI_MAX_SINGLE_IMAGE_BYTES);
        if (!compressed) {
          console.warn(`Gemini 2.0 OCR: skipping ${imgFile} — could not compress below size limit`);
          continue;
        }
      }
      validImageFiles.push(imgFile);
    }

    if (validImageFiles.length === 0) {
      console.log(`Gemini 2.0 OCR: all page images exceeded size limits for "${filename}"`);
      throw new Error("All page images exceeded size limits");
    }

    const batches = buildSizeBatches(tmpDir, validImageFiles);
    console.log(`Gemini 2.0 OCR: split ${validImageFiles.length} pages into ${batches.length} batch(es) for "${filename}"`);

    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let fullText = "";
    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      const imageParts = batch.map(imgFile => {
        const imgPath = path.join(tmpDir, imgFile);
        const imgData = fs.readFileSync(imgPath);
        return {
          inlineData: {
            data: imgData.toString("base64"),
            mimeType: "image/jpeg"
          }
        };
      });

      const batchTotalMB = imageParts.reduce((sum, p) => sum + Buffer.from(p.inlineData.data, "base64").length, 0) / (1024 * 1024);
      console.log(`Gemini 2.0 OCR: sending batch ${bIdx + 1}/${batches.length} (${batch.length} pages, ${batchTotalMB.toFixed(1)} MB)`);

      const prompt = batch.length > 1
        ? `Extract ALL text from these ${batch.length} document page images. Return the complete text content exactly as it appears, preserving the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase — output the raw text only, with no commentary.`
        : "Extract ALL text from this document page image. Return the complete text content exactly as it appears, preserving the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase — output the raw text only, with no commentary.";

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      const pageText = response.text();
      fullText += pageText + "\n";
    }

    const wordCount = fullText.trim().split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
    console.log(`Gemini 2.0 OCR complete: extracted ${fullText.trim().length} chars / ${wordCount} words from ${validImageFiles.length} pages`);

    if (wordCount < 5) {
      throw new Error("Gemini 2.0 returned very little text");
    }

    return fullText.trim();
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

async function ocrPdfBuffer(buffer, filename) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.log("GEMINI_API_KEY not set, falling back to tesseract OCR");
    return ocrPdfBufferTesseract(buffer, filename);
  }

  try {
    return await ocrPdfDirect31(buffer, filename, geminiKey);
  } catch (err31) {
    console.error(`Gemini 3.1 direct PDF failed for "${filename}":`, err31.message);
    console.log("Falling back to Gemini 2.0 image-based OCR...");

    try {
      return await ocrPdfImageBased20(buffer, filename, geminiKey);
    } catch (err20) {
      console.error(`Gemini 2.0 image-based OCR failed for "${filename}":`, err20.message);
      console.log("Falling back to tesseract OCR...");

      try {
        return await ocrPdfBufferTesseract(buffer, filename);
      } catch (fallbackErr) {
        console.error("Tesseract fallback also failed:", fallbackErr.message);
        return "";
      }
    }
  }
}

async function ocrPdfBufferTesseract(buffer, filename) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  try {
    const imageFiles = await convertPdfToImages(pdfPath, tmpDir, 300, 10);

    if (imageFiles.length === 0) {
      console.log(`Tesseract OCR: no page images generated for "${filename}"`);
      return "";
    }

    console.log(`Tesseract OCR fallback: processing ${imageFiles.length} pages for "${filename}"`);

    const Tesseract = require("tesseract.js");
    const worker = await Tesseract.createWorker("eng");

    let fullText = "";
    try {
      for (const imgFile of imageFiles) {
        const imgPath = path.join(tmpDir, imgFile);
        const { data: { text } } = await worker.recognize(imgPath);
        fullText += text + "\n";
      }
    } finally {
      await worker.terminate().catch(e => console.error("Tesseract worker terminate error:", e.message));
    }
    console.log(`Tesseract OCR complete: extracted ${fullText.trim().length} chars from ${imageFiles.length} pages`);
    return fullText.trim();
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

async function extractTextWithPages(buffer, contentType, filename) {
  if (contentType === "text/plain") {
    return { text: buffer.toString("utf-8"), hasPages: false };
  }
  if (contentType === "application/msword" || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || "", hasPages: false };
  }
  if (contentType === "application/pdf") {
    const pdfParse = require("pdf-parse");

    const pageTexts = [];
    const opts = {
      pagerender: function (pageData) {
        return pageData.getTextContent().then(function (textContent) {
          let lastY = null;
          let pageText = "";
          for (const item of textContent.items) {
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
              pageText += "\n";
            }
            pageText += item.str;
            lastY = item.transform[5];
          }
          pageTexts.push(pageText);
          return pageText;
        });
      }
    };

    try {
      await pdfParse(buffer, opts);
    } catch (parseErr) {
      console.error(`pdf-parse error for "${filename}":`, parseErr.message);
    }

    if (pageTexts.length > 0) {
      const totalChars = pageTexts.reduce((s, p) => s + p.trim().length, 0);
      const totalWords = pageTexts.join(" ").split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
      const charsPerPage = pageTexts.length > 0 ? totalChars / pageTexts.length : 0;

      if (totalChars >= OCR_MIN_TEXT_LENGTH && totalWords >= 20 && charsPerPage >= 100) {
        const tagged = pageTexts.map((pt, i) => `[PAGE ${i + 1}]\n${pt.trim()}`).join("\n\n");
        return { text: tagged, hasPages: true };
      }
      console.log(`pdf-parse page extraction yielded ${totalChars} chars / ${totalWords} words / ${Math.round(charsPerPage)} chars/page for "${filename}", attempting OCR with page tags...`);
    }

    const ocrResult = await ocrPdfBufferWithPages(buffer, filename);
    if (ocrResult.text.length > 0) return ocrResult;

    return { text: "", hasPages: false };
  }
  return { text: "", hasPages: false };
}

async function ocrPdfBufferWithPages(buffer, filename) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.log("GEMINI_API_KEY not set, falling back to tesseract OCR with pages");
    return ocrPdfBufferTesseractWithPages(buffer, filename);
  }

  try {
    const text = await ocrPdfDirect31WithPages(buffer, filename, geminiKey);
    return text;
  } catch (err31) {
    console.error(`Gemini 3.1 direct PDF with pages failed for "${filename}":`, err31.message);
    try {
      return await ocrPdfImageBased20WithPages(buffer, filename, geminiKey);
    } catch (err20) {
      console.error(`Gemini 2.0 image-based OCR with pages failed for "${filename}":`, err20.message);
      try {
        return await ocrPdfBufferTesseractWithPages(buffer, filename);
      } catch (fallbackErr) {
        console.error("Tesseract fallback also failed:", fallbackErr.message);
        return { text: "", hasPages: false };
      }
    }
  }
}

async function ocrPdfDirect31WithPages(buffer, filename, geminiKey) {
  console.log(`Gemini 3.1 direct PDF OCR (with pages): starting for "${filename}"`);

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

  const pdfPart = {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: "application/pdf"
    }
  };

  const prompt = "Extract ALL text from this PDF document page by page. For each page, output a marker [PAGE N] followed by the text content of that page. Preserve the structure and formatting. Include every word, number, date, and detail. Do not summarize or paraphrase. Example format:\n[PAGE 1]\n<text from page 1>\n\n[PAGE 2]\n<text from page 2>";

  const result = await model.generateContent([prompt, pdfPart]);
  const response = await result.response;
  const fullText = response.text().trim();

  const wordCount = fullText.split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
  console.log(`Gemini 3.1 direct PDF OCR (with pages) complete: ${fullText.length} chars / ${wordCount} words for "${filename}"`);

  if (wordCount < 5) throw new Error("Gemini 3.1 returned very little text");

  const hasPageMarkers = /\[PAGE \d+\]/.test(fullText);
  return { text: fullText, hasPages: hasPageMarkers };
}

async function ocrPdfImageBased20WithPages(buffer, filename, geminiKey) {
  console.log(`Gemini 2.0 image-based OCR (with pages): starting for "${filename}"`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  try {
    let dpi = 300;
    if (buffer.length > 100 * 1024 * 1024) dpi = 150;
    else if (buffer.length > 50 * 1024 * 1024) dpi = 200;

    const imageFiles = await convertPdfToImages(pdfPath, tmpDir, dpi, null);
    if (imageFiles.length === 0) return { text: "", hasPages: false };

    const validImageFiles = [];
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tmpDir, imgFile);
      const fileSize = fs.statSync(imgPath).size;
      if (fileSize > GEMINI_MAX_SINGLE_IMAGE_BYTES) {
        const compressed = await compressImage(imgPath, GEMINI_MAX_SINGLE_IMAGE_BYTES);
        if (!compressed) continue;
      }
      validImageFiles.push(imgFile);
    }
    if (validImageFiles.length === 0) return { text: "", hasPages: false };

    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const pageResults = [];

    for (let i = 0; i < validImageFiles.length; i++) {
      const imgFile = validImageFiles[i];
      const imgPath = path.join(tmpDir, imgFile);
      const imgData = fs.readFileSync(imgPath);
      const imagePart = {
        inlineData: {
          data: imgData.toString("base64"),
          mimeType: "image/jpeg"
        }
      };

      const prompt = "Extract ALL text from this document page image. Return the complete text content exactly as it appears.";
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const pageText = response.text().trim();
      pageResults.push(`[PAGE ${i + 1}]\n${pageText}`);
    }

    const fullText = pageResults.join("\n\n");
    console.log(`Gemini 2.0 OCR (with pages) complete: ${fullText.length} chars from ${validImageFiles.length} pages`);
    return { text: fullText, hasPages: true };
  } finally {
    cleanupTmpDir(tmpDir);
  }
}

async function ocrPdfBufferTesseractWithPages(buffer, filename) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  try {
    const imageFiles = await convertPdfToImages(pdfPath, tmpDir, 300, 10);
    if (imageFiles.length === 0) return { text: "", hasPages: false };

    const Tesseract = require("tesseract.js");
    const worker = await Tesseract.createWorker("eng");

    const pageResults = [];
    try {
      for (let i = 0; i < imageFiles.length; i++) {
        const imgPath = path.join(tmpDir, imageFiles[i]);
        const { data: { text } } = await worker.recognize(imgPath);
        pageResults.push(`[PAGE ${i + 1}]\n${text.trim()}`);
      }
    } finally {
      await worker.terminate().catch(e => console.error("Tesseract terminate error:", e.message));
    }

    const fullText = pageResults.join("\n\n");
    console.log(`Tesseract OCR (with pages) complete: ${fullText.length} chars from ${imageFiles.length} pages`);
    return { text: fullText, hasPages: true };
  } finally {
    cleanupTmpDir(tmpDir);
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
    const numPages = data.numpages || 1;

    const wordCount = text.split(/\s+/).filter(w => /[a-zA-Z]{2,}/.test(w)).length;
    const charsPerPage = text.length / numPages;
    const hasUsefulText = text.length >= OCR_MIN_TEXT_LENGTH && wordCount >= 20 && charsPerPage >= 100;

    if (hasUsefulText) {
      return text;
    }

    console.log(`PDF text extraction yielded ${text.length} chars / ${wordCount} words / ${Math.round(charsPerPage)} chars/page (${numPages} pages) for "${filename}", attempting OCR...`);
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

module.exports = { extractText, extractTextWithPages };
