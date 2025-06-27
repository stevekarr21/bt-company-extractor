// server.js - Version 3.2.1 - Enhanced PDF Parsing (OCR-Ready but Optional)
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// OCR Dependencies - These are optional and will be checked at runtime
let Tesseract, pdf2pic, sharp;
let ocrAvailable = false;

try {
  Tesseract = require('tesseract.js');
  pdf2pic = require('pdf2pic');
  sharp = require('sharp');
  ocrAvailable = true;
  console.log('✅ OCR dependencies loaded successfully');
} catch (error) {
  console.log('⚠️ OCR dependencies not available:', error.message);
  console.log('📝 To enable OCR for scanned PDFs, install: npm install tesseract.js pdf2pic sharp');
  ocrAvailable = false;
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting BT Company Extractor v3.2.1 with Enhanced PDF Parsing');
console.log(`🔍 OCR Support: ${ocrAvailable ? 'ENABLED' : 'DISABLED (install dependencies to enable)'}`);

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
  console.log('📁 Created temp directory');
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
      'application/msword'
    ];
    // Add image types only if OCR is available
    if (ocrAvailable) {
      allowedTypes.push('image/png', 'image/jpeg', 'image/jpg');
    }
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// OCR processing function (only if dependencies are available)
async function performOCR(filePath, mimetype) {
  if (!ocrAvailable) {
    throw new Error('OCR dependencies not installed. Install with: npm install tesseract.js pdf2pic sharp');
  }

  console.log('🔍 Starting OCR processing for:', path.basename(filePath));
  
  try {
    let imagePaths = [];
    
    if (mimetype === 'application/pdf') {
      console.log('📄 Converting PDF pages to images for OCR...');
      
      // Try multiple pdf2pic configurations
      const configs = [
        {
          density: 300,
          saveFilename: "page",
          savePath: tempDir,
          format: "png",
          width: 2000,
          height: 2000
        },
        {
          density: 150,
          saveFilename: "page_low",
          savePath: tempDir,
          format: "jpeg",
          width: 1500,
          height: 1500
        },
        {
          density: 200,
          saveFilename: "page_med",
          savePath: tempDir,
          format: "png"
        }
      ];
      
      let conversionSuccessful = false;
      
      for (let configIndex = 0; configIndex < configs.length; configIndex++) {
        const config = configs[configIndex];
        console.log(`🔄 Trying PDF conversion config ${configIndex + 1}:`, config);
        
        try {
          const convert = pdf2pic.fromPath(filePath, config);
          
          for (let page = 1; page <= 5; page++) {
            try {
              console.log(`📄 Converting page ${page} with config ${configIndex + 1}...`);
              const result = await convert(page, { responseType: "image" });
              
              if (result && result.path && fs.existsSync(result.path)) {
                imagePaths.push(result.path);
                console.log(`✅ Successfully converted page ${page}:`, result.path);
                conversionSuccessful = true;
              } else if (result && result.base64) {
                // Handle base64 response
                const imagePath = path.join(tempDir, `page_${page}_${Date.now()}.png`);
                const imageBuffer = Buffer.from(result.base64, 'base64');
                fs.writeFileSync(imagePath, imageBuffer);
                imagePaths.push(imagePath);
                console.log(`✅ Successfully converted page ${page} from base64:`, imagePath);
                conversionSuccessful = true;
              } else {
                console.log(`⚠️ Page ${page} conversion returned invalid result:`, result);
              }
            } catch (pageError) {
              console.log(`⚠️ Page ${page} conversion failed with config ${configIndex + 1}:`, pageError.message);
              if (page === 1) {
                // If first page fails, try next config
                break;
              }
              // If not first page, might just be end of document
              if (imagePaths.length > 0) {
                break; // We got some pages, stop here
              }
            }
          }
          
          if (conversionSuccessful) {
            console.log(`✅ PDF conversion successful with config ${configIndex + 1}`);
            break; // Exit config loop if we got some images
          }
          
        } catch (configError) {
          console.log(`❌ Config ${configIndex + 1} failed entirely:`, configError.message);
          continue; // Try next config
        }
      }
      
      if (!conversionSuccessful) {
        console.log('❌ All PDF conversion configs failed');
        throw new Error('Failed to convert PDF to images with any configuration. PDF might be corrupted, password-protected, or in an unsupported format.');
      }
      
    } else if (mimetype.startsWith('image/')) {
      imagePaths.push(filePath);
      console.log('📸 Processing image file directly');
    }
    
    if (imagePaths.length === 0) {
      throw new Error('No images to process for OCR - PDF conversion failed');
    }
    
    console.log(`📸 Successfully prepared ${imagePaths.length} images for OCR processing`);
    
    let allOCRText = '';
    
    for (const imagePath of imagePaths) {
      console.log('🔍 Running OCR on:', path.basename(imagePath));
      
      try {
        const processedImagePath = imagePath + '_processed.png';
        await sharp(imagePath)
          .resize(null, 2000, { withoutEnlargement: true })
          .normalize()
          .sharpen()
          .png()
          .toFile(processedImagePath);
        
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
          console.log(`✅ OCR extracted ${text.length} characters`);
          console.log(`📄 Sample OCR text: "${text.substring(0, 100)}..."`);
        }
        
        if (fs.existsSync(processedImagePath)) {
          fs.unlinkSync(processedImagePath);
        }
        
      } catch (ocrError) {
        console.error(`❌ OCR failed for ${imagePath}:`, ocrError.message);
      }
    }
    
    // Clean up temp images
    imagePaths.forEach(imagePath => {
      if (imagePath !== filePath && fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    });
    
    if (allOCRText.trim().length === 0) {
      throw new Error('OCR did not extract any readable text');
    }
    
    const cleanedText = allOCRText
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s&\.\-',()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`🎯 OCR result: ${cleanedText.length} characters extracted`);
    return cleanedText;
    
  } catch (error) {
    console.error('❌ OCR processing failed:', error);
    throw error;
  }
}

