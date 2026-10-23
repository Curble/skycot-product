// Rate limits, kept in the home's own Durable Object memory. A home is one family, so its
// limits sit in one place without any shared store; when the object sleeps the buckets start
// full again, which only ever errs towards letting a real family through.

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(capacity: number, refillPerSecond: number, now: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now: number, cost = 1): boolean {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Buckets by key, created on first use, oldest forgotten past a bound. */
export class BucketMap {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxKeys: number;

  constructor(capacity: number, refillPerSecond: number, maxKeys = 1024) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.maxKeys = maxKeys;
  }

  take(key: string, now: number, cost = 1): boolean {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = new TokenBucket(this.capacity, this.refillPerSecond, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now, cost);
  }
}

/** Every number in one place, so the deployment notes and the tests agree. */
export const LIMITS = {
  /** Device connections a home may hold at once. */
  devicesPerHome: 64,
  /** Connections one device may hold at once (tabs, a phone and its widget). */
  connectionsPerDevice: 4,
  /** New device connections per home: burst, then per second. */
  homeConnects: { burst: 30, perSecond: 0.5 },
  /** New connections from one network address (any home). */
  addressConnects: { burst: 20, perSecond: 0.2 },
  /** The Mac reconnecting. */
  hostConnects: { burst: 6, perSecond: 0.1 },
  /** Frames from one device: burst, then per second. */
  deviceFrames: { burst: 400, perSecond: 200 },
  /** Frames from all of a home's devices together. */
  homeFrames: { burst: 1200, perSecond: 600 },
  /** Bytes per second from one device (sealed bytes; bursts allowed for uploads). */
  deviceBytes: { burst: 8 * 1024 * 1024, perSecond: 2 * 1024 * 1024 },
  /** Notifications a home may send. */
  homePushes: { burst: 30, perSecond: 0.2 },
  /** Notifications to one device reference. */
  refPushes: { burst: 6, perSecond: 0.05 },
  /** Push token registrations from one device. */
  pushRegistrations: { burst: 5, perSecond: 0.01 },
  /** How long a socket may stay connected without saying who it is. */
  helloTimeoutMs: 15_000,
} as const;
