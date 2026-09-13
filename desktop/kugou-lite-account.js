'use strict';

const accountBridge = require('../kugou-account-bridge');
const defaultApi = require('../kugou-lite-api');

const SMS_COOLDOWN_MS = 60 * 1000;
const QR_MAX_AGE_MS = 4 * 60 * 1000;

function safeError(error, fallback) {
  return {
    ok: false,
    error: String(error && error.code || fallback || 'KUGOU_ACCOUNT_FAILED'),
    message: String(error && error.message || '酷狗账户操作失败。').slice(0, 240),
    verificationRequired: !!(error && error.code === 'KUGOU_VERIFICATION_REQUIRED'),
  };
}

class KugouLiteAccount {
  constructor(options) {
    const opts = options || {};
    this.store = opts.store;
    this.bridge = opts.bridge || accountBridge;
    this.api = opts.api || defaultApi;
    this.session = null;
    this.profile = null;
    this.qr = null;
    this.smsDevice = null;
    this.smsSentAt = 0;
    this.initialized = false;
    this.reauthRequired = false;
  }

  async initialize() {
    if (this.initialized) return this.status();
    this.initialized = true;
    this.session = await this.store.load();
    if (!this.session) {
      this.bridge.clearSession();
      return this.status();
    }
    this.bridge.setSession(this.session);
    let refreshError = null;
    try {
      this.session = await this.api.refreshKugouLiteToken(this.session);
      await this.persistSession();
    } catch (error) {
      refreshError = error;
      console.warn('[KugouLiteAccount] session refresh deferred:', error.code || error.message);
    }
    let profileError = null;
    try {
      await this.refreshProfile();
    } catch (error) {
      profileError = error;
      console.warn('[KugouLiteAccount] profile restore deferred:', error.code || error.message);
    }
    if (refreshError && profileError && this.sessionRejected(refreshError, profileError)) {
      this.session = null;
      this.profile = null;
      this.reauthRequired = true;
      this.bridge.clearSession();
      await this.store.clear();
    }
    return this.status();
  }

  sessionRejected() {
    return Array.prototype.slice.call(arguments).some(error => {
      const code = String(error && error.code || '').toUpperCase();
      if (code === 'KUGOU_VERIFICATION_REQUIRED' || code.includes('TIMEOUT')) return false;
      if (code === 'HTTP_401' || code === 'HTTP_403' || code === 'KUGOU_API_REJECTED') return true;
      const message = String(error && error.message || '').toLowerCase();
      return /token|登录.*(失效|过期)|unauthori[sz]ed|credential/.test(message);
    });
  }

  status() {
    return {
      ok: true,
      provider: 'kugou',
      variant: 'lite',
      loggedIn: !!(this.session && this.session.userid && this.session.token),
      encryptionAvailable: this.store.encryptionAvailable(),
      persisted: this.store.encryptionAvailable(),
      reauthRequired: this.reauthRequired,
      profile: this.profile ? {
        userid: this.profile.userid,
        nickname: this.profile.nickname,
        avatar: this.profile.avatar,
        vipType: this.profile.vipType,
        svipType: this.profile.svipType || 0,
        vipLevel: this.profile.vipLevel || 'none',
        isVip: this.profile.isVip === true,
        isSvip: this.profile.isSvip === true,
        membershipVerified: this.profile.membershipVerified === true,
      } : (this.session ? {
        userid: this.session.userid,
        nickname: this.session.nickname || '',
        avatar: this.session.avatar || '',
        vipType: this.session.vipType || 0,
        svipType: this.session.svipType || 0,
        vipLevel: this.session.vipLevel || (this.session.vipType > 0 ? 'vip' : 'none'),
        isVip: this.session.isVip === true || this.session.vipType > 0,
        isSvip: this.session.isSvip === true,
        membershipVerified: this.session.membershipVerified === true,
      } : null),
    };
  }

  async persistSession() {
    this.bridge.setSession(this.session);
    return this.store.save(this.session);
  }

  async acceptSession(session) {
    this.session = session;
    this.reauthRequired = false;
    this.qr = null;
    this.smsDevice = null;
    await this.persistSession();
    try {
      await this.refreshProfile();
    } catch (error) {
      console.warn('[KugouLiteAccount] post-login profile request failed:', error.code || error.message);
    }
    return this.status();
  }

  async startQr() {
    try {
      const device = this.session && this.session.device || this.api.createKugouLiteDevice();
      const qr = await this.api.startKugouLiteQr(device);
      this.qr = {
        key: qr.key,
        device: qr.device,
        createdAt: Date.now(),
        expiresAt: Math.min(Number(qr.expiresAt || Infinity), Date.now() + QR_MAX_AGE_MS),
      };
      return {
        ok: true,
        key: qr.key,
        url: qr.url,
        image: qr.image,
        expiresAt: this.qr.expiresAt,
      };
    } catch (error) {
      return safeError(error, 'KUGOU_QR_START_FAILED');
    }
  }

