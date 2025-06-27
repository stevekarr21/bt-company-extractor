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
        const docBuffer = fs.readFileSync(filePath);
        text = docBuffer.toString('utf8').replace(/[^\x20-\x7E]/g, ' ');
        console.log('DOC text extracted (basic), length:', text.length);
        break;

      default:
        throw new Error('Unsupported file type');
    }

    text = text.replace(/\s+/g, ' ').trim();
    console.log('Cleaned text preview:', text.substring(0, 300) + '...');

    return text;
  } catch (error) {
    console.error('Error parsing document:', error);
    throw error;
  }
}

// Extract multiple company name options (Modified to return array)
function extractCompanyNames(text) {
  console.log('=== Starting company name extraction (multiple options) ===');
  console.log('Text preview:', text.substring(0, 500));
  
  if (!text || text.length < 5) {
    console.log('Text too short for extraction');
    return [];
  }

  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();

  // Exclude common legal document phrases
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

  // Comprehensive patterns for finding company names
  const patterns = [
    {
      name: 'Standard Entity Suffix',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 35
    },
    {
      name: 'Corporation Suffix',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
      confidence: 35
    },
    {
      name: 'Company Suffix',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Co\.?|Company)\b/g,
      confidence: 30
    },
    {
      name: 'Limited Suffix',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(Ltd\.?|Limited)\b/g,
      confidence: 30
    },
    {
      name: 'Partnership Suffix',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{1,50})\s*,?\s*(LLP|L\.L\.P\.)\b/g,
      confidence: 35
    },
    {
      name: 'Contract Between Pattern',
      regex: /\bbetween\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)\s+(?:and|&)/gi,
      confidence: 40
    },
    {
      name: 'State Corporation Pattern',
      regex: /\b([A-Z][A-Za-z\s&\.\-']+),?\s+a\s+\w+\s+(?:corporation|company|LLC|limited\s+liability\s+company)/gi,
      confidence: 45
    },
    {
      name: 'Agreement Made By Pattern',
      regex: /(?:agreement\s+(?:is\s+)?(?:made\s+)?by|entered\s+into\s+by)\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
      confidence: 40
    },
    {
      name: 'Invoice/From Pattern',
      regex: /(?:from|bill\s+to|invoice\s+from):\s*([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
      confidence: 35
    },
    {
      name: 'Named Field Pattern',
      regex: /(?:company\s+name|entity\s+name|corporation\s+name|business\s+name):\s*([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
      confidence: 50
    }
  ];

  const foundNames = [];

  patterns.forEach((pattern, index) => {
    console.log(`Testing pattern: ${pattern.name}...`);
    let match;
    
    while ((match = pattern.regex.exec(cleanText)) !== null) {
      const fullMatch = match[0];
      const companyNamePart = match[1];
      
      console.log(`${pattern.name} found:`, fullMatch);
      
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
          !/^\d+$/.test(cleanName) &&
          !/(article|certificate|bylaw|agreement|policy|license|terms|whereas|therefore)/i.test(cleanName)) {
        
        // Determine entity type
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

  // Remove duplicates and sort by confidence
  const uniqueNames = foundNames.reduce((acc, current) => {
    const existing = acc.find(item => 
      item.name.toLowerCase().replace(/[^a-z]/g, '') === 
      current.name.toLowerCase().replace(/[^a-z]/g, '')
    );
    if (!existing) {
      acc.push(current);
    } else if (current.confidence > existing.confidence) {
      const index = acc.indexOf(existing);
      acc[index] = current;
    }
    return acc;
  }, []);

  uniqueNames.sort((a, b) => b.confidence - a.confidence);
  
  console.log('All unique names found:', uniqueNames.map(f => 
    `${f.name} (${f.confidence}% - ${f.patternName})`
  ));
  
  // Return top 5 options
  return uniqueNames.slice(0, 5);
}

// Enhanced confidence calculation
function calculateConfidence(match, fullText, baseConfidence, cleanName) {
  let confidence = baseConfidence;
  
  // Boost for multiple occurrences
  const occurrences = (fullText.match(new RegExp(cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  confidence += Math.min(occurrences * 3, 15);
  
  // Boost if appears early in document
  const position = fullText.toLowerCase().indexOf(match.toLowerCase());
  if (position < 200) confidence += 10;
  else if (position < 500) confidence += 5;
  
  // Boost for reasonable name length
  const nameLength = cleanName.length;
  if (nameLength >= 5 && nameLength <= 30) confidence += 5;
  if (nameLength < 3) confidence -= 15;
  if (nameLength > 50) confidence -= 10;
  
  // Boost for common business words
  if /(solutions|services|systems|technologies|consulting|industries|enterprises|group|partners)/i.test(cleanName)) {
    confidence += 3;
  }
  
  return Math.min(confidence, 100);
}

// Get context around the match
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

// Step 1: Extract company names from document (returns options)
app.post('/api/extract-names', upload.single('document'), async (req, res) => {
  try {
    console.log('=== Extract names request ===');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File info:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Parse the document to extract text
    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    
    if (!documentText) {
      throw new Error('Could not extract text from document');
    }

    // Extract multiple company name options
    const companyOptions = extractCompanyNames(documentText);
    
    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    if (companyOptions.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract any company names from document. Please ensure the document contains company names with legal entity types (LLC, Inc., Corp., etc.)',
        extractedText: documentText.substring(0, 1000) + '...',
        suggestion: 'Make sure your document contains text like "Acme Corporation" or "Tech Solutions LLC"'
      });
    }

    res.json({
      success: true,
      filename: req.file.originalname,
      documentLength: documentText.length,
      companyOptions: companyOptions,
      extractionMethod: 'Advanced PDF content analysis with multiple pattern matching'
    });

  } catch (error) {
    console.error('Error extracting names:', error);
    
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

// Step 2: Update HubSpot with selected/edited company name
app.post('/api/update-company', async (req, res) => {
  try {
    console.log('=== Update company request ===');
    
    const { companyId, companyName } = req.body;
    
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }
    
    if (!companyName) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    console.log('Updating company:', companyId, 'with name:', companyName);

    // Update HubSpot company
    const updatedCompany = await updateHubSpotCompany(companyId, companyName);

    res.json({
      success: true,
      companyId: companyId,
      updatedName: companyName,
      hubspotResponse: 'Updated successfully',
      message: `Successfully updated company ${companyId} with name "${companyName}"`
    });

  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Legacy endpoint for backward compatibility
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    console.log('=== Legacy upload request - redirecting to new flow ===');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { companyId } = req.body;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    const companyOptions = extractCompanyNames(documentText);
    
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    if (companyOptions.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract company names',
        extractedText: documentText.substring(0, 1000) + '...'
      });
    }

    // For legacy compatibility, just return the best option
    const bestOption = companyOptions[0];
    const updatedCompany = await updateHubSpotCompany(companyId, bestOption.name);

    res.json({
      success: true,
      extractedName: bestOption.name,
      companyId: companyId,
      filename: req.file.originalname,
      hubspotResponse: 'Updated successfully',
      allOptions: companyOptions,
      note: 'Used best match. Consider using the new selection interface for better control.'
    });

  } catch (error) {
    console.error('Error in legacy upload:', error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BT Company Extractor API with multi-option selection is running!',
    timestamp: new Date().toISOString(),
    features: [
      'PDF text extraction',
      'DOCX parsing', 
      'Multiple company name detection',
      'User selection interface',
      'Edit capability',
      'HubSpot integration'
    ],
    endpoints: [
      'POST /api/extract-names - Extract multiple company name options',
      'POST /api/update-company - Update HubSpot with selected name',
      'POST /api/upload-document - Legacy single-step endpoint'
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
    message: 'BT Company Name Extractor API with Multi-Option Selection',
    status: 'Running on Render',
    version: '3.0.0',
    features: [
      'Extract multiple company name candidates',
      'User selection and editing interface',
      'Confidence scoring and ranking',
      'Advanced pattern matching',
      'HubSpot CRM integration'
    ]
  });
});

app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

app.listen(PORT, () => {
  console.log(`BT Company Extractor server running on port ${PORT}`);
  console.log('Features: Multi-option extraction, user selection, editing capability');
});