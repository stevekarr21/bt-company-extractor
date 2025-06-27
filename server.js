// server.js - Version 3.0.0 - Multi-Option Selection
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

console.log('🚀 Starting BT Company Extractor v3.0.0 with Multi-Option Selection');

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

// Extract multiple company name options
function extractCompanyNames(text) {
  console.log('🔍 Extracting company names (multi-option mode)...');
  
  if (!text || text.length < 5) return [];

  const cleanText = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();

  // Exclusion patterns
  const excludePatterns = [
    /articles?\s+of\s+incorporation/i,
    /certificate\s+of\s+formation/i,
    /bylaws?\s+of/i,
    /operating\s+agreement/i,
    /memorandum\s+of\s+understanding/i,
    /terms?\s+of\s+service/i,
    /privacy\s+policy/i
  ];

  // Comprehensive patterns
  const patterns = [
    {
      name: 'Standard LLC',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(LLC|L\.L\.C\.)\b/g,
      confidence: 40
    },
    {
      name: 'Corporation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']{2,50})\s*,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?)\b/g,
      confidence: 40
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
      regex: /\bbetween\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)\s+(?:and|&)/gi,
      confidence: 45
    },
    {
      name: 'State Corporation',
      regex: /\b([A-Z][A-Za-z\s&\.\-']+),?\s+a\s+\w+\s+(?:corporation|company|LLC)/gi,
      confidence: 50
    },
    {
      name: 'Agreement Pattern',
      regex: /(?:agreement\s+(?:made\s+)?by|entered\s+into\s+by)\s+([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
      confidence: 45
    },
    {
      name: 'Invoice Pattern',
      regex: /(?:from|bill\s+to|invoice\s+from):\s*([A-Z][A-Za-z\s&\.\-']+(?:\s+(?:LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLP))?)/gi,
      confidence: 40
    }
  ];

  const foundNames = [];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.regex.exec(cleanText)) !== null) {
      const fullMatch = match[0];
      const companyNamePart = match[1];
      
      // Skip exclusions
      if (excludePatterns.some(excludePattern => excludePattern.test(fullMatch))) continue;
      
      const cleanName = companyNamePart.trim().replace(/\s+/g, ' ').replace(/[^\w\s&\.\-']/g, '').trim();
      
      // Validate
      if (cleanName.length >= 2 && 
          cleanName.length <= 60 && 
          /^[A-Z]/.test(cleanName) &&
          !/^\d+$/.test(cleanName) &&
          !/(article|certificate|bylaw|agreement|policy|terms|whereas)/i.test(cleanName)) {
        
        // Determine entity type
        let entityType = '';
        if (/\b(LLC|L\.L\.C\.)\b/i.test(fullMatch)) entityType = 'LLC';
        else if (/\b(Inc\.?|Incorporated)\b/i.test(fullMatch)) entityType = 'Inc.';
        else if (/\b(Corp\.?|Corporation)\b/i.test(fullMatch)) entityType = 'Corp.';
        else if (/\b(Co\.?|Company)\b/i.test(fullMatch)) entityType = 'Company';
        else if (/\b(Ltd\.?|Limited)\b/i.test(fullMatch)) entityType = 'Ltd.';
        else if (/\b(LLP|L\.L\.P\.)\b/i.test(fullMatch)) entityType = 'LLP';
        else entityType = 'LLC';
        
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

  // Remove duplicates and sort
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
  console.log(`🎯 Found ${uniqueNames.length} unique company names`);
  
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

    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    const companyOptions = extractCompanyNames(documentText);
    
    // Cleanup
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    if (companyOptions.length === 0) {
      return res.status(400).json({ 
        error: 'Could not extract any company names from document',
        extractedText: documentText.substring(0, 1000) + '...'
      });
    }

    console.log(`📋 Returning ${companyOptions.length} company options`);
    res.json({
      success: true,
      filename: req.file.originalname,
      documentLength: documentText.length,
      companyOptions: companyOptions,
      extractionMethod: 'Multi-option PDF content analysis'
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

    const updatedCompany = await updateHubSpotCompany(companyId, companyName);

    res.json({
      success: true,
      companyId: companyId,
      updatedName: companyName,
      hubspotResponse: 'Updated successfully'
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
    message: 'BT Company Extractor API v3.0.0 with Multi-Option Selection is running!',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    features: [
      'PDF text extraction',
      'DOCX parsing', 
      'Multi-option company name detection',
      'User selection interface',
      'Edit capability',
      'HubSpot CRM integration'
    ],
    endpoints: [
      'POST /api/extract-names - Extract multiple company name options',
      'POST /api/update-company - Update HubSpot with selected name',
      'POST /api/upload-document - Legacy auto-update endpoint'
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
    message: 'BT Company Name Extractor API v3.0.0',
    status: 'Multi-Option Selection Mode',
    description: 'Extract multiple company name candidates and let users select the best option',
    features: [
      'Extract up to 5 company name options',
      'Confidence scoring and ranking',
      'User selection and editing interface',
      'Advanced pattern matching',
      'HubSpot CRM integration'
    ]
  });
});

app.use((error, req, res, next) => {
  console.error('❌ Global error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

app.listen(PORT, () => {
  console.log('🚀 BT Company Extractor v3.0.0 server started');
  console.log(`📍 Running on port ${PORT}`);
  console.log(`🔑 HubSpot token configured: ${!!process.env.HUBSPOT_ACCESS_TOKEN}`);
  console.log('✨ Features: Multi-option extraction, user selection, editing capability');
  console.log('🌐 Available endpoints:');
  console.log('   GET  /api/health');
  console.log('   POST /api/extract-names');
  console.log('   POST /api/update-company');
  console.log('   POST /api/upload-document (legacy)');
});