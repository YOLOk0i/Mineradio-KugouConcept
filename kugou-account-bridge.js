'use strict';

let currentSession = null;
const listeners = new Set();

function cleanValue(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeSession(input) {
  if (!input || typeof input !== 'object') return null;
  const userid = cleanValue(input.userid || input.userId).replace(/\D/g, '');
  const token = cleanValue(input.token);
  if (!userid || userid === '0' || !token) return null;
  const device = input.device && typeof input.device === 'object' ? input.device : {};
  return {
    version: 1,
    userid,
    token,
    t1: cleanValue(input.t1),
    vipToken: cleanValue(input.vipToken || input.vip_token),
    vipType: Number(input.vipType || input.vip_type || 0) || 0,
    svipType: Number(input.svipType || input.svip_type || 0) || 0,
    nickname: cleanValue(input.nickname),
    avatar: cleanValue(input.avatar),
    expiresAt: Number(input.expiresAt || 0) || 0,
    updatedAt: Number(input.updatedAt || Date.now()) || Date.now(),
    device: {
      mid: cleanValue(device.mid),
      guid: cleanValue(device.guid),
      dev: cleanValue(device.dev),
      mac: cleanValue(device.mac),
      dfid: cleanValue(device.dfid || input.dfid) || '-',
    },
  };
}

function sessionToCookie(session) {
  const normalized = normalizeSession(session);
  if (!normalized) return '';
  const pairs = [
    ['userid', normalized.userid],
    ['token', normalized.token],
    ['t1', normalized.t1],
    ['vip_token', normalized.vipToken],
    ['vip_type', normalized.vipType],
    ['svip_type', normalized.svipType],
    ['kg_mid', normalized.device.mid],
    ['KUGOU_API_MID', normalized.device.mid],
    ['KUGOU_API_GUID', normalized.device.guid],
    ['KUGOU_API_DEV', normalized.device.dev],
    ['KUGOU_API_MAC', normalized.device.mac],
    ['dfid', normalized.device.dfid],
    ['kg_dfid', normalized.device.dfid],
    ['nickname', normalized.nickname],
    ['avatar', normalized.avatar],
  ];
  return pairs
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('; ');
}

function publish() {
  for (const listener of listeners) {
    try {
      listener(currentSession, sessionToCookie(currentSession));
    } catch (error) {
      console.warn('[KugouAccountBridge] listener failed:', error.message);
    }
  }
}

function setSession(session) {
  currentSession = normalizeSession(session);
  publish();
  return getSession();
}

function clearSession() {
  currentSession = null;
  publish();
}

function getSession() {
  return currentSession ? JSON.parse(JSON.stringify(currentSession)) : null;
}

function getCookie() {
  return sessionToCookie(currentSession);
}

function onChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  clearSession,
  getCookie,
  getSession,
  normalizeSession,
  onChange,
  sessionToCookie,
  setSession,
};
