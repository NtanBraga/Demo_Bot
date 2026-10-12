/**
 * High-performance, memory-bounded LRU Cache with TTL and SingleFlight deduplication.
 */

class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.ttl || 3 * 60 * 60 * 1000; // 3 hours default
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const entry = this.cache.get(key);
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/**
 * SingleFlight prevents duplicate concurrent requests for the same resource.
 */
class SingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  async do(key, fn) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }
}

// Global scalable cache stores
const searchCache = new LRUCache({ maxSize: 1500, ttl: 24 * 60 * 60 * 1000 }); // 24 hours
const metadataCache = new LRUCache({ maxSize: 2500, ttl: 24 * 60 * 60 * 1000 }); // 24 hours
const streamUrlCache = new LRUCache({ maxSize: 1000, ttl: 3 * 60 * 60 * 1000 }); // 3 hours
const singleFlight = new SingleFlight();

module.exports = {
  LRUCache,
  SingleFlight,
  searchCache,
  metadataCache,
  streamUrlCache,
  singleFlight,
};
