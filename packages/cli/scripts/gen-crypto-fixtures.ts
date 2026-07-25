// 用法: bun run scripts/gen-crypto-fixtures.ts
// 用 TS WebCrypto 实现（src/crypto/）生成 Rust 交叉测试向量
import { deriveKey, exportKeyToBase64 } from "../src/crypto/derive.js";
import { encrypt } from "../src/crypto/encrypt.js";

const password = "test-master-password-🔑";
const saltBase64 = "AAECAwQFBgcICQoLDA0ODw=="; // 固定 salt，向量可复现
const key = await deriveKey(password, saltBase64);
const keyBase64 = await exportKeyToBase64(key);

const plaintexts = [
  "sk-ant-api03-abcdef123456",
  "",                                            // 空串
  "中文密钥-テスト-🔐",                            // 多字节 UTF-8
  "x".repeat(4096),                              // 长字符串
  JSON.stringify({ apiKey: "sk-live-123", baseURL: "https://api.example.com" }),
];

const cases = [];
for (const plaintext of plaintexts) {
  cases.push({ plaintext, ciphertext: await encrypt(key, plaintext) });
}

const out = { password, saltBase64, keyBase64, cases };
await Bun.write(
  new URL("../crates/server/tests/fixtures/crypto_ts_vectors.json", import.meta.url),
  JSON.stringify(out, null, 2)
);
console.log("keyBase64:", keyBase64);
