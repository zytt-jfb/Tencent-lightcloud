'use strict';

const path = require('node:path');

const compiledRoot = process.env.API_TEST_COMPILED_ROOT;
if (!compiledRoot || !path.isAbsolute(compiledRoot)) {
  throw new Error('API_TEST_COMPILED_ROOT_REQUIRED: run through pnpm test:unit');
}

module.exports = (relativePath) => require(path.join(compiledRoot, relativePath));
