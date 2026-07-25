// 用法: bun run scripts/verify-crypto-fixtures.ts <vectors.json>
// 用 WebCrypto 解密 Rust 生成的向量，全部成功则 exit 0
import { importKeyFromBase64 } from "../src/crypto/derive.js";
import { decrypt } from "../src/crypto/encrypt.js";

const file = process.argv[2];
const v = JSON.parse(await Bun.file(file).text());
const key = await importKeyFromBase64(v.keyBase64);
for (const c of v.cases) {
  const pt = await decrypt(key, c.ciphertext);
  if (pt !== c.plaintext) {
    console.error("mismatch:", { expected: c.plaintext, got: pt });
    process.exit(1);
  }
}
console.log(`OK: ${v.cases.length} vectors decrypted`);