// Enhanced PDF parsing with conditional OCR
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
      while ((match = pattern.exec(bufferStr)) !== null) {
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

  // OCR method (only if available)
  if (ocrAvailable) {
    console.log('🔄 Attempting PDF parsing method 5: OCR (Optical Character Recognition)');
    console.log('📸 This PDF appears to be a scanned image - using OCR...');
    
    try {
      const ocrText = await performOCR(filePath, 'application/pdf');
      if (ocrText && ocrText.length > 20) {
        console.log('✅ Method 5 (OCR) successful, extracted text length:', ocrText.length);
        return ocrText;
      }
      console.log('⚠️ Method 5 (OCR) produced insufficient text');
    } catch (error) {
      console.log('❌ Method 5 (OCR) failed:', error.message);
    }
  } else {
    console.log('⚠️ OCR not available - install dependencies for scanned PDF support');
  }

  // Enhanced error message
  const errorMessage = ocrAvailable 
    ? `Unable to extract text from PDF using any of 5 methods including OCR.`
    : `Unable to extract text from PDF using standard methods. This appears to be a scanned PDF.`;
    
  const solutions = ocrAvailable 
    ? [
        'Try a higher quality scan (300+ DPI)',
        'Use professional OCR software',
        'Re-scan the original document',
        'Convert to DOCX manually'
      ]
    : [
        'Install OCR dependencies: npm install tesseract.js pdf2pic sharp',
        'Convert to DOCX using Adobe Acrobat or Google Docs',
        'Use online OCR services',
        'Manual text entry',
        'Contact support for OCR setup assistance'
      ];

  throw new Error(`${errorMessage}
    
    This could be due to:
    1. Scanned image PDF (requires OCR)
    2. Poor image quality
    3. Handwritten text
    4. Password protection
    5. File corruption
    
    Solutions to try:
    ${solutions.map((sol, i) => `${i + 1}. ${sol}`).join('\n    ')}
    
    ${!ocrAvailable ? '\n🔍 OCR Status: Not installed. Install OCR dependencies to process scanned PDFs automatically.' : ''}`);
}

