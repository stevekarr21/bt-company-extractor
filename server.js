const express = require('express');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please use PDF, DOC, or DOCX files.'), false);
    }
  }
});

// Parse document content based on file type
async function parseDocument(filePath, mimetype) {
  try {
    let text = '';

    console.log('Parsing document:', filePath, 'Type:', mimetype);

    switch (mimetype) {
      case 'application/pdf':
        console.log('Parsing PDF...');
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdf(pdfBuffer);
        text = pdfData.text;
        console.log('PDF text extracted, length:', text.length);
        break;

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        console.log('Parsing DOCX...');
        const docxResult = await mammoth.extractRawText({ path: filePath });
        text = docxResult.value;
        console.log('DOCX text extracted, length:', text.length);
        break;

      case 'application/msword':
        console.log('Parsing DOC...');
        // For .doc files, try basic text extraction
        const docBuffer = fs.readFileSync(filePath);
        text = docBuffer.toString('utf8').replace(/[^\x20-\x7E]/g, ' ');
        console.log('DOC text extracted (basic), length:', text.length);
        break;

      default:
        throw new Error('Unsupported file type');
    }

    // Clean up the extracted text
    text = text.replace(/\s+/g, ' ').trim();
    console.log('Cleaned text preview:', text.substring(0, 300) + '...');

    return text;
  } catch (error) {
    console.error('Error parsing document:', error);
    throw error;
  }
}

