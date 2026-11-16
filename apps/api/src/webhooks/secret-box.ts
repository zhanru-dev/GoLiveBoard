import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed secret, and the ID of the key that sealed it. */
export interface Sealed {
  readonly ciphertext: Buffer;
  readonly keyId: string;
}

/** A short, stable name for a key, stored beside what it sealed. */
export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Seals webhook signing secrets at rest with AES-256-GCM (docs/02, section
 * 7.8): a random IV per secret, the tag checked on opening. Opens with the
 * current key or the previous one, so the key can be rotated: new secrets
 * use the current key, and old ones still open until re-sealed.
 */
export class SecretBox {
  private readonly keys: Map<string, Buffer>;
  /** The ID of the previous key, if one is configured. */
  readonly previousKeyId: string | undefined;

  constructor(
    private readonly current: Buffer,
    previous?: Buffer,
  ) {
    if (
      current.length !== 32 ||
      (previous !== undefined && previous.length !== 32)
    ) {
      throw new Error("AES-256-GCM keys are 32 bytes");
    }
    this.keys = new Map([[keyIdOf(current), current]]);
    this.previousKeyId = previous === undefined ? undefined : keyIdOf(previous);
    if (previous !== undefined) {
      this.keys.set(keyIdOf(previous), previous);
    }
  }

  /** The ID of the key `seal` uses. */
  get currentKeyId(): string {
    return keyIdOf(this.current);
  }

  seal(secret: string): Sealed {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.current, iv);
    const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
      keyId: keyIdOf(this.current),
    };
  }

  /** @throws when no key has that ID, or the ciphertext was altered */
  open(sealed: Sealed): string {
    const key = this.keys.get(sealed.keyId);
    if (key === undefined) {
      throw new Error("The key that sealed this secret is not configured");
    }
    const iv = sealed.ciphertext.subarray(0, IV_BYTES);
    const tag = sealed.ciphertext.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = sealed.ciphertext.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  }
}
