import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserSummary } from "@educlaw/shared";
import { config } from "../config.js";
import { newId, query } from "./db.js";
import type { DbRowUser } from "../types.js";

function toSummary(row: DbRowUser): UserSummary {
  return { id: row.id, username: row.username };
}

export async function registerUser(username: string, password: string) {
  const normalized = username.trim();
  if (!normalized || password.length < 6) {
    throw new Error("\u8bf7\u8f93\u5165\u7528\u6237\u540d\u548c\u5bc6\u7801\uff0c\u4e14\u5bc6\u7801\u81f3\u5c11 6 \u4f4d\u3002");
  }

  const exists = await query<DbRowUser>("select * from users where username = $1", [normalized]);
  if (exists.rows[0]) {
    throw new Error("\u7528\u6237\u540d\u5df2\u5b58\u5728");
  }

  const row: DbRowUser = {
    id: newId(),
    username: normalized,
    password_hash: await bcrypt.hash(password, 10),
    created_at: new Date().toISOString(),
  };

  await query(
    "insert into users (id, username, password_hash, created_at) values ($1, $2, $3, $4)",
    [row.id, row.username, row.password_hash, row.created_at],
  );

  return issueToken(row);
}

export async function loginUser(username: string, password: string) {
  const result = await query<DbRowUser>("select * from users where username = $1", [username.trim()]);
  const row = result.rows[0];
  if (!row) throw new Error("\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef");
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) throw new Error("\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef");
  return issueToken(row);
}

function issueToken(row: DbRowUser) {
  const user = toSummary(row);
  const token = jwt.sign({ sub: row.id, username: row.username }, config.jwtSecret, { expiresIn: "7d" });
  return { token, user };
}

export async function getUserById(userId: string) {
  const result = await query<DbRowUser>("select * from users where id = $1", [userId]);
  const row = result.rows[0];
  return row ? toSummary(row) : null;
}

export function verifyToken(token: string): { sub: string } {
  return jwt.verify(token, config.jwtSecret) as { sub: string };
}

const SEED_USERS = [
  "user1", "user2", "user3", "user4", "user5",
  "user6", "user7", "user8", "user9", "user10",
  "user11", "user12", "user13", "user14", "user15",
];
const SEED_PASSWORD = "educlaw123";

export async function seedUsers() {
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  for (const username of SEED_USERS) {
    const exists = await query<DbRowUser>("select * from users where username = $1", [username]);
    if (!exists.rows[0]) {
      const row: DbRowUser = {
        id: newId(),
        username,
        password_hash: hash,
        created_at: new Date().toISOString(),
      };
      await query(
        "insert into users (id, username, password_hash, created_at) values ($1, $2, $3, $4)",
        [row.id, row.username, row.password_hash, row.created_at],
      );
      console.log(`[seed] Created user: ${username}`);
    }
  }
}