// Enhanced company name extraction with improved patterns
function extractCompanyName(text) {
  console.log('=== Starting company name extraction ===');
  console.log('Text preview:', text.substring(0, 500));
  
  if (!text || text.length < 5) {
    console.log('Text too short for extraction');
    return null;
  }

  // Clean the text first
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();

  // Exclude common legal document phrases that aren't company names
  const excludePatterns = [
    /articles?\s+of\s+incorporation/i,
    /certificate\s+of\s+formation/i,
    /bylaws?\s+of/i,
    /operating\s+agreement/i,
    /articles?\s+of\s+organization/i,
    /memorandum\s+of\s+understanding/i,
    /terms?\s+of\s+service/i,
    /privacy\s+policy/i,
    /end\s+user\s+license/i,
    /limited\s+liability\s+company\s+agreement/i,
    /corporate\s+bylaws/i
  ];

  // More specific patterns to find actual company names
  const patterns = [
    // Pattern 1: Company name followed by entity type with word boundaries
    /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
    /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
    /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Co\.?|Company)\b/g,
    /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Ltd\.?|Limited)\b/g,
    /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(LLP|L\.L\.P\.)\b/g,
    
    // Pattern 2: Look for company names in specific contexts
    /(?:company\s+name|entity\s+name|corporation\s+name|business\s+name):\s*([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
    
    // Pattern 3: Look for "between [Company Name] and" patterns in contracts
    /\bbetween\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)\s+(?:and|&)/gi,
    
    // Pattern 4: Look for "[Company Name], a [state] corporation" patterns
    /\b([A-Z][A-Za-z\s&\.\-']+),?\s+a\s+\w+\s+(?:corporation|company|LLC|limited\s+liability\s+company)/gi,
    
    // Pattern 5: Letterhead or document header patterns (first few lines)
    /^([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP)))\s*$/gm,
    
    // Pattern 6: "This agreement is made by [Company Name]" patterns
    /(?:agreement\s+(?:is\s+)?(?:made\s+)?by|entered\s+into\s+by)\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
    
    // Pattern 7: Invoice/billing patterns
    /(?:from|bill\s+to|invoice\s+from):\s*([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi
  ];

  const foundNames = [];

  patterns.forEach((pattern, index) => {
    console.log(`Testing pattern ${index + 1}...`);
    let match;
    
    while ((match = pattern.exec(cleanText)) !== null) {
      const fullMatch = match[0];
      const companyNamePart = match[1];
      
      console.log(`Pattern ${index + 1} found:`, fullMatch);
      
      // Skip if it matches exclusion patterns
      const isExcluded = excludePatterns.some(excludePattern => 
        excludePattern.test(fullMatch)
      );
      
      if (isExcluded) {
        console.log('Excluded as common legal phrase:', fullMatch);
        continue;
      }
      
      // Clean up the company name part
      const cleanName = companyNamePart
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s&\.\-']/g, '')
        .trim();
      
      // Validate the name
      if (cleanName.length >= 2 && 
          cleanName.length <= 60 && 
          /^[A-Z]/.test(cleanName) &&
          !/^\d+$/.test(cleanName) && // Not just numbers
          !/(article|certificate|bylaw|agreement|policy|license|terms|whereas|whereas|therefore)/i.test(cleanName)) {
        
        // Determine entity type from full match or add default
        let entityType = '';
        if (/\b(LLC|L\.L\.C\.)\b/i.test(fullMatch)) {
          entityType = 'LLC';
        } else if (/\b(Inc\.?|Incorporated)\b/i.test(fullMatch)) {
          entityType = 'Inc.';
        } else if (/\b(Corp\.?|Corporation)\b/i.test(fullMatch)) {
          entityType = 'Corp.';
        } else if (/\b(Co\.?|Company)\b/i.test(fullMatch)) {
          entityType = 'Company';
        } else if (/\b(Ltd\.?|Limited)\b/i.test(fullMatch)) {
          entityType = 'Ltd.';
        } else if (/\b(LLP|L\.L\.P\.)\b/i.test(fullMatch)) {
          entityType = 'LLP';
        } else {
          entityType = 'LLC'; // Default
        }
        
        const finalName = entityType && !cleanName.includes(entityType) 
          ? `${cleanName} ${entityType}` 
          : cleanName;
        
        const confidence = calculateConfidence(fullMatch, cleanText, index, cleanName);
        
        foundNames.push({
          name: finalName,
          confidence: confidence,
          patternIndex: index,
          originalMatch: fullMatch,
          context: getContext(cleanText, fullMatch)
        });
      }
    }
    
    // Reset regex for next iteration
    pattern.lastIndex = 0;
  });

  if (foundNames.length === 0) {
    console.log('No company names found. Attempting fallback extraction...');
    
    // Fallback: Look for any capitalized words followed by common suffixes
    const fallbackPattern = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(LLC|Inc\.?|Corp\.?|Corporation|Company|Ltd\.?|Limited|LLP)\b/g;
    let fallbackMatch;
    
    while ((fallbackMatch = fallbackPattern.exec(cleanText)) !== null) {
      const name = `${fallbackMatch[1]} ${fallbackMatch[2]}`;
      const isExcluded = excludePatterns.some(pattern => pattern.test(name));
      
      if (!isExcluded && fallbackMatch[1].length > 2) {
        foundNames.push({
          name: name,
          confidence: 30, // Lower confidence for fallback
          patternIndex: 99,
          originalMatch: fallbackMatch[0],
          context: 'Fallback extraction'
        });
        break; // Just take the first fallback match
      }
    }
  }

  if (foundNames.length === 0) {
    console.log('No company names found in document');
    return null;
  }

  // Remove duplicates and sort by confidence
  const uniqueNames = foundNames.reduce((acc, current) => {
    const existing = acc.find(item => item.name.toLowerCase() === current.name.toLowerCase());
    if (!existing) {
      acc.push(current);
    } else if (current.confidence > existing.confidence) {
      // Replace with higher confidence version
      const index = acc.indexOf(existing);
      acc[index] = current;
    }
    return acc;
  }, []);

  uniqueNames.sort((a, b) => b.confidence - a.confidence);
  
  console.log('All found names:', uniqueNames.map(f => 
    `${f.name} (confidence: ${f.confidence}, pattern: ${f.patternIndex})`
  ));
  
  const bestMatch = uniqueNames[0];
  console.log('Selected best match:', bestMatch.name, 'with confidence:', bestMatch.confidence);
  
  return bestMatch.name;
}

// Enhanced confidence calculation
function calculateConfidence(match, fullText, patternIndex, cleanName) {
  let confidence = 40; // Base score
  
  // Pattern-specific confidence boosts
  switch(patternIndex) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
      confidence += 30; // Standard entity patterns
      break;
    case 5:
      confidence += 25; // Named field patterns
      break;
    case 6:
      confidence += 35; // Contract "between X and Y" patterns
      break;
    case 7:
      confidence += 40; // "[Company], a [state] corporation" patterns
      break;
    case 8:
      confidence += 20; // Header patterns
      break;
    case 9:
      confidence += 30; // Agreement patterns
      break;
    case 10:
      confidence += 25; // Invoice patterns
      break;
  }
  
  // Boost for multiple occurrences
  const occurrences = (fullText.match(new RegExp(cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  confidence += Math.min(occurrences * 5, 20);
  
  // Boost if appears early in document
  const position = fullText.toLowerCase().indexOf(match.toLowerCase());
  if (position < 200) confidence += 15;
  else if (position < 500) confidence += 10;
  else if (position < 1000) confidence += 5;
  
  // Boost for reasonable name length
  const nameLength = cleanName.length;
  if (nameLength >= 5 && nameLength <= 30) confidence += 10;
  if (nameLength < 3) confidence -= 20;
  if (nameLength > 50) confidence -= 15;
  
  // Boost for common business words
  if /(solutions|services|systems|technologies|consulting|industries|enterprises|group|partners)/i.test(cleanName)) {
    confidence += 5;
  }
  
  return Math.min(confidence, 100);
}

// Get context around the match for debugging
function getContext(text, match) {
  const index = text.indexOf(match);
  if (index === -1) return '';
  
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + match.length + 50);
  
  return text.substring(start, end);
}

// HubSpot API update using fetch
async function updateHubSpotCompany(companyId, companyName) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (!token) {
    throw new Error('HubSpot access token not configured');
  }

  console.log('Updating HubSpot company:', companyId, 'with name:', companyName);

  const url = `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        name: companyName
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('HubSpot API error:', response.status, errorText);
    throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  console.log('HubSpot update successful');
  return result;
}

// Routes
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    console.log('=== New document upload request ===');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { companyId } = req.body;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    console.log('File info:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    console.log('Company ID:', companyId);

    // Parse the document to extract text
    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    
    if (!documentText) {
      throw new Error('Could not extract text from document');
    }

    // Extract company name from the document text
    const companyName = extractCompanyName(documentText);
    
    if (!companyName) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.status(400).json({ 
        error: 'Could not extract company name from document. Please ensure the document contains a company name with legal entity type (LLC, Inc., Corp., etc.)',
        extractedText: documentText.substring(0, 1000) + '...', // Show preview for debugging
        suggestion: 'Make sure your document contains text like "Acme Corporation" or "Tech Solutions LLC"'
      });
    }

    console.log('Final extracted company name:', companyName);

    // Update HubSpot company
    const updatedCompany = await updateHubSpotCompany(companyId, companyName);

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({
      success: true,
      extractedName: companyName,
      companyId: companyId,
      filename: req.file.originalname,
      hubspotResponse: 'Updated successfully',
      documentLength: documentText.length,
      extractionMethod: 'PDF content analysis with intelligent pattern matching',
      note: `Analyzed ${documentText.length} characters of document content using advanced company name detection patterns`
    });

  } catch (error) {
    console.error('Error processing document:', error);
    
    // Clean up file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BT Company Extractor API with advanced PDF parsing is running!',
    timestamp: new Date().toISOString(),
    features: [
      'PDF text extraction with pdf-parse',
      'DOCX parsing with mammoth', 
      'Advanced company name pattern matching',
      'Legal document phrase exclusion',
      'Context-aware confidence scoring',
      'HubSpot CRM integration'
    ],
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
    message: 'BT Company Name Extractor API with Advanced PDF Parsing',
    status: 'Running on Render',
    capabilities: [
      'Extract text from PDF files using OCR-like parsing',
      'Parse DOCX documents completely', 
      'Intelligent company name detection with 10+ patterns',
      'Exclude common legal document phrases',
      'Confidence-based name selection',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'GET /api/health - Health check',
      'POST /api/upload-document - Extract company name from document'
    ],
    version: '2.0.0'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

app.listen(PORT, () => {
  console.log(`BT Company Extractor server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`HubSpot token configured: ${!!process.env.HUBSPOT_ACCESS_TOKEN}`);
  console.log('Advanced PDF parsing enabled with comprehensive pattern matching');
  console.log('Features: PDF parsing, DOCX support, intelligent name extraction, legal phrase exclusion');
});