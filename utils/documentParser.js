// utils/documentParser.js
const fs = require('fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const { promisify } = require('util');

const textractExtract = promisify(textract.fromFileWithPath);

async function parseDocument(filePath, mimeType) {
  try {
    let text = '';

    switch (mimeType) {
      case 'application/pdf':
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdf(pdfBuffer);
        text = pdfData.text;
        break;

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        const docxResult = await mammoth.extractRawText({ path: filePath });
        text = docxResult.value;
        break;

      case 'application/msword':
        text = await textractExtract(filePath);
        break;

      default:
        throw new Error('Unsupported file type');
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    return text;
  } catch (error) {
    // Clean up file even if parsing fails
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
}

function extractCompanyName(text) {
  // Define patterns to look for company legal names
  const patterns = [
    // LLC patterns
    /([A-Za-z\s&]+(?:,?\s*LLC|,?\s*L\.L\.C\.|,?\s*Limited Liability Company))/gi,
    // Corporation patterns
    /([A-Za-z\s&]+(?:,?\s*Corp\.|,?\s*Corporation|,?\s*Inc\.|,?\s*Incorporated))/gi,
    // Company patterns
    /([A-Za-z\s&]+(?:,?\s*Co\.|,?\s*Company))/gi,
    // Ltd patterns
    /([A-Za-z\s&]+(?:,?\s*Ltd\.|,?\s*Limited))/gi,
    // Partnership patterns
    /([A-Za-z\s&]+(?:,?\s*LLP|,?\s*L\.L\.P\.|,?\s*Limited Liability Partnership))/gi,
    // Generic legal entity patterns
    /([A-Za-z\s&]+(?:,?\s*LP|,?\s*L\.P\.|,?\s*Limited Partnership))/gi
  ];

  const foundNames = [];

  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const cleanName = match.trim().replace(/\s+/g, ' ');
        if (cleanName.length > 3 && cleanName.length < 100) {
          foundNames.push(cleanName);
        }
      });
    }
  });

  // Remove duplicates and return the first valid match
  const uniqueNames = [...new Set(foundNames)];
  
  // Prefer longer, more complete names
  return uniqueNames.sort((a, b) => b.length - a.length)[0] || null;
}

module.exports = { parseDocument, extractCompanyName };