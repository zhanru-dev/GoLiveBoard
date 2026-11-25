import { Injectable, Module } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with the parameters OWASP recommends (19 MiB of memory, two
 * passes): slow enough to make guessing stolen hashes expensive, fast enough
 * (tens of milliseconds) for a sign-in.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes and checks passwords. A provider rather than plain functions, so a
 * test can pause a sign-in between checking the password and starting the
 * session, which is how the race with a password reset is proven closed.
 */
@Injectable()
export class PasswordHasher {
  /**
   * Verified against when the email address is unknown, so a sign-in for an
   * account that does not exist takes as long as one with a wrong password
   * and response timing does not reveal which accounts exist.
   */
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash("not-a-real-password-just-for-timing");
    await this.verify(await this.dummyHash, password);
    return false;
  }
}

/** Shared by the auth and workspace modules, so both use one instance. */
@Module({ providers: [PasswordHasher], exports: [PasswordHasher] })
export class PasswordHasherModule {}
