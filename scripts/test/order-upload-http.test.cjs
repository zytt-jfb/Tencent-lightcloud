const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const http = require('node:http');
const req = createRequire(path.resolve('apps/api/package.json'));
const multer = req('multer');
const { ORDER_PART_UPLOAD_OPTIONS } = require('../../apps/api/dist/biz-orders/biz-orders.controller');

(async () => {
  const middleware = multer(ORDER_PART_UPLOAD_OPTIONS).single('file');
  const server = http.createServer((request, response) => {
    middleware(request, response, (error) => {
      response.statusCode = error ? 413 : 200;
      response.end(error ? error.code : String(request.file.size));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const size = 4 * 1024 * 1024;
    for (const bytes of [size - 1, size, size + 1]) {
      const form = new FormData();
      form.append('file', new Blob([Buffer.alloc(bytes)]), 'part.bin');
      const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: form });
      assert.equal(response.status, bytes <= size ? 200 : 413);
      assert.equal(await response.text(), bytes <= size ? String(bytes) : 'LIMIT_FILE_SIZE');
    }
    console.log('HTTP multipart boundary: 4MB accepted, oversized part rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
