'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const LITE_APPID = 3116;
const LITE_CLIENTVER = 11440;
const LITE_SRC_APPID = 2919;
const LITE_ANDROID_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const WEB_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const LITE_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const LOGIN_T2_KEY = 'fd14b35e3f81af3817a20ae7adae7020';
const LOGIN_T2_IV = '17a20ae7adae7020';
const LOGIN_T1_KEY = '5e4ef500e9597fe004bd09a46d8add98';
const LOGIN_T1_IV = '04bd09a46d8add98';
const REFRESH_KEY = 'c24f74ca2820225badc01946dba4fdf7';
const REFRESH_IV = 'adc01946dba4fdf7';
const LITE_USER_AGENT = 'Android16-1070-11440-130-0-LOGIN-wifi';

function md5(value) {
  return crypto.createHash('md5').update(String(value == null ? '' : value)).digest('hex');
}

function randomString(length) {
  const chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(Math.max(1, Number(length) || 16));
  return Array.from(bytes, byte => chars[byte % chars.length]).join('');
}

function createKugouLiteDevice() {
  const guid = md5(crypto.randomUUID());
  return {
    guid,
    mid: BigInt(`0x${md5(guid)}`).toString(10),
    dev: randomString(10),
    mac: '02:00:00:00:00:00',
    dfid: '-',
  };
}

function normalizeDevice(input) {
  const device = input && typeof input === 'object' ? input : {};
  const fallback = createKugouLiteDevice();
  return {
    guid: String(device.guid || fallback.guid),
    mid: String(device.mid || fallback.mid),
    dev: String(device.dev || fallback.dev).toUpperCase(),
    mac: String(device.mac || fallback.mac).toUpperCase(),
    dfid: String(device.dfid || fallback.dfid),
  };
}

function signatureWebParams(params) {
  const text = Object.keys(params).map(key => `${key}=${params[key]}`).sort().join('');
  return md5(`${WEB_SALT}${text}${WEB_SALT}`);
}

function signatureAndroidParams(params, body) {
  const text = Object.keys(params).sort()
    .map(key => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return md5(`${LITE_ANDROID_SALT}${text}${body || ''}${LITE_ANDROID_SALT}`);
}

function aesEncrypt(value, options) {
  const explicit = options && options.key && options.iv;
  const temporaryKey = explicit ? '' : randomString(16).toLowerCase();
  const keyText = explicit ? String(options.key) : md5(temporaryKey).slice(0, 32);
  const ivText = explicit ? String(options.iv) : keyText.slice(-16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyText, 'utf8'), Buffer.from(ivText, 'utf8'));
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]).toString('hex');
  return explicit ? encrypted : { str: encrypted, key: temporaryKey };
}

function aesDecrypt(value, key, iv) {
  const keyText = iv ? String(key) : md5(key).slice(0, 32);
  const ivText = iv ? String(iv) : keyText.slice(-16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyText, 'utf8'), Buffer.from(ivText, 'utf8'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(value || ''), 'hex')),
    decipher.final(),
  ]).toString('utf8');
  try {
    return JSON.parse(plaintext);
  } catch (_) {
    return plaintext;
  }
}

function rsaRawEncrypt(value) {
  const message = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  if (message.length > 128) throw new Error('KUGOU_RSA_PAYLOAD_TOO_LARGE');
  const padded = Buffer.alloc(128);
  message.copy(padded);
  return crypto.publicEncrypt({
    key: LITE_PUBLIC_KEY,
    padding: crypto.constants.RSA_NO_PADDING,
  }, padded).toString('hex');
}

function publicError(error, fallbackCode) {
  if (error && error.public) return error;
  const wrapped = new Error(error && error.message || fallbackCode || 'KUGOU_REQUEST_FAILED');
  wrapped.code = error && error.code || fallbackCode || 'KUGOU_REQUEST_FAILED';
  wrapped.public = true;
  return wrapped;
}

