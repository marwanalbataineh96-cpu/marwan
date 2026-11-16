const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEY = process.env.ANTHROPIC_API_KEY;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SECRET = process.env.SESSION_SECRET;
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, "users.json");

if (!KEY || !CLIENT_ID || !SECRET) {
  console.error("ناقص متغير: ANTHROPIC_API_KEY أو GOOGLE_CLIENT_ID أو SESSION_SECRET");
  process.exit(1);
}

const SYSTEM = `أنت "مروان"، مساعد تعليمي ودود للطلاب. اشرح الدروس بوضوح وبخطوات بسيطة، وحل الأسئلة مع توضيح طريقة الحل، وأنشئ أسئلة تدريبية عند الطلب. رد بنفس لغة الطالب، وبنص عادي مرتب بدون تنسيق markdown معقد.`;

function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return {}; } }
function saveUser(u) {
  const users = loadUsers();
  users[u.sub] = { ...users[u.sub], ...u, lastLogin: new Date().toISOString() };
  if (!users[u.sub].createdAt) users[u.sub].createdAt = users[u.sub].lastLogin;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 7 * 864e5 })).toString("base64url");
  return payload + "." + sign(payload);
}
function readSession(req) {
  const m = (req.headers.cookie || "").match(/(?:^|; )session=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const u = JSON.parse(Buffer.from(payload, "base64url").toString());
  return u.exp > Date.now() ? u : null;
}
function cookie(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

const hits = new Map();
function allowed(sub) {
  const now = Date.now(), arr = (hits.get(sub) || []).filter(t => now - t < 36e5);
  if (arr.length >= 30) return false;
  arr.push(now); hits.set(sub, arr); return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 1e5) reject(new Error("too big")); });
    req.on("end", () => resolve(d));
  });
}
const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }

    if (req.method === "GET" && req.url === "/api/me") {
      const u = readSession(req);
      return json(res, 200, { clientId: CLIENT_ID, user: u ? { name: u.name, picture: u.picture } : null });
    }

    if (req.method === "POST" && req.url === "/api/login") {
      const { credential } = JSON.parse(await readBody(req));
      const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
      const t = await r.json();
      if (!r.ok || t.aud !== CLIENT_ID || t.email_verified !== "true") return json(res, 401, { error: "invalid token" });
      const user = { sub: t.sub, email: t.email, name: t.name || t.email, picture: t.picture || "" };
      saveUser(user);
      return json(res, 200, { user: { name: user.name, picture: user.picture } },
        { "Set-Cookie": cookie(req, makeSession(user), 7 * 86400) });
    claude-sonnet-4-20250514

    if (req.method === "POST" && req.url === "/api/logout") {
      return json(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) });
    }

    if (req.method === "POST" && req.url === "/api/ask") {
      const u = readSession(req);
      if (!u) return json(res, 401, { error: "login required" });
      if (!allowed(u.sub)) return json(res, 429, { error: "too many questions, try later" });
      const { question, history = [] } = JSON.parse(await readBody(req));
      if (!question) return json(res, 400, { error: "no question" });
      const messages = [...history.slice(-10), { role: "user", content: question }];
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1500, system: SYSTEM, messages })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || "API error");
      return json(res, 200, { answer: data.content.filter(b => b.type === "text").map(b => b.text).join("\n") });
    }

    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e.message);
    json(res, 500, { error: "server error" });
  }
}).listen(PORT, () => console.log("Marwan running on port " + PORT));
