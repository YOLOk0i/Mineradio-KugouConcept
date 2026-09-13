'use strict';

const fs = require('fs');
const path = require('path');

const STORE_VERSION = 1;
const STORE_FILE = 'kugou-lite-session.v1.enc';

class KugouLiteSessionStore {
  constructor(options) {
    const opts = options || {};
    this.safeStorage = opts.safeStorage;
    this.userDataPath = path.resolve(String(opts.userDataPath || ''));
    this.file = path.join(this.userDataPath, STORE_FILE);
    this.memorySession = null;
  }

  encryptionAvailable() {
    return !!(
      this.safeStorage &&
      typeof this.safeStorage.isEncryptionAvailable === 'function' &&
      this.safeStorage.isEncryptionAvailable()
    );
  }

  async load() {
    if (!this.encryptionAvailable()) return this.memorySession;
    try {
      const envelope = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      if (Number(envelope.version) !== STORE_VERSION || !envelope.ciphertext) return null;
      const encrypted = Buffer.from(String(envelope.ciphertext), 'base64');
      const plaintext = this.safeStorage.decryptString(encrypted);
      const session = JSON.parse(plaintext);
      this.memorySession = session && typeof session === 'object' ? session : null;
      return this.memorySession;
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.warn('[KugouLiteSessionStore] unable to restore encrypted session:', error.message);
      }
      return null;
    }
  }

  async save(session) {
    this.memorySession = session && typeof session === 'object'
      ? JSON.parse(JSON.stringify(session))
      : null;
    if (!this.encryptionAvailable()) {
      return { persisted: false, reason: 'ENCRYPTION_UNAVAILABLE' };
    }
    const plaintext = JSON.stringify(this.memorySession);
    const encrypted = this.safeStorage.encryptString(plaintext);
    const envelope = JSON.stringify({
      version: STORE_VERSION,
      ciphertext: Buffer.from(encrypted).toString('base64'),
    });
    await fs.promises.mkdir(this.userDataPath, { recursive: true });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await fs.promises.writeFile(temporary, envelope, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temporary, this.file);
    return { persisted: true };
  }

  async clear() {
    this.memorySession = null;
    try {
      await fs.promises.unlink(this.file);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = {
  KugouLiteSessionStore,
  STORE_FILE,
  STORE_VERSION,
};
