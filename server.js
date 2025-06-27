// server.js - Version 3.3.0 - With OCR Support for Scanned PDFs
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// OCR Dependencies - Install these: npm install tesseract.js pdf2pic sharp
const Tesseract = require('tesseract.js');
const pdf2pic = require('pdf2pic');
const sharp = require('sharp');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting BT Company Extractor v3.3.0 with OCR Support for Scanned PDFs');

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads and temp directories
const uploadsDir = path.join(__dirname, 'uploads');
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log('📁 Created temp directory for OCR processing');
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// OCR processing function for scanned PDFs and images
async function performOCR(filePath, mimetype) {
  console.log('🔍 Starting OCR processing for:', path.basename(filePath));
  
  try {
    let imagePaths = [];
    
    if (mimetype === 'application/pdf') {
      console.log('📄 Converting PDF pages to images for OCR...');
      
      // Convert PDF to images
      const convert = pdf2pic.fromPath(filePath, {
        density: 300,           // DPI - higher = better quality
        saveFilename: "page",
        savePath: tempDir,
        format: "png",
        width: 2000,           // High resolution for better OCR
        height: 2000
      });
      
      // Convert first 3 pages (most Articles of Organization are 1-2 pages)
      for (let page = 1; page <= 3; page++) {
        try {
          const result = await convert(page, { responseType: "image" });
          if (result.path) {
            imagePaths.push(result.path);
            console.log(`📸 Converted page ${page} to image:`, result.path);
          }
        } catch (pageError) {
          console.log(`⚠️ Page ${page} conversion failed (may not exist):`, pageError.message);
          break; // Stop if page doesn't exist
        }
      }
    } else if (mimetype.startsWith('image/')) {
      // Direct image file
      imagePaths.push(filePath);
      console.log('📸 Processing image file directly');
    }
    
    if (imagePaths.length === 0) {
      throw new Error('No images to process for OCR');
    }
    
    // Perform OCR on each image
    let allOCRText = '';
    
    for (const imagePath of imagePaths) {
      console.log('🔍 Running OCR on:', path.basename(imagePath));
      
      try {
        // Preprocess image for better OCR
        const processedImagePath = imagePath + '_processed.png';
        await sharp(imagePath)
          .resize(null, 2000, { withoutEnlargement: true })
          .normalize()
          .sharpen()
          .png()
          .toFile(processedImagePath);
        
        // Run Tesseract OCR
        const { data: { text } } = await Tesseract.recognize(processedImagePath, 'eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              console.log(`📝 OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          },
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,&-\'()',
          tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD,
        });
        
        if (text && text.trim().length > 0) {
          allOCRText += text + '\n';
          console.log(`✅ OCR extracted ${text.length} characters from ${path.basename(imagePath)}`);
          console.log(`📄 Sample OCR text: "${text.substring(0, 100)}..."`);
        }
        
        // Clean up processed image
        if (fs.existsSync(processedImagePath)) {
          fs.unlinkSync(processedImagePath);
        }
        
      } catch (ocrError) {
        console.error(`❌ OCR failed for ${imagePath}:`, ocrError.message);
      }
    }
    
    // Clean up temp images (but not the original file)
    imagePaths.forEach(imagePath => {
      if (imagePath !== filePath && fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    });
    
    if (allOCRText.trim().length === 0) {
      throw new Error('OCR did not extract any readable text from the document');
    }
    
    // Clean up OCR text
    const cleanedText = allOCRText
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s&\.\-',()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`🎯 Final OCR result: ${cleanedText.length} characters extracted`);
    console.log(`📄 OCR Preview: "${cleanedText.substring(0, 200)}..."`);
    
    return cleanedText;
    
  } catch (error) {
    console.error('❌ OCR processing failed:', error);
    throw new Error(`OCR processing failed: ${error.message}. This may be due to poor image quality, unsupported format, or missing OCR dependencies.`);
  }
}

