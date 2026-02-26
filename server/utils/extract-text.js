const mammoth = require("mammoth");

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
    return data.text || "";
  }
  return "";
}

module.exports = { extractText };
