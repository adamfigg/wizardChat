'use strict';

// File uploads (post media and profile portraits).
//
// Safety measures:
//   - only a fixed list of image/video types is accepted
//   - the stored filename is random; the uploader's filename is never used
//   - the first bytes of the file are checked against the claimed type
//   - size limits are enforced

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TYPES = {
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/png': { ext: '.png', kind: 'image' },
  'image/gif': { ext: '.gif', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'video/mp4': { ext: '.mp4', kind: 'video' },
  'video/webm': { ext: '.webm', kind: 'video' },
};

function makeUploader({ maxMb, imagesOnly }) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) =>
        cb(null, crypto.randomBytes(16).toString('hex') + TYPES[file.mimetype].ext),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const t = TYPES[file.mimetype];
      if (!t || (imagesOnly && t.kind !== 'image')) {
        return cb(new Error('UNSUPPORTED_TYPE'));
      }
      cb(null, true);
    },
  });
}

// Does the file's actual content match what its extension claims?
function contentMatches(filePath) {
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  const ascii = buf.toString('latin1');
  switch (path.extname(filePath)) {
    case '.jpg':
      return hex.startsWith('ffd8ff');
    case '.png':
      return hex.startsWith('89504e470d0a1a0a');
    case '.gif':
      return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
    case '.webp':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case '.mp4':
      return ascii.slice(4, 8) === 'ftyp';
    case '.webm':
      return hex.startsWith('1a45dfa3');
    default:
      return false;
  }
}

function removeUpload(filename) {
  if (!filename) return;
  fs.rm(path.join(UPLOAD_DIR, path.basename(filename)), { force: true }, () => {});
}

// Wraps multer so that upload problems become a friendly message and a
// redirect rather than a server error. After this middleware, req.file is
// either a verified upload or undefined.
function acceptUpload(field, { maxMb, imagesOnly = false }) {
  const handler = makeUploader({ maxMb, imagesOnly }).single(field);
  return (req, res, next) => {
    handler(req, res, (err) => {
      let problem = null;
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') problem = `The file exceeds the limit of ${maxMb} MB.`;
        else if (err.message === 'UNSUPPORTED_TYPE')
          problem = imagesOnly
            ? 'Only JPEG, PNG, GIF, or WebP images are accepted.'
            : 'Only JPEG, PNG, GIF, or WebP images and MP4 or WebM recordings are accepted.';
        else problem = 'The file could not be received.';
      } else if (req.file && !contentMatches(req.file.path)) {
        problem = 'The file does not appear to be what it claims to be, and was refused.';
      }
      if (problem) {
        if (req.file) removeUpload(req.file.filename);
        req.file = undefined;
        req.uploadProblem = problem;
      }
      if (req.file) req.file.kind = TYPES[req.file.mimetype].kind;
      next();
    });
  };
}

module.exports = { UPLOAD_DIR, acceptUpload, removeUpload };