// Enhanced PDF parsing with OCR fallback for scanned documents
async function parsePdfWithFallbacks(filePath) {
  const pdfBuffer = fs.readFileSync(filePath);
  
  console.log('🔄 Attempting PDF parsing method 1: pdf-parse default');
  try {
    const pdfData = await pdf(pdfBuffer);
    if (pdfData.text && pdfData.text.length > 50) {
      console.log('✅ Method 1 successful, extracted text length:', pdfData.text.length);
      console.log('📄 Sample text:', pdfData.text.substring(0, 150));
      return pdfData.text;
    }
    console.log('⚠️ Method 1 produced insufficient text, trying alternatives...');
  } catch (error) {
    console.log('❌ Method 1 failed:', error.message);
  }

  console.log('🔄 Attempting PDF parsing method 2: pdf-parse with enhanced options');
  try {
    const pdfData = await pdf(pdfBuffer, {
      max: 0,
      version: 'v1.10.100',
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });
    if (pdfData.text && pdfData.text.length > 50) {
      console.log('✅ Method 2 successful, extracted text length:', pdfData.text.length);
      console.log('📄 Sample text:', pdfData.text.substring(0, 150));
      return pdfData.text;
    }
    console.log('⚠️ Method 2 produced insufficient text');
  } catch (error) {
    console.log('❌ Method 2 failed:', error.message);
  }

  console.log('🔄 Attempting PDF parsing method 3: Form fields extraction');
  try {
    const bufferStr = pdfBuffer.toString('latin1');
    const extractedTexts = [];
    
    const fieldPatterns = [
      /\/V\s*\((.*?)\)/g,
      /\/T\s*\((.*?)\)/g,
      /\/Contents\s*\((.*?)\)/g,
    ];
    
    fieldPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(bufferStr)) !== null) {
        const text = match[1];
        if (text && text.length > 2 && /[A-Za-z]/.test(text)) {
          extractedTexts.push(text);
        }
      }
      pattern.lastIndex = 0;
    });
    
    if (extractedTexts.length > 0) {
      const combinedText = extractedTexts.join(' ').replace(/[^\w\s&\.\-',]/g, ' ').replace(/\s+/g, ' ').trim();
      if (combinedText.length > 20) {
        console.log('✅ Method 3 successful, extracted text length:', combinedText.length);
        return combinedText;
      }
    }
    console.log('⚠️ Method 3 found no form fields');
  } catch (error) {
    console.log('❌ Method 3 failed:', error.message);
  }

  console.log('🔄 Attempting PDF parsing method 4: Raw text extraction');
  try {
    const bufferText = pdfBuffer.toString('latin1');
    const parenthesesMatches = bufferText.match(/\(([^)]{2,})\)/g);
    
    if (parenthesesMatches && parenthesesMatches.length > 0) {
      let extractedText = parenthesesMatches
        .map(match => match.replace(/[()]/g, ''))
        .filter(text => text.length > 1 && /[A-Za-z]/.test(text))
        .join(' ')
        .replace(/[^\w\s&\.\-',]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (extractedText.length > 20) {
        console.log('✅ Method 4 successful, extracted text length:', extractedText.length);
        return extractedText;
      }
    }
    console.log('⚠️ Method 4 produced insufficient text');
  } catch (error) {
    console.log('❌ Method 4 failed:', error.message);
  }

  console.log('🔄 Attempting PDF parsing method 5: OCR (Optical Character Recognition)');
  console.log('📸 This PDF appears to be a scanned image - using OCR to extract text...');
  
  try {
    // Use OCR as the final fallback for scanned PDFs
    const ocrText = await performOCR(filePath, 'application/pdf');
    if (ocrText && ocrText.length > 20) {
      console.log('✅ Method 5 (OCR) successful, extracted text length:', ocrText.length);
      console.log('📄 OCR Sample text:', ocrText.substring(0, 150));
      return ocrText;
    }
    console.log('⚠️ Method 5 (OCR) produced insufficient text');
  } catch (error) {
    console.log('❌ Method 5 (OCR) failed:', error.message);
  }

  // If all methods fail, return a descriptive error
  throw new Error(`Unable to extract text from PDF using any of 5 methods including OCR. 
    
    This could be due to:
    1. Very poor image quality in the scanned PDF
    2. Handwritten text that OCR cannot recognize
    3. Unusual fonts or formatting
    4. Corrupted or password-protected file
    5. Missing OCR dependencies
    
    Solutions to try:
    • Ensure the PDF has clear, readable text
    • Try a higher quality scan (300+ DPI)
    • Convert to a different format manually
    • Use professional OCR software
    • Re-scan the original document with better quality
    • Contact support for assistance`);
}

