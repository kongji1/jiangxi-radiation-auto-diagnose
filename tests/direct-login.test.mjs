import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'jiangxi-radiation-auto-diagnose.user.js'), 'utf8');

function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `missing source block: ${startText}`);
  return source.slice(start, end);
}

const normalizeCaptchaAnswer = new Function(
  `${block('  function normalizeCaptchaAnswer', '  function setSessionCookie')}; return normalizeCaptchaAnswer;`
)();

assert.equal(normalizeCaptchaAnswer('99-40='), '59');
assert.equal(normalizeCaptchaAnswer('9×8='), '72');
assert.equal(normalizeCaptchaAnswer('1234'), '1234');
assert.equal(normalizeCaptchaAnswer('99-40=9940'), '');
assert.equal(normalizeCaptchaAnswer('abc59'), '');

let cookieMap = new Map([['Auth', 'stale-token']]);
const cookieDocument = {};
Object.defineProperty(cookieDocument, 'cookie', {
  get() { return [...cookieMap].map(([key, value]) => `${key}=${value}`).join('; '); },
  set(value) {
    const pair = String(value).split(';', 1)[0];
    const index = pair.indexOf('=');
    const key = pair.slice(0, index);
    const val = pair.slice(index + 1);
    if (/Max-Age=0/i.test(String(value))) cookieMap.delete(key);
    else cookieMap.set(key, val);
  }
});
const setSessionCookie = new Function(
  'document', `${block('  function setSessionCookie', '  async function directLoginRequest')}; return setSessionCookie;`
)(cookieDocument);

assert.equal(setSessionCookie('AUTH', 'new-token'), true);
assert.equal(cookieMap.get('AUTH'), 'new-token');
assert.equal(cookieMap.has('Auth'), false);

const performDirectLogin = new Function(
  'normalizeCaptchaAnswer',
  `${block('  async function performDirectLogin', '  async function recognizeCaptcha')}; return performDirectLogin;`
)(normalizeCaptchaAnswer);

const calls = [];
const responses = [
  { code: 200, data: { ownModulus: 'modulus', exponent: 'exponent' } },
  { code: 200, data: { img: 'image', uuid: 'captcha-uuid', captchaEnabled: true } },
  { code: 200, data: 'server-token' },
  { code: 200, data: { uid: 'user-id', logincode: 'account-code', workStationList: [{ code: 'station-code' }] } }
];
const request = async (url, options) => {
  calls.push({ url, options });
  return responses.shift();
};
const result = await performDirectLogin({
  username: 'account-code',
  password: 'session-only-password',
  request,
  captchaResolver: async () => '99-40=',
  encryptPassword: (password, key) => `${key.exponent}:${password.length}`,
  writeCookie: setSessionCookie
});

assert.equal(result.token, 'server-token');
assert.deepEqual([...cookieMap.entries()].filter(([key]) => ['AUTH', 'LOGINCODE', 'WORKSTATION'].includes(key)), [
  ['AUTH', 'server-token'], ['LOGINCODE', 'account-code'], ['WORKSTATION', 'station-code']
]);
assert.equal(calls.length, 4);
for (const call of calls) {
  assert.equal(call.options.credentials, 'include');
  assert.equal(call.options.headers.Accept, 'application/json');
}
assert.equal(calls[2].options.method, 'POST');
assert.match(calls[2].url, /[?&]code=59(?:&|$)/);
assert.match(calls[2].url, /[?&]username=account-code(?:&|$)/);

const badRequest = async (url) => {
  if (url.includes('/keyPair')) return { code: 200, data: { ownModulus: 'm', exponent: 'e' } };
  if (url.includes('/captcha')) return { code: 200, data: { img: 'image', uuid: 'u', captchaEnabled: true } };
  return { code: 200, data: { token: 'object-is-not-a-token' } };
};
await assert.rejects(
  performDirectLogin({
    username: 'account-code', password: 'session-only-password', request: badRequest,
    captchaResolver: async () => '1234', encryptPassword: () => 'encrypted', writeCookie: () => true
  }),
  /协议登录失败/
);

// The request helper must promote the canonical uppercase cookies into the
// same headers used by the page Axios interceptor.
const readCookie = new Function(
  'document', `${block('  function readCookie(name)', '  function loginIdentity')}; return readCookie;`
)(cookieDocument);
const sessionHeaders = new Function(
  'readCookie', 'sessionIdentity', 'clientIp', 'pageWindow', 'developerLog', 'debugAuthContext', 'norm',
  `${block('  function sessionHeaders(input = {})', '  async function ensureClientIp')}; return sessionHeaders;`
)(readCookie, { info: { uid: 'user-id', logincode: 'account-code', admin: false, oid: 'org-id' } }, '192.0.2.10', () => ({ sessionStorage: { getItem: () => '' } }), () => {}, () => ({}), value => String(value ?? '').trim());
const headers = sessionHeaders({ Accept: 'application/json' });
assert.equal(headers.Authorization, 'server-token');
assert.equal(headers['LOGIN-USER-KEY'], 'account-code');
assert.equal(headers['LOGIN-USER-UID'], 'user-id');
assert.equal(headers['LOGIN-CLIENT-IP'], '192.0.2.10');

console.log('direct-login: mocked protocol flow, captcha validation, canonical cookies, and auth headers passed');
