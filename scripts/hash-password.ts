/** npm run hash-password -- 'your password' — print ADMIN_PASSWORD_HASH for .env (scrypt). */
import { hashPassword } from "../src/server/crypto";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error("Usage: npm run hash-password -- '<password of at least 10 characters>'");
  process.exit(1);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
