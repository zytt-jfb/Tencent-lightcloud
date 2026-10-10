const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '..');
const controllerSource = fs.readFileSync(path.join(apiRoot, 'src', 'auth', 'auth.controller.ts'), 'utf8');
const serviceSource = fs.readFileSync(path.join(apiRoot, 'src', 'auth', 'auth.service.ts'), 'utf8');

test('public city and WeChat registration handlers remain removed', () => {
  assert.doesNotMatch(controllerSource, /@(Post|Get)\(['"](?:city|wechat)\/register['"]\)/);
  assert.doesNotMatch(serviceSource, /\b(?:cityRegister|wechatRegister)\s*\(/);
});

test('city password login and invitation binding remain explicit authentication channels', () => {
  assert.match(controllerSource, /@Post\(['"]city\/login['"]\)/);
  assert.match(controllerSource, /@Post\(['"]wechat\/bind['"]\)/);
  assert.match(serviceSource, /Role\.CITY_USER/);
});
