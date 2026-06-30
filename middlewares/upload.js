import multer from 'multer';

// Configure Multer to store files in memory as buffers for instant AI processing
const storage = multer.memoryStorage();

// Universal Media Wrapper: Accepts Images, PDFs, and Spreadsheets
export const mediaUploadWrapper = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 
      'image/png', 
      'application/pdf', 
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  }
});