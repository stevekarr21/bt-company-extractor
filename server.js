const express = require('express');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Simplified company name extraction (no external libraries)
function extractCompanyNameSimple(filename) {
  // For now, we'll extract from filename or return a test name
  // This is a minimal version to get deployment working
  const testNames = [
    "Test Company LLC",
    "Sample Corporation", 
    "Demo Industries Inc.",
    "Example Solutions Ltd."
  ];
  
  return testNames[Math.floor(Math.random() * testNames.length)];
}

// Simple HubSpot update (using fetch instead of SDK)
async function updateHubSpotCompanySimple(companyId, companyName) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (!token) {
    throw new Error('HubSpot access token not configured');
  }

  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`, {
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
    const error = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${error}`);
  }

  return await response.json();
}

// Routes
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { companyId } = req.body;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    console.log('File uploaded:', req.file.originalname);

    // For now, use simple extraction (we'll add PDF parsing after deployment works)
    const companyName = extractCompanyNameSimple(req.file.originalname);
    
    console.log('Extracted company name:', companyName);

    // Update HubSpot company
    const updatedCompany = await updateHubSpotCompanySimple(companyId, companyName);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      extractedName: companyName,
      companyId: companyId,
      hubspotResponse: updatedCompany,
      note: "Using simplified extraction - PDF parsing will be added after deployment"
    });

  } catch (error) {
    console.error('Error processing document:', error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BT Company Extractor API is running',
    timestamp: new Date().toISOString(),
    env: {
      hasHubSpotToken: !!process.env.HUBSPOT_ACCESS_TOKEN,
      nodeVersion: process.version
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'BT Company Name Extractor API',
    status: 'Running',
    endpoints: [
      'GET /api/health - Health check',
      'POST /api/upload-document - Extract company name from document'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`BT Company Extractor server running on port ${PORT}`);
});