class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const bad = (msg) => { throw new HttpError(400, msg); };

// Express 4 async hataları yakalamaz; async işleyicileri bununla sarın
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, bad, asyncHandler };
