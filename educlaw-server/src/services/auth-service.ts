import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { UserSummary } from "@educlaw/shared";
import { config } from "../config.js";
import { getLogger } from "../lib/request-context.js";
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

export async function registerUserWithInvite(username: string, password: string, inviteCode: string) {
  const expectedInvite = config.inviteCode.trim();
  if (!expectedInvite) {
    throw new Error("注册暂未开放");
  }
  if (inviteCode.trim() !== expectedInvite) {
    throw new Error("邀请码无效");
  }
  return registerUser(username, password);
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

export async function seedUsers() {
  if (!config.seedUsers) return;
  if (config.isProduction && (config.seedUserPassword === "educlaw123" || config.seedUserPassword.length < 12)) {
    throw new Error("SEED_USER_PASSWORD must be changed before enabling seeded users in production");
  }

  const hash = await bcrypt.hash(config.seedUserPassword, 10);
  for (const username of config.seedUserNames) {
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
      getLogger({ component: "auth" }).info({
        event: "seed.user.created",
        username,
      });
    }
  }
}