// Enhanced document parsing with OCR support
async function parseDocument(filePath, mimetype) {
  try {
    let text = '';
    console.log('📄 Parsing document:', path.basename(filePath), 'Type:', mimetype);

    switch (mimetype) {
      case 'application/pdf':
        text = await parsePdfWithFallbacks(filePath);
        break;
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        const docxResult = await mammoth.extractRawText({ path: filePath });
        text = docxResult.value;
        break;
      case 'application/msword':
        const docBuffer = fs.readFileSync(filePath);
        text = docBuffer.toString('utf8').replace(/[^\x20-\x7E]/g, ' ');
        break;
      case 'image/png':
      case 'image/jpeg':
      case 'image/jpg':
        console.log('📸 Processing image file with OCR...');
        text = await performOCR(filePath, mimetype);
        break;
      default:
        throw new Error('Unsupported file type');
    }

    text = text.replace(/\s+/g, ' ').trim();
    console.log(`📝 Final extracted text length: ${text.length} characters`);
    
    if (text.length < 10) {
      throw new Error('Extracted text is too short. Document may be empty, corrupted, or require manual processing.');
    }
    
    return text;
  } catch (error) {
    console.error('❌ Error parsing document:', error);
    throw error;
  }
}

// ENHANCED: Company name extraction with OCR-specific improvements
function extractCompanyNamesEnhanced(text) {
  console.log('🔍 ENHANCED: Extracting company names (v3.3.0 with OCR support)...');
  console.log('📄 Raw text length:', text.length);
  console.log('📄 First 500 chars:', text.substring(0, 500));
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
  
  // Test for specific company names
  console.log('🔍 Testing for BitConcepts:', cleanText.includes('BitConcepts'));
  console.log('🔍 Testing for PORVIN:', cleanText.includes('PORVIN'));
  console.log('🔍 Testing for LLC:', cleanText.includes('LLC'));
  console.log('🔍 Testing for PLLC:', cleanText.includes('PLLC'));
  
  const foundNames = [];

  // OCR-friendly patterns (more flexible for OCR text recognition errors)
  const enhancedPatterns = [
    // Exact match for Articles format with OCR tolerance
    {
      name: 'Articles LLC Pattern (OCR tolerant)',
      regex: /(?:The\s+name\s+of\s+the\s+limited\s+liability\s+company\s+is|company\s+is)[:\s]*([A-Za-z][A-Za-z\s&\.\-',]*(?:LLC|PLLC|Inc\.?|Corp\.?))/gi,
      confidence: 70
    },
    // More flexible Articles pattern for OCR
    {
      name: 'Flexible Articles Pattern',
      regex: /(?:limited\s+liability\s+company|LLC\s+is|company\s+name)[:\s]*([A-Za-z][^.\n\r]{5,60}(?:LLC|PLLC))/gi,
      confidence: 65
    },
    // Law firm pattern
    {
      name: 'Header PLLC Pattern', 
      regex: /(PORVIN[^,]*,?\s*BURNSTEIN[^,]*&[^,]*GARELIK[^,]*,?\s*PLLC)/gi,
      confidence: 60
    },
    // BitConcepts specific with OCR tolerance
    {
      name: 'BitConcepts Specific (OCR tolerant)',
      regex: /([Bb][Ii][Tt][Cc][Oo][Nn][Cc][Ee][Pp][Tt][Ss][^,]*,?\s*LLC)/gi,
      confidence: 65
    },
    // More flexible patterns for OCR errors
    {
      name: 'Flexible LLC Pattern',
      regex: /([A-Z][A-Za-z\s&\.\-']{3,45})\s*,?\s*LLC/gi,
      confidence: 45
    },
    {
      name: 'Flexible PLLC Pattern',
      regex: /([A-Z][A-Za-z\s&\.\-']{3,45})\s*,?\s*PLLC/gi,
      confidence: 50
    },
    // Standard patterns
    {
      name: 'Standard LLC',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 40
    },
    {
      name: 'Professional LLC (PLLC)',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(PLLC|P\.L\.L\.C\.)\b/g,
      confidence: 45
    }
  ];

  enhancedPatterns.forEach((pattern) => {
    console.log(`🔍 Testing pattern: ${pattern.name}`);
    let match;
    let matchCount = 0;
    
    while ((match = pattern.regex.exec(cleanText)) !== null && matchCount < 10) {
      matchCount++;
      const fullMatch = match[0];
      const companyPart = match[1];
      
      console.log(`✅ ${pattern.name} FOUND: "${fullMatch}"`);
      console.log(`📝 Company part: "${companyPart}"`);
      
      let finalName = fullMatch.trim();
      
      // Clean up the name (especially important for OCR text)
      if (companyPart && companyPart.trim()) {
        const cleanCompanyPart = companyPart.trim()
          .replace(/[^\w\s&\.\-',]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
          
        if (cleanCompanyPart.length > 1) {
          // Determine entity type
          if (fullMatch.includes('PLLC')) {
            finalName = cleanCompanyPart.includes('PLLC') ? cleanCompanyPart : `${cleanCompanyPart} PLLC`;
          } else if (fullMatch.includes('LLC')) {
            finalName = cleanCompanyPart.includes('LLC') ? cleanCompanyPart : `${cleanCompanyPart} LLC`;
          } else {
            finalName = cleanCompanyPart + ' LLC';
          }
        }
      }
      
      // Additional validation with OCR tolerance
      if (finalName.length >= 3 && finalName.length <= 80 && 
          !/^(article|certificate|department|the\s+name)/i.test(finalName)) {
        
        foundNames.push({
          name: finalName,
          confidence: pattern.confidence,
          patternName: pattern.name,
          originalMatch: fullMatch,
          context: getContext(cleanText, fullMatch)
        });
        
        console.log(`💾 ADDED: "${finalName}" (${pattern.confidence}% confidence)`);
      }
    }
    
    pattern.regex.lastIndex = 0;
  });

  // Enhanced deduplication
  const uniqueNames = foundNames.reduce((acc, current) => {
    const normalizedCurrentName = current.name.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
    
    const existing = acc.find(item => {
      const normalizedExistingName = item.name.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
      return normalizedExistingName === normalizedCurrentName;
    });
    
    if (!existing) {
      acc.push(current);
    } else if (current.confidence > existing.confidence) {
      const index = acc.indexOf(existing);
      acc[index] = current;
    }
    return acc;
  }, []);

  uniqueNames.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`🎯 ENHANCED RESULTS: ${uniqueNames.length} unique names found`);
  uniqueNames.forEach((name, i) => {
    console.log(`${i+1}. "${name.name}" (${name.confidence}% - ${name.patternName})`);
  });

  return uniqueNames.slice(0, 5);
}

// Standard extraction function (unchanged)
function extractCompanyNames(text) {
  console.log('🔍 Extracting company names (standard method)...');
  console.log('📄 Document preview:', text.substring(0, 800));
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();

  const excludePatterns = [
    /articles?\s+of\s+incorporation\s+for/i,
    /certificate\s+of\s+formation\s+for/i,
    /bylaws?\s+of\s+the/i,
    /operating\s+agreement\s+of/i,
    /memorandum\s+of\s+understanding\s+between/i,
    /terms?\s+of\s+service\s+agreement/i,
    /privacy\s+policy\s+of/i
  ];

  const patterns = [
    {
      name: 'Articles LLC Format',
      regex: /(?:name\s+of\s+the\s+limited\s+liability\s+company\s+is\s*:?\s*)([A-Za-z][A-Za-z\s&\.\-',]{2,50}(?:\s*,?\s*LLC))/gi,
      confidence: 55
    },
    {
      name: 'Standard LLC',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 40
    },
    {
      name: 'Professional LLC (PLLC)',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(PLLC|P\.L\.L\.C\.)\b/g,
      confidence: 45
    },
    {
      name: 'Standard Corporation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
      confidence: 40
    }
  ];

  const foundNames = [];

  patterns.forEach((pattern) => {
    console.log(`🔍 Testing pattern: ${pattern.name}`);
    let match;
    let matchCount = 0;
    
    while ((match = pattern.regex.exec(cleanText)) !== null && matchCount < 10) {
      matchCount++;
      const fullMatch = match[0];
      const companyNamePart = match[1];
      
      console.log(`✅ ${pattern.name} found: "${fullMatch}"`);
      
      const isExcluded = excludePatterns.some(excludePattern => 
        excludePattern.test(fullMatch)
      );
      
      if (isExcluded) {
        console.log(`❌ Excluded: "${fullMatch}"`);
        continue;
      }
      
      const cleanName = companyNamePart
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s&\.\-',]/g, '')
        .trim();
      
      if (cleanName.length >= 2 && 
          cleanName.length <= 70 && 
          /^[A-Z]/.test(cleanName) &&
          !/^\d+$/.test(cleanName) &&
          !/(^article|^certificate|^bylaw|^whereas|^therefore|department\s+of)/i.test(cleanName)) {
        
        let entityType = '';
        if (/\b(LLC|L\.L\.C\.)\b/i.test(fullMatch)) {
          entityType = 'LLC';
        } else if (/\b(PLLC|P\.L\.L\.C\.)\b/i.test(fullMatch)) {
          entityType = 'PLLC';
        } else if (/\b(Inc\.?|Incorporated)\b/i.test(fullMatch)) {
          entityType = 'Inc.';
        } else if (/\b(Corp\.?|Corporation)\b/i.test(fullMatch)) {
          entityType = 'Corp.';
        } else {
          entityType = 'LLC';
        }
        
        const finalName = entityType && !cleanName.toLowerCase().includes(entityType.toLowerCase()) 
          ? `${cleanName} ${entityType}` 
          : cleanName;
        
        const confidence = calculateConfidence(fullMatch, cleanText, pattern.confidence, cleanName);
        
        foundNames.push({
          name: finalName,
          confidence: confidence,
          patternName: pattern.name,
          originalMatch: fullMatch,
          context: getContext(cleanText, fullMatch)
        });
        
        console.log(`💾 Added: "${finalName}" (${confidence}% confidence)`);
      }
    }
    
    pattern.regex.lastIndex = 0;
  });

  const uniqueNames = foundNames.reduce((acc, current) => {
    const normalizedCurrentName = current.name.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
    
    const existing = acc.find(item => {
      const normalizedExistingName = item.name.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
      return normalizedExistingName === normalizedCurrentName;
    });
    
    if (!existing) {
      acc.push(current);
    } else if (current.confidence > existing.confidence) {
      const index = acc.indexOf(existing);
      acc[index] = current;
    }
    return acc;
  }, []);

  uniqueNames.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`🎯 Final results: ${uniqueNames.length} unique company names found`);
  uniqueNames.forEach((name, index) => {
    console.log(`${index + 1}. "${name.name}" (${name.confidence}% - ${name.patternName})`);
  });
  
  return uniqueNames.slice(0, 5);
}

function calculateConfidence(match, fullText, baseConfidence, cleanName) {
  let confidence = baseConfidence;
  
  const occurrences = (fullText.match(new RegExp(cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  confidence += Math.min(occurrences * 3, 15);
  
  const position = fullText.toLowerCase().indexOf(match.toLowerCase());
  if (position < 200) confidence += 10;
  else if (position < 500) confidence += 5;
  
  const nameLength = cleanName.length;
  if (nameLength >= 5 && nameLength <= 30) confidence += 5;
  if (nameLength < 3) confidence -= 15;
  if (nameLength > 50) confidence -= 10;
  
  if (/(solutions|services|systems|technologies|consulting|industries|enterprises|group|partners)/i.test(cleanName)) {
    confidence += 3;
  }
  
  return Math.min(confidence, 100);
}

function getContext(text, match) {
  const index = text.indexOf(match);
  if (index === -1) return '';
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + match.length + 50);
  return text.substring(start, end);
}

// HubSpot API update
async function updateHubSpotCompany(companyId, companyName) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HubSpot access token not configured');

  console.log(`🔄 Updating HubSpot company ${companyId} with name: "${companyName}"`);

  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ properties: { name: companyName } })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
  }

  console.log('✅ HubSpot update successful');
  return await response.json();
}

// ROUTES

// NEW: OCR-specific debug endpoint
app.post('/api/debug-ocr', upload.single('document'), async (req, res) => {
  try {
    console.log('🔍 DEBUG: OCR-specific analysis');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 DEBUG: Testing OCR on file:', req.file.originalname);
    
    const results = {
      filename: req.file.originalname,
      fileSize: req.file.size,
      mimetype: req.file.mimetype,
      ocrResults: null,
      extractionResults: null,
      processingTime: null
    };

    const startTime = Date.now();

    try {
      // Force OCR processing
      console.log('🔍 Forcing OCR processing...');
      const ocrText = await performOCR(req.file.path, req.file.mimetype);
      results.ocrResults = {
        success: true,
        textLength: ocrText.length,
        extractedText: ocrText,
        preview: ocrText.substring(0, 500),
        containsTargets: {
          BitConcepts: ocrText.includes('BitConcepts'),
          PORVIN: ocrText.includes('PORVIN'),
          LLC: ocrText.includes('LLC'),
          Articles: ocrText.toLowerCase().includes('articles')
        }
      };
      
      // Try extraction on OCR results
      const companyNames = extractCompanyNamesEnhanced(ocrText);
      results.extractionResults = companyNames;
      
    } catch (error) {
      results.ocrResults = {
        success: false,
        error: error.message
      };
    }

    results.processingTime = Date.now() - startTime;

    // Cleanup
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      results: results,
      recommendation: results.extractionResults && results.extractionResults.length > 0 ? 
        'OCR successfully extracted company names!' : 
        'OCR extracted text but no company names found - check extraction patterns',
      ocrCapable: true,
      processingTimeMs: results.processingTime
    });

  } catch (error) {
    console.error('❌ DEBUG: Error in OCR analysis:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced debug text endpoint with OCR support
app.post('/api/debug-text', upload.single('document'), async (req, res) => {
  try {
    console.log('🔍 DEBUG: Text extraction request');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 DEBUG: Processing file:', req.file.originalname);

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    
    const standardResults = extractCompanyNames(documentText);
    const enhancedResults = extractCompanyNamesEnhanced(documentText);
    
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      filename: req.file.originalname,
      rawText: documentText,
      textLength: documentText.length,
      firstChars: documentText.substring(0, 1000),
      lastChars: documentText.substring(Math.max(0, documentText.length - 500)),
      containsBitConcepts: documentText.includes('BitConcepts'),
      containsPorvin: documentText.includes('PORVIN'),
      containsLLC: documentText.includes('LLC'),
      containsPLLC: documentText.includes('PLLC'),
      preview: {
        line1: documentText.split('\n')[0] || '',
        line2: documentText.split('\n')[1] || '',
        line3: documentText.split('\n')[2] || ''
      },
      standardExtractionResults: standardResults,
      enhancedExtractionResults: enhancedResults,
      extractionComparison: {
        standardCount: standardResults.length,
        enhancedCount: enhancedResults.length,
        recommendation: enhancedResults.length > standardResults.length ? 'Use Enhanced' : 'Use Standard'
      },
      ocrCapable: true,
      note: 'This server supports OCR for scanned PDFs and images'
    });

  } catch (error) {
    console.error('❌ DEBUG: Error extracting text:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ 
      error: error.message,
      details: 'Text extraction failed. If this is a scanned PDF, try the /api/debug-ocr endpoint.',
      troubleshooting: [
        'For scanned PDFs: Try /api/debug-ocr endpoint',
        'Ensure document quality is good for OCR',
        'Try converting to DOCX format if possible',
        'Check if document is password protected'
      ]
    });
  }
});

// Extract multiple options endpoint (with OCR support)
app.post('/api/extract-names', upload.single('document'), async (req, res) => {
  try {
    console.log('📥 Extract names request received');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 Processing file:', req.file.originalname, `(${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    
    let companyOptions = extractCompanyNamesEnhanced(documentText);
    if (companyOptions.length === 0) {
      console.log('⚠️ Enhanced extraction found nothing, trying standard method...');
      companyOptions = extractCompanyNames(documentText);
    }
    
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    if (companyOptions.length === 0) {
      console.log('❌ No company names found in document');
      return res.status(400).json({ 
        error: 'Could not extract any company names from document. Please ensure the document contains company names with legal entity types (LLC, Inc., Corp., PLLC, etc.)',
        extractedText: documentText.substring(0, 1000) + '...',
        suggestion: 'Try the debug endpoints to analyze text extraction:',
        debugEndpoints: {
          textAnalysis: `${req.protocol}://${req.get('host')}/api/debug-text`,
          ocrAnalysis: `${req.protocol}://${req.get('host')}/api/debug-ocr`
        },
        troubleshooting: [
          'For scanned documents: OCR extraction was attempted',
          'Check if document contains searchable text',
          'Verify company names include entity types (LLC, Inc., etc.)',
          'Try higher quality scans if using OCR',
          'Ensure document is not password protected'
        ]
      });
    }

    console.log(`📋 Returning ${companyOptions.length} company options to client`);
    res.json({
      success: true,
      filename: req.file.originalname,
      documentLength: documentText.length,
      companyOptions: companyOptions,
      extractionMethod: 'Enhanced multi-pattern content analysis v3.3.0 with OCR support for scanned documents',
      ocrUsed: req.file.mimetype === 'application/pdf' ? 'Attempted if needed' : req.file.mimetype.startsWith('image/') ? 'Yes' : 'No'
    });

  } catch (error) {
    console.error('❌ Extract names error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ 
      error: error.message,
      troubleshooting: [
        'For scanned PDFs: Use /api/debug-ocr for detailed OCR analysis',
        'Try converting document to DOCX format',
        'Ensure document quality is good for OCR',
        'Check if document is corrupted or password protected'
      ]
    });
  }
});

// Update company with selected name
app.post('/api/update-company', async (req, res) => {
  try {
    console.log('🔄 Update company request received');
    
    const { companyId, companyName } = req.body;
    
    if (!companyId || !companyName) {
      return res.status(400).json({ error: 'Company ID and name are required' });
    }

    console.log(`📝 Request: Update company ${companyId} with "${companyName}"`);

    const updatedCompany = await updateHubSpotCompany(companyId, companyName);

    res.json({
      success: true,
      companyId: companyId,
      updatedName: companyName,
      hubspotResponse: 'Updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Update company error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint for backward compatibility
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    console.log('⚠️ Legacy upload-document endpoint called - consider using new flow');
    
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { companyId } = req.body;
    if (!companyId) return res.status(400).json({ error: 'Company ID is required' });

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    let companyOptions = extractCompanyNamesEnhanced(documentText);
    if (companyOptions.length === 0) {
      companyOptions = extractCompanyNames(documentText);
    }
    
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    if (companyOptions.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract company names',
        extractedText: documentText.substring(0, 1000) + '...',
        debugEndpoint: `${req.protocol}://${req.get('host')}/api/debug-text`
      });
    }

    const bestOption = companyOptions[0];
    await updateHubSpotCompany(companyId, bestOption.name);

    res.json({
      success: true,
      extractedName: bestOption.name,
      companyId: companyId,
      filename: req.file.originalname,
      allOptions: companyOptions,
      note: 'Auto-selected best option. Use new selection interface for manual choice.'
    });

  } catch (error) {
    console.error('❌ Legacy upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BT Company Extractor API v3.3.0 with OCR Support for Scanned PDFs is running!',
    version: '3.3.0',
    timestamp: new Date().toISOString(),
    features: [
      'OCR support for scanned PDFs and images (Tesseract.js)',
      'Enhanced PDF text extraction with multiple fallback methods',
      'DOCX parsing', 
      'Multi-option company name detection',
      'Articles of Organization support (including scanned)',
      'PLLC entity recognition',
      'Enhanced extraction algorithms',
      'Comprehensive debug endpoints',
      'User selection interface',
      'Edit capability',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'POST /api/extract-names - Extract multiple company name options (with OCR)',
      'POST /api/update-company - Update HubSpot with selected name',
      'POST /api/debug-text - Debug document text extraction',
      'POST /api/debug-ocr - Test OCR processing specifically (NEW)',
      'POST /api/upload-document - Legacy auto-update endpoint'
    ],
    improvements: [
      'Added Tesseract.js OCR for scanned PDFs and images',
      'Enhanced patterns for OCR text recognition',
      'PDF to image conversion for OCR processing',
      'Improved error handling for scanned documents',
      'Better text cleaning for OCR results',
      'Support for PNG, JPEG image uploads'
    ],
    dependencies: [
      'tesseract.js - OCR text recognition',
      'pdf2pic - PDF to image conversion', 
      'sharp - Image processing'
    ],
    env: {
      hasHubSpotToken: !!process.env.HUBSPOT_ACCESS_TOKEN,
      nodeVersion: process.version,
      platform: 'Render',
      ocrEnabled: true
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'BT Company Name Extractor API v3.3.0',
    status: 'OCR-Enabled for Scanned PDFs and Images',
    description: 'Extract company names from documents including scanned PDFs using OCR technology',
    features: [
      'Extract up to 5 company name options',
      'OCR support for scanned PDFs (Tesseract.js)',
      'Image file processing (PNG, JPEG)',
      'Enhanced PDF parsing with multiple fallback methods',
      'Comprehensive debug endpoints',
      'Articles of Organization support (including scanned)',
      'PLLC entity recognition',
      'Dual extraction algorithms',
      'Confidence scoring and ranking',
      'User selection and editing interface',
      'HubSpot CRM integration'
    ],
    ocrSupport: {
      enabled: true,
      supportedFormats: ['PDF (scanned)', 'PNG', 'JPEG', 'JPG'],
      engine: 'Tesseract.js',
      languages: ['English'],
      recommendedDPI: '300+',
      maxFileSize: '10MB'
    },
    debugUsage: {
      textAnalysis: 'POST /api/debug-text with document',
      ocrAnalysis: 'POST /api/debug-ocr with scanned PDF or image (NEW)',
      description: 'Upload documents to analyze text extraction and company name detection'
    }
  });
});

app.use((error, req, res, next) => {
  console.error('❌ Global error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

app.listen(PORT, () => {
  console.log('🚀 BT Company Extractor v3.3.0 server started');
  console.log(`📍 Running on port ${PORT}`);
  console.log(`🔑 HubSpot token configured: ${!!process.env.HUBSPOT_ACCESS_TOKEN}`);
  console.log('✨ Features: OCR for scanned PDFs, image processing, enhanced extraction');
  console.log('🌐 Available endpoints:');
  console.log('   GET  /api/health');
  console.log('   POST /api/extract-names (with OCR support)');
  console.log('   POST /api/update-company');
  console.log('   POST /api/debug-text');
  console.log('   POST /api/debug-ocr (NEW)');
  console.log('   POST /api/upload-document (legacy)');
  console.log('🔍 OCR: Tesseract.js enabled for scanned documents');
  console.log('📸 Supported: PDF, DOCX, DOC, PNG, JPEG, JPG');
  console.log('💡 Tip: Use /api/debug-ocr to test OCR processing on scanned documents');
});