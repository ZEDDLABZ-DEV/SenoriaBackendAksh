import argon2 from "argon2";

function options(): argon2.Options {
  if (process.env.NODE_ENV === "test") {
    return {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    };
  }
  return {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options());
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
