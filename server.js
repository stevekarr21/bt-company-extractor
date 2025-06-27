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
    console.log('Cleaned text preview:', text.substring(0, 200) + '...');

    return text;
  } catch (error) {
    console.error('Error parsing document:', error);
    throw error;
  }
}

// Extract company name from document text using regex patterns
function extractCompanyName(text) {
  console.log('Extracting company name from text...');
  
  if (!text || text.length < 5) {
    console.log('Text too short for extraction');
    return null;
  }

  // Define comprehensive patterns for company legal entities
  const patterns = [
    // LLC variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:LLC|L\.L\.C\.|Limited Liability Company)\b/gi,
    
    // Corporation variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:Corp\.|Corporation|Inc\.|Incorporated)\b/gi,
    
    // Company variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:Co\.|Company)\b/gi,
    
    // Limited variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:Ltd\.|Limited)\b/gi,
    
    // Partnership variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:LLP|L\.L\.P\.|Limited Liability Partnership)\b/gi,
    
    // LP variations
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:LP|L\.P\.|Limited Partnership)\b/gi,
    
    // Professional Corporation
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:PC|P\.C\.|Professional Corporation)\b/gi,
    
    // Professional Limited Liability Company
    /([A-Za-z][A-Za-z\s&\.\-,]{2,50}),?\s*(?:PLLC|P\.L\.L\.C\.|Professional Limited Liability Company)\b/gi
  ];

  const foundNames = [];

  patterns.forEach((pattern, index) => {
    const matches = text.match(pattern);
    if (matches) {
      console.log(`Pattern ${index + 1} found ${matches.length} matches:`, matches.slice(0, 3));
      
      matches.forEach(match => {
        // Clean up the match
        const cleanMatch = match.trim()
          .replace(/\s+/g, ' ')
          .replace(/[^\w\s&\.\-,]/g, '')
          .trim();
        
        // Extract just the company name part (before the entity type)
        const namePart = cleanMatch.replace(/,?\s*(?:LLC|L\.L\.C\.|Limited Liability Company|Corp\.|Corporation|Inc\.|Incorporated|Co\.|Company|Ltd\.|Limited|LLP|L\.L\.P\.|Limited Liability Partnership|LP|L\.P\.|Limited Partnership|PC|P\.C\.|Professional Corporation|PLLC|P\.L\.L\.C\.|Professional Limited Liability Company)\b.*/i, '').trim();
        
        // Validate the extracted name
        if (namePart.length >= 2 && namePart.length <= 80 && /^[A-Za-z]/.test(namePart)) {
          // Reconstruct with clean entity type
          let entityType = 'LLC'; // default
          if (/\b(?:Corp\.|Corporation|Inc\.|Incorporated)\b/i.test(cleanMatch)) {
            entityType = 'Inc.';
          } else if (/\b(?:Co\.|Company)\b/i.test(cleanMatch)) {
            entityType = 'Company';
          } else if (/\b(?:Ltd\.|Limited)\b/i.test(cleanMatch)) {
            entityType = 'Ltd.';
          } else if (/\b(?:LLP|L\.L\.P\.|Limited Liability Partnership)\b/i.test(cleanMatch)) {
            entityType = 'LLP';
          }
          
          const fullName = `${namePart} ${entityType}`;
          foundNames.push({
            name: fullName,
            confidence: calculateConfidence(cleanMatch, text),
            originalMatch: match
          });
        }
      });
    }
  });

  if (foundNames.length === 0) {
    console.log('No company names found in document');
    return null;
  }

  // Sort by confidence score and return the best match
  foundNames.sort((a, b) => b.confidence - a.confidence);
  
  console.log('Found company names:', foundNames.map(f => `${f.name} (${f.confidence})`));
  
  const bestMatch = foundNames[0];
  console.log('Selected best match:', bestMatch.name);
  
  return bestMatch.name;
}

// Calculate confidence score for extracted company name
function calculateConfidence(match, fullText) {
  let confidence = 50; // base score
  
  // Higher confidence if appears multiple times
  const occurrences = (fullText.match(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
  confidence += Math.min(occurrences * 10, 30);
  
  // Higher confidence if appears early in document
  const position = fullText.toLowerCase().indexOf(match.toLowerCase());
  if (position < 500) confidence += 20;
  else if (position < 1000) confidence += 10;
  
  // Higher confidence for common entity types
  if (/\b(?:LLC|Inc\.|Corporation|Company)\b/i.test(match)) {
    confidence += 15;
  }
  
  // Lower confidence for very long names
  if (match.length > 50) confidence -= 10;
  
  return Math.min(confidence, 100);
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
        extractedText: documentText.substring(0, 500) + '...' // Show preview for debugging
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
      extractionMethod: 'PDF/Document parsing with OCR'
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
    message: 'BT Company Extractor API with PDF parsing is running!',
    timestamp: new Date().toISOString(),
    features: [
      'PDF text extraction',
      'DOCX parsing', 
      'Company name pattern matching',
      'HubSpot integration'
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
    message: 'BT Company Name Extractor API with PDF Parsing',
    status: 'Running on Render',
    capabilities: [
      'Extract text from PDF files',
      'Parse DOCX documents', 
      'Intelligent company name detection',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'GET /api/health - Health check',
      'POST /api/upload-document - Extract company name from document'
    ]
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
  console.log('PDF parsing enabled with pdf-parse and mammoth');
});