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

// Simple company name extraction from filename
function extractCompanyName(filename) {
  // Extract company name patterns from filename
  const cleanName = filename.replace(/\.(pdf|docx?|txt)$/i, '');
  
  // Look for common company suffixes in filename
  const patterns = [
    /(.*?)\s*(LLC|Corp|Inc|Ltd|Company|Co)$/i,
    /(.+)/  // fallback to entire cleaned filename
  ];
  
  for (const pattern of patterns) {
    const match = cleanName.match(pattern);
    if (match && match[1] && match[1].trim().length > 2) {
      return match[1].trim() + (match[2] ? ` ${match[2]}` : ' LLC');
    }
  }
  
  return `${cleanName} LLC` || 'Test Company LLC';
}

// HubSpot API update using fetch
async function updateHubSpotCompany(companyId, companyName) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (!token) {
    throw new Error('HubSpot access token not configured');
  }

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
    throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Routes
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { companyId } = req.body;
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    console.log('File uploaded:', req.file.originalname);
    console.log('Company ID:', companyId);

    // Extract company name from filename (simple version)
    const companyName = extractCompanyName(req.file.originalname);
    
    console.log('Extracted company name:', companyName);

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
      hubspotResponse: updatedCompany ? 'Updated successfully' : 'Update completed',
      note: "Extracting from filename - PDF parsing coming soon!"
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
    message: 'BT Company Extractor API is running on Render!',
    timestamp: new Date().toISOString(),
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
    message: 'BT Company Name Extractor API',
    status: 'Running on Render',
    endpoints: [
      'GET /api/health - Health check',
      'POST /api/upload-document - Extract company name from document'
    ],
    usage: 'Upload a document with company name in filename for extraction'
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
});