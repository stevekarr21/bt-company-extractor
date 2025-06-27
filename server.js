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

console.log('🚀 Starting BT Company Extractor v3.1.0 with Fixed Articles Extraction');

// Middleware
app.use(cors());
app.use(express.json());

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
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
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// Parse document content
async function parseDocument(filePath, mimetype) {
  try {
    let text = '';
    console.log('📄 Parsing document:', path.basename(filePath), 'Type:', mimetype);

    switch (mimetype) {
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
        const docBuffer = fs.readFileSync(filePath);
        text = docBuffer.toString('utf8').replace(/[^\x20-\x7E]/g, ' ');
        break;
      default:
        throw new Error('Unsupported file type');
    }

    text = text.replace(/\s+/g, ' ').trim();
    console.log(`📝 Extracted ${text.length} characters from document`);
    return text;
  } catch (error) {
    console.error('❌ Error parsing document:', error);
    throw error;
  }
}

// IMPROVED: Extract multiple company name options with fixed Articles of Organization handling
function extractCompanyNames(text) {
  console.log('🔍 Extracting company names (v3.1.0 - Fixed Articles Extraction)...');
  console.log('📄 Document preview:', text.substring(0, 800));
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();

  // FIXED: More specific exclusion patterns that won't filter entire documents
  const excludePatterns = [
    /articles?\s+of\s+incorporation\s+for/i,  // More specific
    /certificate\s+of\s+formation\s+for/i,    // More specific
    /bylaws?\s+of\s+the/i,                    // More specific
    /operating\s+agreement\s+of/i,            // More specific
    /memorandum\s+of\s+understanding\s+between/i, // More specific
    /terms?\s+of\s+service\s+agreement/i,     // More specific
    /privacy\s+policy\s+of/i                  // More specific
  ];

  // ENHANCED: More comprehensive patterns including PLLC and Articles format
  const patterns = [
    {
      name: 'Articles LLC Format',
      regex: /(?:name\s+of\s+the\s+limited\s+liability\s+company\s+is\s*:?\s*)([A-Za-z][A-Za-z\s&\.\-',]{2,50}(?:\s*,?\s*LLC))/gi,
      confidence: 55
    },
    {
      name: 'Articles Corporation Format', 
      regex: /(?:name\s+of\s+the\s+corporation\s+is\s*:?\s*)([A-Za-z][A-Za-z\s&\.\-',]{2,50}(?:\s*,?\s*(?:Inc\.?|Corp\.?|Corporation)))/gi,
      confidence: 55
    },
    {
      name: 'Standard LLC',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 40
    },
    {
      name: 'Standard Corporation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
      confidence: 40
    },
    {
      name: 'Professional LLC (PLLC)',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(PLLC|P\.L\.L\.C\.)\b/g,
      confidence: 45
    },
    {
      name: 'Company',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Co\.?|Company)\b/g,
      confidence: 35
    },
    {
      name: 'Limited',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Ltd\.?|Limited)\b/g,
      confidence: 35
    },
    {
      name: 'Partnership',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLP|L\.L\.P\.)\b/g,
      confidence: 40
    },
    {
      name: 'Contract Between',
      regex: /\bbetween\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP|PLLC))?)\s+(?:and|&)/gi,
      confidence: 45
    },
    {
      name: 'State Entity Formation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']+),?\s+a\s+\w+\s+(?:corporation|company|LLC|limited\s+liability\s+company)/gi,
      confidence: 50
    },
    {
      name: 'Agreement Pattern',
      regex: /(?:agreement\s+(?:made\s+)?by|entered\s+into\s+by)\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP|PLLC))?)/gi,
      confidence: 45
    },
    {
      name: 'Prepared By Pattern',
      regex: /(?:prepared\s+by\s*:?\s*)([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP|PLLC)))/gi,
      confidence: 40
    },
    {
      name: 'Law Firm Pattern',
      regex: /\b([A-Z][A-Za-z\s&\.\-',]+)\s*,?\s*(PLLC|P\.L\.L\.C\.)\b/g,
      confidence: 45
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
      
      // Check exclusions - but only exclude if the FULL MATCH contains the excluded phrase
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
      
      // Enhanced validation
      if (cleanName.length >= 2 && 
          cleanName.length <= 70 && 
          /^[A-Z]/.test(cleanName) &&
          !/^\d+$/.test(cleanName) &&
          !/(^article|^certificate|^bylaw|^whereas|^therefore|department\s+of)/i.test(cleanName)) {
        
        // Enhanced entity type detection
        let entityType = '';
        if (/\b(LLC|L\.L\.C\.)\b/i.test(fullMatch)) {
          entityType = 'LLC';
        } else if (/\b(PLLC|P\.L\.L\.C\.)\b/i.test(fullMatch)) {
          entityType = 'PLLC';
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
      } else {
        console.log(`❌ Invalid name: "${cleanName}" (length: ${cleanName.length})`);
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
  
  console.log(`🎯 Final results: ${uniqueNames.length} unique company names found`);
  uniqueNames.forEach((name, index) => {
    console.log(`${index + 1}. "${name.name}" (${name.confidence}% - ${name.patternName})`);
  });
  
  return uniqueNames.slice(0, 5);
}

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

// NEW: Extract multiple options endpoint
app.post('/api/extract-names', upload.single('document'), async (req, res) => {
  try {
    console.log('📥 Extract names request received');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 Processing file:', req.file.originalname, `(${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    const companyOptions = extractCompanyNames(documentText);
    
    // Cleanup
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    if (companyOptions.length === 0) {
      console.log('❌ No company names found in document');
      return res.status(400).json({ 
        error: 'Could not extract any company names from document. Please ensure the document contains company names with legal entity types (LLC, Inc., Corp., PLLC, etc.)',
        extractedText: documentText.substring(0, 1000) + '...',
        suggestion: 'Make sure your document contains text like "Acme Corporation" or "Tech Solutions LLC"'
      });
    }

    console.log(`📋 Returning ${companyOptions.length} company options to client`);
    res.json({
      success: true,
      filename: req.file.originalname,
      documentLength: documentText.length,
      companyOptions: companyOptions,
      extractionMethod: 'Advanced multi-pattern PDF content analysis v3.1.0'
    });

  } catch (error) {
    console.error('❌ Extract names error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// NEW: Update company with selected name
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
    const companyOptions = extractCompanyNames(documentText);
    
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    if (companyOptions.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract company names',
        extractedText: documentText.substring(0, 1000) + '...'
      });
    }

    // Auto-select best option for legacy support
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
    message: 'BT Company Extractor API v3.1.0 with Fixed Articles Extraction is running!',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    features: [
      'PDF text extraction',
      'DOCX parsing', 
      'Multi-option company name detection',
      'Articles of Organization support',
      'PLLC entity recognition',
      'User selection interface',
      'Edit capability',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'POST /api/extract-names - Extract multiple company name options',
      'POST /api/update-company - Update HubSpot with selected name',
      'POST /api/upload-document - Legacy auto-update endpoint'
    ],
    improvements: [
      'Fixed Articles of Organization document parsing',
      'Added PLLC entity type support',
      'Enhanced exclusion patterns',
      'Better deduplication logic',
      'Improved debug logging'
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
    message: 'BT Company Name Extractor API v3.1.0',
    status: 'Multi-Option Selection with Articles Support',
    description: 'Extract multiple company name candidates from various document types including Articles of Organization',
    features: [
      'Extract up to 5 company name options',
      'Support for Articles of Organization documents',
      'PLLC entity type recognition',
      'Confidence scoring and ranking',
      'User selection and editing interface',
      'Advanced pattern matching with 13+ patterns',
      'Enhanced exclusion logic',
      'HubSpot CRM integration'
    ],
    supportedDocuments: [
      'Articles of Organization (LLC)',
      'Articles of Incorporation (Corp)',
      'Operating Agreements',
      'Service Agreements',
      'Invoices and Contracts',
      'Legal Documents'
    ],
    supportedEntityTypes: [
      'LLC', 'L.L.C.',
      'PLLC', 'P.L.L.C.',
      'Inc.', 'Incorporated',
      'Corp.', 'Corporation',
      'Company', 'Co.',
      'Ltd.', 'Limited',
      'LLP', 'L.L.P.'
    ]
  });
});

app.use((error, req, res, next) => {
  console.error('❌ Global error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

app.listen(PORT, () => {
  console.log('🚀 BT Company Extractor v3.1.0 server started');
  console.log(`📍 Running on port ${PORT}`);
  console.log(`🔑 HubSpot token configured: ${!!process.env.HUBSPOT_ACCESS_TOKEN}`);
  console.log('✨ Features: Multi-option extraction, Articles support, PLLC recognition, user selection');
  console.log('🌐 Available endpoints:');
  console.log('   GET  /api/health');
  console.log('   POST /api/extract-names');
  console.log('   POST /api/update-company');
  console.log('   POST /api/upload-document (legacy)');
  console.log('📋 Supported: Articles of Organization, PLLC entities, enhanced exclusions');
});