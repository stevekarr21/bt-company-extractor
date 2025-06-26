const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { parseDocument, extractCompanyName } = require('./utils/documentParser');
const { updateHubSpotCompany } = require('./utils/hubspotClient');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
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

    // Parse the document
    const documentText = await parseDocument(req.file.path, req.file.mimetype);
    
    // Extract company name
    const companyName = extractCompanyName(documentText);
    
    if (!companyName) {
      return res.status(400).json({ error: 'Could not extract company name from document' });
    }

    // Update HubSpot company
    const updatedCompany = await updateHubSpotCompany(companyId, companyName);

    res.json({
      success: true,
      extractedName: companyName,
      companyId: companyId,
      hubspotResponse: updatedCompany
    });

  } catch (error) {
    console.error('Error processing document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'HubSpot Document Parser API is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'HubSpot Company Name Extractor API',
    status: 'Running',
    endpoints: [
      'GET /api/health - Health check',
      'POST /api/upload-document - Extract company name from document'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});