function requestBuffer(targetUrl, options, body) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const result = {
          statusCode: Number(response.statusCode || 0),
          headers: response.headers || {},
          body: buffer,
        };
        if (result.statusCode >= 400) {
          const error = new Error(`HTTP_${result.statusCode}`);
          error.code = `HTTP_${result.statusCode}`;
          error.response = result;
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('KUGOU_REQUEST_TIMEOUT')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function kugouLiteRequest(pathname, options) {
  const opts = options || {};
  const device = normalizeDevice(opts.device);
  const session = opts.session || {};
  const clienttime = Math.floor(Date.now() / 1000);
  const params = opts.clearDefaultParams ? {} : {
    dfid: device.dfid || '-',
    mid: device.mid,
    uuid: '-',
    appid: LITE_APPID,
    clientver: LITE_CLIENTVER,
    clienttime,
  };
  if (session.token) params.token = session.token;
  if (session.userid) params.userid = session.userid;
  Object.assign(params, opts.params || {});
  const body = Buffer.isBuffer(opts.data)
    ? opts.data
    : (opts.data == null ? '' : JSON.stringify(opts.data));
  params.signature = opts.signature === 'web'
    ? signatureWebParams(params)
    : signatureAndroidParams(params, body);
  const url = new URL(pathname, opts.baseURL || 'https://gateway.kugou.com');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await requestBuffer(url.toString(), {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers: Object.assign({
      'User-Agent': opts.userAgent || LITE_USER_AGENT,
      dfid: device.dfid || '-',
      mid: device.mid,
      clienttime: String(params.clienttime || clienttime),
      'Content-Type': 'application/json;charset=UTF-8',
    }, opts.headers || {}),
  }, body || undefined);
  let payload;
  try {
    payload = JSON.parse(response.body.toString('utf8'));
  } catch (_) {
    payload = response.body.toString('utf8');
  }
  const ssaCode = String(response.headers['ssa-code'] || '');
  if (ssaCode) {
    const error = new Error('酷狗要求完成额外安全验证，请稍后在官方客户端确认后重试。');
    error.code = 'KUGOU_VERIFICATION_REQUIRED';
    error.ssaCode = ssaCode;
    error.public = true;
    throw error;
  }
  if (payload && (Number(payload.status) === 0 || (payload.error_code && Number(payload.error_code) !== 0))) {
    const error = new Error(payload.error || payload.msg || payload.message || 'KUGOU_API_REJECTED');
    error.code = String(payload.error_code || payload.errcode || 'KUGOU_API_REJECTED');
    error.payload = payload;
    error.public = true;
    throw error;
  }
  return { payload, headers: response.headers, device };
}

function signParamsKey(timestamp) {
  return md5(`${LITE_APPID}${LITE_ANDROID_SALT}${LITE_CLIENTVER}${timestamp}`);
}

function mergeLoginData(payload, encryptionKey) {
  const body = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
  let secure = {};
  if (body.secu_params) {
    const decoded = aesDecrypt(body.secu_params, encryptionKey);
    secure = decoded && typeof decoded === 'object' ? decoded : { token: decoded };
  }
  return Object.assign({}, body, secure);
}

function buildSession(data, device, previous) {
  const prior = previous || {};
  const userid = String(data.userid || prior.userid || '').replace(/\D/g, '');
  const token = String(data.token || prior.token || '');
  if (!userid || userid === '0' || !token) {
    throw publicError(new Error('登录响应未包含有效用户凭据。'), 'KUGOU_LOGIN_INCOMPLETE');
  }
  return {
    version: 1,
    userid,
    token,
    t1: String(data.t1 || prior.t1 || ''),
    vipToken: String(data.vip_token || data.vipToken || prior.vipToken || ''),
    vipType: Number(data.vip_type || data.vipType || prior.vipType || 0) || 0,
    nickname: String(data.nickname || data.nick_name || prior.nickname || ''),
    avatar: String(data.pic || data.avatar || prior.avatar || ''),
    updatedAt: Date.now(),
    device: normalizeDevice(Object.assign({}, device, {
      dfid: data.dfid || (device && device.dfid),
    })),
  };
}

async function startKugouLiteQr(device) {
  const normalizedDevice = normalizeDevice(device);
  const { payload } = await kugouLiteRequest('/v2/qrcode', {
    baseURL: 'https://login-user.kugou.com',
    signature: 'web',
    device: normalizedDevice,
    params: {
      appid: 1001,
      type: 1,
      plat: 4,
      qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${LITE_APPID}&`,
      srcappid: LITE_SRC_APPID,
    },
  });
  const key = String(payload && payload.data && (payload.data.qrcode || payload.data.key) || '');
  if (!key) throw publicError(new Error('二维码登录凭据生成失败。'), 'KUGOU_QR_KEY_MISSING');
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`;
  let image = '';
  try {
    const qrcode = require('qrcode');
    image = await qrcode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  } catch (error) {
    console.warn('[KugouLite] QR image generation unavailable:', error.message);
  }
  return { key, url, image, device: normalizedDevice, expiresAt: Date.now() + 3 * 60 * 1000 };
}

async function checkKugouLiteQr(key, device) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) throw publicError(new Error('二维码登录凭据缺失。'), 'KUGOU_QR_KEY_REQUIRED');
  const { payload } = await kugouLiteRequest('/v2/get_userinfo_qrcode', {
    baseURL: 'https://login-user.kugou.com',
    signature: 'web',
    device,
    params: {
      plat: 4,
      appid: LITE_APPID,
      srcappid: LITE_SRC_APPID,
      qrcode: normalizedKey,
    },
  });
  const data = payload && payload.data || {};
  const status = Number(data.status);
  if (status === 4) {
    return { state: 'authorized', session: buildSession(data, device) };
  }
  if (status === 2) return { state: 'scanned' };
  if (status === 0) return { state: 'expired' };
  return { state: 'waiting' };
}

async function sendKugouLiteCode(mobile, device) {
  const phone = String(mobile || '').replace(/\s+/g, '');
  if (!/^1\d{10}$/.test(phone)) {
    throw publicError(new Error('请输入有效的 11 位中国大陆手机号。'), 'KUGOU_MOBILE_INVALID');
  }
  const { payload } = await kugouLiteRequest('/v7/send_mobile_code', {
    baseURL: 'http://login.user.kugou.com',
    method: 'POST',
    device: Object.assign({}, normalizeDevice(device), { dfid: '-' }),
    data: { businessid: 5, mobile: phone, plat: 3 },
  });
  return { ok: true, message: payload && (payload.msg || payload.message) || '验证码已发送' };
}

async function loginKugouLiteByCode(mobile, code, device, selectedUserId) {
  const phone = String(mobile || '').replace(/\s+/g, '');
  const verifyCode = String(code || '').trim();
  if (!/^1\d{10}$/.test(phone)) throw publicError(new Error('手机号格式不正确。'), 'KUGOU_MOBILE_INVALID');
  if (!/^\d{4,8}$/.test(verifyCode)) throw publicError(new Error('验证码格式不正确。'), 'KUGOU_CODE_INVALID');
  const normalizedDevice = normalizeDevice(device);
  const now = Date.now();
  const encrypted = aesEncrypt({ mobile: phone, code: verifyCode });
  const t2 = aesEncrypt(
    `${normalizedDevice.guid}|0f607264fc6318a92b9e13c65db7cd3c|${normalizedDevice.mac}|${normalizedDevice.dev}|${now}`,
    { key: LOGIN_T2_KEY, iv: LOGIN_T2_IV }
  );
  const t1 = aesEncrypt(`|${now}`, { key: LOGIN_T1_KEY, iv: LOGIN_T1_IV });
  const loginData = {
    plat: 1,
    support_multi: 1,
    t1,
    t2,
    clienttime_ms: now,
    mobile: `${phone.slice(0, 2)}*****${phone.slice(10, 11)}`,
    key: signParamsKey(now),
    pk: rsaRawEncrypt({ clienttime_ms: now, key: encrypted.key }).toUpperCase(),
    params: encrypted.str,
    dfid: normalizedDevice.dfid || randomString(24),
    dev: normalizedDevice.dev,
    gitversion: '5f0b7c4',
  };
  const userId = String(selectedUserId || '').replace(/\D/g, '');
  if (userId && userId !== '0') loginData.userid = userId;
  const { payload } = await kugouLiteRequest('/v7/login_by_verifycode', {
    baseURL: 'https://loginserviceretry.kugou.com',
    method: 'POST',
    device: normalizedDevice,
    headers: { 'support-calm': '1' },
    data: loginData,
  });
  return buildSession(mergeLoginData(payload, encrypted.key), normalizedDevice);
}

async function refreshKugouLiteToken(session) {
  if (!session || !session.token || !session.userid) {
    throw publicError(new Error('没有可刷新的酷狗登录会话。'), 'KUGOU_SESSION_REQUIRED');
  }
  const device = normalizeDevice(session.device);
  const now = Date.now();
  const p3 = aesEncrypt({
    clienttime: Math.floor(now / 1000),
    token: session.token,
  }, { key: REFRESH_KEY, iv: REFRESH_IV });
  const encrypted = aesEncrypt({});
  const t2 = aesEncrypt(
    `${device.guid}|0f607264fc6318a92b9e13c65db7cd3c|${device.mac}|${device.dev}|${now}`,
    { key: LOGIN_T2_KEY, iv: LOGIN_T2_IV }
  );
  const t1 = aesEncrypt(`${session.t1 ? session.t1 : ''}|${now}`, {
    key: LOGIN_T1_KEY,
    iv: LOGIN_T1_IV,
  });
  const { payload } = await kugouLiteRequest('/v5/login_by_token', {
    baseURL: 'http://login.user.kugou.com',
    method: 'POST',
    device,
    session,
    data: {
      dfid: device.dfid || '-',
      p3,
      plat: 1,
      t1,
      t2,
      t3: 'MCwwLDAsMCwwLDAsMCwwLDA=',
      pk: rsaRawEncrypt({ clienttime_ms: now, key: encrypted.key }),
      params: encrypted.str,
      userid: session.userid,
      clienttime_ms: now,
      dev: device.dev,
    },
  });
  return buildSession(mergeLoginData(payload, encrypted.key), device, session);
}

async function fetchKugouLiteProfile(session) {
  if (!session || !session.token || !session.userid) {
    throw publicError(new Error('请先登录酷狗概念版。'), 'KUGOU_SESSION_REQUIRED');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const { payload } = await kugouLiteRequest('/v3/get_my_info', {
    method: 'POST',
    device: session.device,
    session,
    params: { plat: 1 },
    headers: { 'x-router': 'usercenter.kugou.com' },
    data: {
      visit_time: timestamp,
      usertype: 1,
      p: rsaRawEncrypt({ token: session.token, clienttime: timestamp }).toUpperCase(),
      userid: Number(session.userid),
    },
  });
  const data = payload && payload.data || {};
  return {
    userid: String(data.userid || session.userid),
    nickname: String(data.nickname || data.nick_name || data.username || session.nickname || ''),
    avatar: String(data.pic || data.avatar || data.headimg || session.avatar || ''),
    vipType: Number(data.vip_type || data.vipType || session.vipType || 0) || 0,
    raw: data,
  };
}

async function fetchKugouLiteVip(session) {
  if (!session || !session.token || !session.userid) {
    throw publicError(new Error('请先登录酷狗概念版。'), 'KUGOU_SESSION_REQUIRED');
  }
  const { payload } = await kugouLiteRequest('/v1/get_union_vip', {
    baseURL: 'https://kugouvip.kugou.com',
    method: 'GET',
    device: session.device,
    session,
    params: { busi_type: 'concept' },
    headers: { Referer: 'https://vip.kugou.com/' },
  });
  const { normalizeKugouVipPayload } = require('./kugou-api');
  return normalizeKugouVipPayload(payload, { userid: session.userid });
}

async function fetchKugouLiteContinueListening(session, limit) {
  if (!session || !session.token || !session.userid) return [];
  const { payload } = await kugouLiteRequest('/playque/devque/v1/get_latest_songs', {
    method: 'POST',
    device: session.device,
    session,
    data: {
      area_code: '1',
      sources: ['pc', 'mobile', 'tv', 'car'],
      userid: Number(session.userid),
      ret_info: 1,
      token: session.token,
      pagesize: Math.max(1, Math.min(100, Number(limit) || 30)),
    },
  });
  const data = payload && payload.data;
  const rows = Array.isArray(data) ? data : (data && (data.info || data.list || data.songs) || []);
  const { mapKugouPlaylistTrack } = require('./kugou-api');
  return rows.map(mapKugouPlaylistTrack).filter(song => song && song.name && (song.hash || song.id));
}

module.exports = {
  checkKugouLiteQr,
  createKugouLiteDevice,
  fetchKugouLiteContinueListening,
  fetchKugouLiteProfile,
  fetchKugouLiteVip,
  loginKugouLiteByCode,
  normalizeDevice,
  refreshKugouLiteToken,
  sendKugouLiteCode,
  startKugouLiteQr,
  _test: {
    aesDecrypt,
    aesEncrypt,
    buildSession,
    rsaRawEncrypt,
    signatureAndroidParams,
    signatureWebParams,
  },
};