// Enhanced document parsing
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
        if (!ocrAvailable) {
          throw new Error('Image processing requires OCR dependencies. Install with: npm install tesseract.js pdf2pic sharp');
        }
        console.log('📸 Processing image file with OCR...');
        text = await performOCR(filePath, mimetype);
        break;
      default:
        throw new Error('Unsupported file type');
    }

    text = text.replace(/\s+/g, ' ').trim();
    console.log(`📝 Final extracted text length: ${text.length} characters`);
    
    if (text.length < 10) {
      throw new Error('Extracted text is too short. Document may be empty, corrupted, or require OCR processing.');
    }
    
    return text;
  } catch (error) {
    console.error('❌ Error parsing document:', error);
    throw error;
  }
}

// Enhanced company name extraction
function extractCompanyNamesEnhanced(text) {
  console.log('🔍 ENHANCED: Extracting company names (v3.2.1)...');
  console.log('📄 Raw text length:', text.length);
  console.log('📄 First 500 chars:', text.substring(0, 500));
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
  
  console.log('🔍 Testing for BitConcepts:', cleanText.includes('BitConcepts'));
  console.log('🔍 Testing for PORVIN:', cleanText.includes('PORVIN'));
  console.log('🔍 Testing for LLC:', cleanText.includes('LLC'));
  console.log('🔍 Testing for PLLC:', cleanText.includes('PLLC'));
  
  const foundNames = [];

  // Enhanced patterns with OCR tolerance
  const enhancedPatterns = [
    // Very specific Articles of Organization pattern
    {
      name: 'Articles LLC Declaration',
      regex: /(?:The\s+name\s+of\s+the\s+limited\s+liability\s+company\s+is|company\s+is)[:\s]*([A-Za-z][A-Za-z\s&\.\-',]*(?:LLC|PLLC|Inc\.?|Corp\.?))/gi,
      confidence: 75
    },
    // Flexible Articles pattern for OCR errors
    {
      name: 'Flexible Articles Pattern',
      regex: /(?:limited\s+liability\s+company|LLC\s+company)[:\s]*([A-Za-z][^.\n\r]{5,60}(?:LLC|PLLC))/gi,
      confidence: 70
    },
    // Law firm header pattern
    {
      name: 'Law Firm Header PLLC', 
      regex: /(PORVIN[^,]*,?\s*BURNSTEIN[^,]*&[^,]*GARELIK[^,]*,?\s*PLLC)/gi,
      confidence: 65
    },
    // BitConcepts specific with OCR tolerance
    {
      name: 'BitConcepts Specific',
      regex: /([Bb][Ii][Tt][Cc][Oo][Nn][Cc][Ee][Pp][Tt][Ss][^,]*,?\s*LLC)/gi,
      confidence: 70
    },
    // More flexible patterns
    {
      name: 'Any Company LLC',
      regex: /([A-Z][A-Za-z\s&\.\-']{3,45})\s*,?\s*LLC/gi,
      confidence: 45
    },
    {
      name: 'Any Company PLLC',
      regex: /([A-Z][A-Za-z\s&\.\-']{3,45})\s*,?\s*PLLC/gi,
      confidence: 50
    },
    // Standard fallback patterns
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
      
      if (companyPart && companyPart.trim()) {
        const cleanCompanyPart = companyPart.trim()
          .replace(/[^\w\s&\.\-',]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
          
        if (cleanCompanyPart.length > 1) {
          if (fullMatch.includes('PLLC')) {
            finalName = cleanCompanyPart.includes('PLLC') ? cleanCompanyPart : `${cleanCompanyPart} PLLC`;
          } else if (fullMatch.includes('LLC')) {
            finalName = cleanCompanyPart.includes('LLC') ? cleanCompanyPart : `${cleanCompanyPart} LLC`;
          } else {
            finalName = cleanCompanyPart + ' LLC';
          }
        }
      }
      
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

  // Deduplication
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

// Standard extraction function
function extractCompanyNames(text) {
  console.log('🔍 Extracting company names (standard method)...');
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();

  const excludePatterns = [
    /articles?\s+of\s+incorporation\s+for/i,
    /certificate\s+of\s+formation\s+for/i,
    /bylaws?\s+of\s+the/i,
    /operating\s+agreement\s+of/i,
  ];

  const patterns = [
    {
      name: 'Articles LLC Format',
      regex: /(?:name\s+of\s+the\s+limited\s+liability\s+company\s+is\s*:?\s*)([A-Za-z][A-Za-z\s&\.\-',]{2,50}(?:\s*,?\s*LLC))/gi,
      confidence: 60
    },
    {
      name: 'Standard LLC',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 45
    },
    {
      name: 'Professional LLC (PLLC)',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(PLLC|P\.L\.L\.C\.)\b/g,
      confidence: 50
    },
    {
      name: 'Standard Corporation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
      confidence: 45
    }
  ];

  const foundNames = [];

  patterns.forEach((pattern) => {
    let match;
    let matchCount = 0;
    
    while ((match = pattern.regex.exec(cleanText)) !== null && matchCount < 10) {
      matchCount++;
      const fullMatch = match[0];
      const companyNamePart = match[1];
      
      const isExcluded = excludePatterns.some(excludePattern => 
        excludePattern.test(fullMatch)
      );
      
      if (isExcluded) continue;
      
      const cleanName = companyNamePart.trim().replace(/\s+/g, ' ').replace(/[^\w\s&\.\-',]/g, '').trim();
      
      if (cleanName.length >= 2 && cleanName.length <= 70 && /^[A-Z]/.test(cleanName) &&
          !/^\d+$/.test(cleanName) && !/(^article|^certificate)/i.test(cleanName)) {
        
        let entityType = 'LLC';
        if (/\b(PLLC|P\.L\.L\.C\.)\b/i.test(fullMatch)) entityType = 'PLLC';
        else if (/\b(Inc\.?|Incorporated)\b/i.test(fullMatch)) entityType = 'Inc.';
        else if (/\b(Corp\.?|Corporation)\b/i.test(fullMatch)) entityType = 'Corp.';
        
        const finalName = entityType && !cleanName.toLowerCase().includes(entityType.toLowerCase()) 
          ? `${cleanName} ${entityType}` : cleanName;
        
        const confidence = calculateConfidence(fullMatch, cleanText, pattern.confidence, cleanName);
        
        foundNames.push({
          name: finalName,
          confidence: confidence,
          patternName: pattern.name,
          originalMatch: fullMatch,
          context: getContext(cleanText, fullMatch)
        });
      }
    }
    
    pattern.regex.lastIndex = 0;
  });

  const uniqueNames = foundNames.reduce((acc, current) => {
    const normalizedCurrentName = current.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
    const existing = acc.find(item => {
      const normalizedExistingName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/llc|inc|corp|company|ltd|llp|pllc/g, '');
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

// OCR debug endpoint (only if dependencies available)
if (ocrAvailable) {
  app.post('/api/debug-ocr', upload.single('document'), async (req, res) => {
    try {
      console.log('🔍 DEBUG: OCR-specific analysis');
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

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
        
        const companyNames = extractCompanyNamesEnhanced(ocrText);
        results.extractionResults = companyNames;
        
      } catch (error) {
        results.ocrResults = {
          success: false,
          error: error.message
        };
      }

      results.processingTime = Date.now() - startTime;

      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        results: results,
        recommendation: results.extractionResults && results.extractionResults.length > 0 ? 
          'OCR successfully extracted company names!' : 
          'OCR extracted text but no company names found',
        processingTimeMs: results.processingTime
      });

    } catch (error) {
      console.error('❌ DEBUG: Error in OCR analysis:', error);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: error.message });
    }
  });
}

// Debug text endpoint
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
      containsBitConcepts: documentText.includes('BitConcepts'),
      containsPorvin: documentText.includes('PORVIN'),
      containsLLC: documentText.includes('LLC'),
      containsPLLC: documentText.includes('PLLC'),
      standardExtractionResults: standardResults,
      enhancedExtractionResults: enhancedResults,
      extractionComparison: {
        standardCount: standardResults.length,
        enhancedCount: enhancedResults.length,
        recommendation: enhancedResults.length > standardResults.length ? 'Use Enhanced' : 'Use Standard'
      },
      ocrStatus: ocrAvailable ? 'Available' : 'Not installed',
      note: ocrAvailable ? 'OCR support enabled' : 'Install OCR dependencies for scanned PDF support'
    });

  } catch (error) {
    console.error('❌ DEBUG: Error extracting text:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    const isScannedPdfError = error.message.includes('scanned') || error.message.includes('OCR');
    
    res.status(500).json({ 
      error: error.message,
      troubleshooting: isScannedPdfError && !ocrAvailable ? [
        'This appears to be a scanned PDF',
        'Install OCR dependencies: npm install tesseract.js pdf2pic sharp',
        'Convert to DOCX using Adobe Acrobat or Google Docs',
        'Use online OCR services',
        'Manual text entry'
      ] : [
        'Try converting to DOCX format',
        'Check if document is password protected',
        'Ensure file is not corrupted'
      ]
    });
  }
});

// Extract multiple options endpoint
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
      
      const isScannedError = documentText.length < 50;
      
      return res.status(400).json({ 
        error: 'Could not extract any company names from document.',
        extractedText: documentText.substring(0, 1000) + '...',
        suggestion: 'Try the debug endpoints to analyze text extraction:',
        debugEndpoints: {
          textAnalysis: `${req.protocol}://${req.get('host')}/api/debug-text`,
          ...(ocrAvailable && { ocrAnalysis: `${req.protocol}://${req.get('host')}/api/debug-ocr` })
        },
        troubleshooting: isScannedError && !ocrAvailable ? [
          'This appears to be a scanned PDF requiring OCR',
          'Install OCR dependencies: npm install tesseract.js pdf2pic sharp',
          'Convert to DOCX using Adobe Acrobat',
          'Use online OCR services'
        ] : [
          'Check if document contains company names with entity types (LLC, Inc., etc.)',
          'Verify document is not password protected',
          'Try converting to DOCX format'
        ],
        ocrStatus: ocrAvailable ? 'Available' : 'Not installed'
      });
    }

    console.log(`📋 Returning ${companyOptions.length} company options to client`);
    res.json({
      success: true,
      filename: req.file.originalname,
      documentLength: documentText.length,
      companyOptions: companyOptions,
      extractionMethod: `Enhanced multi-pattern content analysis v3.2.1${ocrAvailable ? ' with OCR support' : ''}`,
      ocrAvailable: ocrAvailable
    });

  } catch (error) {
    console.error('❌ Extract names error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    const isScannedError = error.message.includes('scanned') || error.message.includes('OCR');
    
    res.status(500).json({ 
      error: error.message,
      troubleshooting: isScannedError && !ocrAvailable ? [
        'This appears to be a scanned PDF',
        'Install OCR: npm install tesseract.js pdf2pic sharp',
        'Convert to DOCX format',
        'Use online OCR services'
      ] : [
        'Try converting document to DOCX format',
        'Check if document is corrupted or password protected'
      ],
      ocrStatus: ocrAvailable ? 'Available' : 'Not installed'
    });
  }
});

// Update company endpoint
app.post('/api/update-company', async (req, res) => {
  try {
    const { companyId, companyName } = req.body;
    
    if (!companyId || !companyName) {
      return res.status(400).json({ error: 'Company ID and name are required' });
    }

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

// Legacy endpoint
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
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
        extractedText: documentText.substring(0, 1000) + '...'
      });
    }

    const bestOption = companyOptions[0];
    await updateHubSpotCompany(companyId, bestOption.name);

    res.json({
      success: true,
      extractedName: bestOption.name,
      companyId: companyId,
      filename: req.file.originalname,
      allOptions: companyOptions
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
    message: `BT Company Extractor API v3.2.1${ocrAvailable ? ' with OCR Support' : ' (OCR Ready)'}`,
    version: '3.2.1',
    timestamp: new Date().toISOString(),
    features: [
      `${ocrAvailable ? 'OCR support enabled' : 'OCR ready (install dependencies)'}`,
      'Enhanced PDF text extraction with multiple fallback methods',
      'DOCX parsing', 
      'Multi-option company name detection',
      'Articles of Organization support',
      'PLLC entity recognition',
      'Enhanced extraction algorithms',
      'Comprehensive debug endpoints',
      'User selection interface',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'POST /api/extract-names - Extract company names',
      'POST /api/update-company - Update HubSpot',
      'POST /api/debug-text - Debug text extraction',
      ...(ocrAvailable ? ['POST /api/debug-ocr - Test OCR processing'] : []),
      'POST /api/upload-document - Legacy endpoint'
    ],
    ocrStatus: {
      available: ocrAvailable,
      message: ocrAvailable ? 'OCR dependencies loaded successfully' : 'Install with: npm install tesseract.js pdf2pic sharp',
      supportedFormats: ocrAvailable ? ['PDF (scanned)', 'PNG', 'JPEG'] : ['Not available']
    },
    env: {
      hasHubSpotToken: !!process.env.HUBSPOT_ACCESS_TOKEN,
      nodeVersion: process.version,
      platform: 'Render'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'BT Company Name Extractor API v3.2.1',
    status: ocrAvailable ? 'OCR-Enabled' : 'OCR-Ready (Install Dependencies)',
    description: 'Extract company names from documents with optional OCR support',
    features: [
      'Extract up to 5 company name options',
      'Enhanced PDF parsing with multiple fallback methods',
      'Articles of Organization support',
      'PLLC entity recognition',
      'User selection and editing interface',
      'HubSpot CRM integration',
      ...(ocrAvailable ? ['OCR for scanned PDFs', 'Image processing'] : ['OCR ready (install dependencies)'])
    ],
    ocrInstructions: ocrAvailable ? {
      status: 'Enabled',
      supportedFormats: ['PDF (scanned)', 'PNG', 'JPEG'],
      engine: 'Tesseract.js'
    } : {
      status: 'Install required',
      command: 'npm install tesseract.js pdf2pic sharp',
      note: 'OCR will automatically enable after installing dependencies'
    }
  });
});

app.use((error, req, res, next) => {
  console.error('❌ Global error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

app.listen(PORT, () => {
  console.log('🚀 BT Company Extractor v3.2.1 server started');
  console.log(`📍 Running on port ${PORT}`);
  console.log(`🔑 HubSpot token configured: ${!!process.env.HUBSPOT_ACCESS_TOKEN}`);
  console.log(`🔍 OCR Status: ${ocrAvailable ? 'ENABLED' : 'Install dependencies to enable'}`);
  console.log('🌐 Available endpoints:');
  console.log('   GET  /api/health');
  console.log('   POST /api/extract-names');
  console.log('   POST /api/update-company'); 
  console.log('   POST /api/debug-text');
  if (ocrAvailable) {
    console.log('   POST /api/debug-ocr');
  }
  console.log('   POST /api/upload-document (legacy)');
  
  if (!ocrAvailable) {
    console.log('');
    console.log('💡 To enable OCR for scanned PDFs:');
    console.log('   npm install tesseract.js pdf2pic sharp');
    console.log('   Then restart the server');
  }
});