  async checkQr(key) {
    try {
      if (!this.qr || String(key || '') !== this.qr.key) {
        return { ok: false, error: 'KUGOU_QR_NOT_ACTIVE', message: '该二维码已失效，请刷新后重试。' };
      }
      if (Date.now() >= this.qr.expiresAt) {
        this.qr = null;
        return { ok: true, state: 'expired' };
      }
      const result = await this.api.checkKugouLiteQr(this.qr.key, this.qr.device);
      if (result.state === 'authorized') {
        const status = await this.acceptSession(result.session);
        return Object.assign({}, status, { state: 'authorized' });
      }
      if (result.state === 'expired') this.qr = null;
      return { ok: true, state: result.state };
    } catch (error) {
      return safeError(error, 'KUGOU_QR_CHECK_FAILED');
    }
  }

  cancelQr() {
    this.qr = null;
    return { ok: true };
  }

  async sendCode(mobile) {
    const waitMs = Math.max(0, SMS_COOLDOWN_MS - (Date.now() - this.smsSentAt));
    if (waitMs > 0) {
      return {
        ok: false,
        error: 'KUGOU_SMS_COOLDOWN',
        message: `请在 ${Math.ceil(waitMs / 1000)} 秒后重试。`,
        retryAfterMs: waitMs,
      };
    }
    try {
      this.smsDevice = this.session && this.session.device || this.smsDevice || this.api.createKugouLiteDevice();
      const result = await this.api.sendKugouLiteCode(mobile, this.smsDevice);
      this.smsSentAt = Date.now();
      return Object.assign({}, result, { retryAfterMs: SMS_COOLDOWN_MS });
    } catch (error) {
      return safeError(error, 'KUGOU_SMS_SEND_FAILED');
    }
  }

  async loginByCode(mobile, code, userId) {
    try {
      this.smsDevice = this.session && this.session.device || this.smsDevice || this.api.createKugouLiteDevice();
      const session = await this.api.loginKugouLiteByCode(mobile, code, this.smsDevice, userId);
      return this.acceptSession(session);
    } catch (error) {
      return safeError(error, 'KUGOU_SMS_LOGIN_FAILED');
    }
  }

  async refreshProfile() {
    if (!this.session) return this.status();
    const profile = await this.api.fetchKugouLiteProfile(this.session);
    let membership = null;
    if (typeof this.api.fetchKugouLiteVip === 'function') {
      try {
        membership = await this.api.fetchKugouLiteVip(this.session);
      } catch (error) {
        console.warn('[KugouLiteAccount] membership refresh deferred:', error.code || error.message);
      }
    }
    const previousMembership = {
      vipType: this.session.vipType || 0,
      svipType: this.session.svipType || 0,
      vipLevel: this.session.vipLevel || (this.session.vipType > 0 ? 'vip' : 'none'),
      isVip: this.session.isVip === true || this.session.vipType > 0,
      isSvip: this.session.isSvip === true,
      membershipVerified: this.session.membershipVerified === true,
    };
    const resolvedMembership = membership && membership.membershipVerified
      ? membership
      : previousMembership;
    this.profile = Object.assign({}, profile, resolvedMembership);
    this.session = Object.assign({}, this.session, {
      nickname: profile.nickname || this.session.nickname || '',
      avatar: profile.avatar || this.session.avatar || '',
      vipType: resolvedMembership.vipType || profile.vipType || 0,
      svipType: resolvedMembership.svipType || 0,
      vipLevel: resolvedMembership.vipLevel || 'none',
      isVip: resolvedMembership.isVip === true,
      isSvip: resolvedMembership.isSvip === true,
      membershipVerified: resolvedMembership.membershipVerified === true,
      updatedAt: Date.now(),
    });
    await this.persistSession();
    return this.status();
  }

  async continueListening(limit) {
    if (!this.session) return { ok: true, songs: [] };
    try {
      return {
        ok: true,
        songs: await this.api.fetchKugouLiteContinueListening(this.session, limit),
      };
    } catch (error) {
      return safeError(error, 'KUGOU_CONTINUE_LISTENING_FAILED');
    }
  }

  async logout() {
    this.session = null;
    this.profile = null;
    this.qr = null;
    this.smsDevice = null;
    this.smsSentAt = 0;
    this.reauthRequired = false;
    this.bridge.clearSession();
    await this.store.clear();
    return this.status();
  }
}

module.exports = {
  KugouLiteAccount,
  QR_MAX_AGE_MS,
  SMS_COOLDOWN_MS,
  safeError,
};
