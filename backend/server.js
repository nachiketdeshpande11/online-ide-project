require("dotenv").config();
const express     = require("express");
const http        = require("http");
const cors        = require("cors");
const bodyParser  = require("body-parser");
const mongoose    = require("mongoose");
const bcrypt      = require("bcryptjs");
const jwt         = require("jsonwebtoken");
const nodemailer  = require("nodemailer");
const crypto      = require("crypto");
const passport    = require("passport");
const session     = require("express-session");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const { spawn }   = require("child_process");
const fs          = require("fs");
const path        = require("path");
const { Server }  = require("socket.io");

const app        = express();
const httpServer = http.createServer(app);

/* ─────────────────────────────────────────────────────────────────
   ENV DEFAULTS
───────────────────────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 5001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_STRING";
const JWT_EXPIRY = process.env.JWT_EXPIRES_IN || "7d";

/* ─────────────────────────────────────────────────────────────────
   MIDDLEWARE
───────────────────────────────────────────────────────────────── */
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(bodyParser.json({ limit: "2mb" }));
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

/* ─────────────────────────────────────────────────────────────────
   MONGODB CONNECTION
───────────────────────────────────────────────────────────────── */
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/cloudide")
  .then(() => console.log("✅  MongoDB connected"))
  .catch((err) => {
    console.error("❌  MongoDB connection failed:", err.message);
    console.error("    → Make sure MongoDB is running: mongod");
  });

/* ─────────────────────────────────────────────────────────────────
   USER MODEL
───────────────────────────────────────────────────────────────── */
const userSchema = new mongoose.Schema(
  {
    name:              { type: String,  required: true,  trim: true },
    email:             { type: String,  required: true,  unique: true, lowercase: true, trim: true },
    password:          { type: String,  default: null },        // null for OAuth-only users
    avatar:            { type: String,  default: "" },
    provider:          { type: String,  default: "local" },     // "local" | "google" | "github"
    providerId:        { type: String,  default: null },
    isVerified:        { type: Boolean, default: false },
    verifyToken:       { type: String,  default: null },
    verifyExpiry:      { type: Date,    default: null },
    resetToken:        { type: String,  default: null },
    resetExpiry:       { type: Date,    default: null },
  },
  { timestamps: true }
);

// Hash password before saving if it changed
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password with stored hash
userSchema.methods.matchPassword = async function (plain) {
  if (!this.password) return false;
  return bcrypt.compare(plain, this.password);
};

const User = mongoose.model("User", userSchema);

/* ─────────────────────────────────────────────────────────────────
   JWT HELPERS
───────────────────────────────────────────────────────────────── */
const makeToken  = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
const readToken  = (token)  => jwt.verify(token, JWT_SECRET);

// Strip sensitive fields before sending user to client
const publicUser = (u) => ({
  id:         u._id,
  name:       u.name,
  email:      u.email,
  avatar:     u.avatar,
  provider:   u.provider,
  isVerified: u.isVerified,
  createdAt:  u.createdAt,
});

/* ─────────────────────────────────────────────────────────────────
   AUTH MIDDLEWARE
   Supports:
     1. Header:  Authorization: Bearer <token>
     2. Query:   ?token=<token>   ← needed for SSE (EventSource can't set headers)
───────────────────────────────────────────────────────────────── */
async function requireAuth(req, res, next) {
  try {
    const raw =
      req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : req.query.token || null;

    if (!raw) return res.status(401).json({ error: "No token — please sign in." });

    const payload = readToken(raw);
    const user    = await User.findById(payload.id).select(
      "-password -verifyToken -verifyExpiry -resetToken -resetExpiry"
    );
    if (!user) return res.status(401).json({ error: "Account not found." });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Token invalid or expired. Please sign in again." });
  }
}

/* ─────────────────────────────────────────────────────────────────
   EMAIL
───────────────────────────────────────────────────────────────── */
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail(to, subject, html) {
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || "CloudIDE <no-reply@cloudide.dev>",
      to,
      subject,
      html,
    });
    console.log(`📧  Email sent → ${to} [${subject}]`);
  } catch (err) {
    console.error("📧  Email failed:", err.message);
    // Don't throw — email failure shouldn't crash the request
  }
}

function emailShell(content) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#080808;font-family:system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#0f0f0f;border:1px solid #1a1a1a;border-radius:12px;overflow:hidden">
    <div style="background:#111;padding:18px 24px;border-bottom:1px solid #1a1a1a">
      <span style="font-size:17px;font-weight:700;color:#e5e5e5">☁️ CloudIDE</span>
    </div>
    <div style="padding:28px;color:#e5e5e5">${content}</div>
    <div style="padding:12px 24px;border-top:1px solid #141414;font-size:11px;color:#333;text-align:center">
      This is an automated message — do not reply.
    </div>
  </div></body></html>`;
}

const verifyEmailHtml = (name, link) => emailShell(`
  <h2 style="margin:0 0 12px;font-size:19px">Hi ${name}, verify your email 👋</h2>
  <p style="color:#888;line-height:1.7;margin:0 0 22px">Click the button below to verify your email address and activate your CloudIDE account.</p>
  <a href="${link}" style="display:inline-block;background:#e5e5e5;color:#080808;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Verify Email →</a>
  <p style="color:#555;font-size:12px;margin:22px 0 0">This link expires in <strong style="color:#888">24 hours</strong>. Didn't sign up? Ignore this email.</p>`);

const resetPasswordHtml = (name, link) => emailShell(`
  <h2 style="margin:0 0 12px;font-size:19px">Reset your password, ${name}</h2>
  <p style="color:#888;line-height:1.7;margin:0 0 22px">We received a request to reset your CloudIDE password. Click the button to choose a new one.</p>
  <a href="${link}" style="display:inline-block;background:#ef4444;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Reset Password →</a>
  <p style="color:#555;font-size:12px;margin:22px 0 0">This link expires in <strong style="color:#888">1 hour</strong>. Didn't request this? Your password won't change.</p>`);

/* ─────────────────────────────────────────────────────────────────
   PASSPORT — GOOGLE OAUTH
───────────────────────────────────────────────────────────────── */
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${SERVER_URL}/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        let user = await User.findOne({
          $or: [
            { provider: "google", providerId: profile.id },
            ...(email ? [{ email }] : []),
          ],
        });
        if (!user) {
          user = await User.create({
            name:       profile.displayName || "Google User",
            email:      email || `google_${profile.id}@oauth`,
            avatar:     (profile.photos?.[0]?.value || "").replace(/=s\d+-c/, "=s96-c"),
            provider:   "google",
            providerId: profile.id,
            isVerified: true,
          });
        } else {
          // Link/update existing account
          user.isVerified = true;
          if (!user.providerId) { user.provider = "google"; user.providerId = profile.id; }
          // Always refresh avatar from Google
          if (profile.photos?.[0]?.value) user.avatar = profile.photos[0].value.replace(/=s\d+-c/, "=s96-c");
          await user.save();
        }
        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  ));
} else {
  console.warn("⚠️   GOOGLE_CLIENT_ID not set — Google OAuth disabled");
}

/* ─────────────────────────────────────────────────────────────────
   PASSPORT — GITHUB OAUTH
───────────────────────────────────────────────────────────────── */
if (process.env.GITHUB_CLIENT_ID) {
  passport.use(new GitHubStrategy(
    {
      clientID:     process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL:  `${SERVER_URL}/auth/github/callback`,
      scope:        ["user:email"],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        let user = await User.findOne({
          $or: [
            { provider: "github", providerId: String(profile.id) },
            ...(email ? [{ email }] : []),
          ],
        });
        if (!user) {
          user = await User.create({
            name:       profile.displayName || profile.username || "GitHub User",
            email:      email || `github_${profile.id}@oauth`,
            avatar:     profile.photos?.[0]?.value || "",
            provider:   "github",
            providerId: String(profile.id),
            isVerified: true,
          });
        } else {
          user.isVerified = true;
          if (!user.providerId) { user.provider = "github"; user.providerId = String(profile.id); }
          if (!user.avatar && profile.photos?.[0]?.value) user.avatar = profile.photos[0].value;
          await user.save();
        }
        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  ));
} else {
  console.warn("⚠️   GITHUB_CLIENT_ID not set — GitHub OAuth disabled");
}

passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try { done(null, await User.findById(id)); }
  catch (e) { done(e); }
});

/* ═════════════════════════════════════════════════════════════════
   ████████╗  AUTH  ROUTES
═════════════════════════════════════════════════════════════════ */

/* ── SIGN UP ──────────────────────────────────────────────────── */
app.post("/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim())  return res.status(400).json({ error: "Full name is required." });
    if (!email?.trim()) return res.status(400).json({ error: "Email is required." });
    if (!password)      return res.status(400).json({ error: "Password is required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: "An account with this email already exists." });

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      isVerified: false,
      verifyToken,
      verifyExpiry,
    });

    const link = `${CLIENT_URL}/verify-email?token=${verifyToken}&userId=${(await User.findOne({ email: email.toLowerCase().trim() }))._id}`;
    await sendEmail(email, "Verify your CloudIDE account", verifyEmailHtml(name.trim(), link));

    res.status(201).json({
      message: "Account created! Please check your email to verify your account before signing in.",
    });
  } catch (err) {
    console.error("/auth/signup error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

/* ── VERIFY EMAIL ─────────────────────────────────────────────── */
app.post("/auth/verify-email", async (req, res) => {
  try {
    const { token, userId } = req.body;
    if (!token || !userId) return res.status(400).json({ error: "Invalid verification link." });

    const user = await User.findById(userId);
    if (!user)           return res.status(400).json({ error: "User not found." });
    if (user.isVerified) return res.json({ message: "Already verified. You can sign in.", alreadyVerified: true });

    if (user.verifyToken !== token)
      return res.status(400).json({ error: "Invalid verification token." });
    if (user.verifyExpiry < new Date())
      return res.status(400).json({ error: "Verification link has expired. Please request a new one.", expired: true });

    user.isVerified  = true;
    user.verifyToken = null;
    user.verifyExpiry = null;
    await user.save();

    const jwtToken = makeToken(user._id);
    res.json({ message: "Email verified! Welcome to CloudIDE.", token: jwtToken, user: publicUser(user) });
  } catch (err) {
    console.error("/auth/verify-email error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

/* ── RESEND VERIFICATION ──────────────────────────────────────── */
app.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Always respond with the same message to prevent email enumeration
    if (!user || user.isVerified || user.provider !== "local") {
      return res.json({ message: "If that account exists and needs verification, we sent a new link." });
    }

    user.verifyToken  = crypto.randomBytes(32).toString("hex");
    user.verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const link = `${CLIENT_URL}/verify-email?token=${user.verifyToken}&userId=${user._id}`;
    await sendEmail(user.email, "Verify your CloudIDE account", verifyEmailHtml(user.name, link));

    res.json({ message: "Verification email resent! Check your inbox (and spam folder)." });
  } catch (err) {
    console.error("/auth/resend-verification error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

/* ── SIGN IN ──────────────────────────────────────────────────── */
app.post("/auth/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) return res.status(401).json({ error: "No account found with this email." });

    if (user.provider !== "local") {
      return res.status(401).json({
        error: `This account uses ${user.provider === "google" ? "Google" : "GitHub"} sign-in. Use the button below.`,
        oauthProvider: user.provider,
      });
    }

    const match = await user.matchPassword(password);
    if (!match) return res.status(401).json({ error: "Incorrect password." });

    if (!user.isVerified) {
      return res.status(403).json({
        error: "Email not verified. Check your inbox or click 'Resend verification email'.",
        notVerified: true,
        email: user.email,
      });
    }

    const token = makeToken(user._id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("/auth/signin error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

/* ── FORGOT PASSWORD ──────────────────────────────────────────── */
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    // Always respond the same to prevent enumeration
    const safe = { message: "If an account exists with that email, we sent a reset link." };

    const user = await User.findOne({ email: email.toLowerCase().trim(), provider: "local" });
    if (!user) return res.json(safe);

    user.resetToken  = crypto.randomBytes(32).toString("hex");
    user.resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    const link = `${CLIENT_URL}/reset-password?token=${user.resetToken}&userId=${user._id}`;
    await sendEmail(user.email, "Reset your CloudIDE password", resetPasswordHtml(user.name, link));

    res.json(safe);
  } catch (err) {
    console.error("/auth/forgot-password error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

/* ── RESET PASSWORD ───────────────────────────────────────────── */
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, userId, password } = req.body;
    if (!token || !userId || !password)
      return res.status(400).json({ error: "All fields are required." });
    if (password.length < 8)
      return res.status(400).json({ error: "Password must be at least 8 characters." });

    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ error: "User not found." });

    if (user.resetToken !== token)
      return res.status(400).json({ error: "Invalid reset token." });
    if (user.resetExpiry < new Date())
      return res.status(400).json({ error: "Reset link has expired. Please request a new one." });

    user.password    = password; // will be hashed by pre-save hook
    user.resetToken  = null;
    user.resetExpiry = null;
    await user.save();

    res.json({ message: "Password reset successfully! You can now sign in with your new password." });
  } catch (err) {
    console.error("/auth/reset-password error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

/* ── GET CURRENT USER ─────────────────────────────────────────── */
app.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ── UPDATE PROFILE ───────────────────────────────────────────── */
app.put("/auth/profile", requireAuth, async (req, res) => {
  try {
    const { name, avatar } = req.body;
    if (name?.trim())      req.user.name   = name.trim();
    if (avatar !== undefined) req.user.avatar = avatar;
    await req.user.save();
    res.json({ user: publicUser(req.user) });
  } catch (err) {
    res.status(500).json({ error: "Server error." });
  }
});

/* ── CHANGE PASSWORD ──────────────────────────────────────────── */
app.put("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (req.user.provider !== "local")
      return res.status(400).json({ error: "OAuth accounts cannot change password here." });
    const user = await User.findById(req.user._id);
    if (!await user.matchPassword(currentPassword))
      return res.status(401).json({ error: "Current password is incorrect." });
    if (newPassword.length < 8)
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    user.password = newPassword;
    await user.save();
    res.json({ message: "Password changed successfully." });
  } catch (err) {
    res.status(500).json({ error: "Server error." });
  }
});

/* ─────────────────────────────────────────────────────────────────
   GOOGLE OAUTH ROUTES
───────────────────────────────────────────────────────────────── */
app.get("/auth/google",
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect(`${CLIENT_URL}?authError=Google OAuth not configured`);
    }
    next();
  },
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${CLIENT_URL}?authError=Google sign-in failed`,
  }),
  (req, res) => {
    const token = makeToken(req.user._id);
    const user  = encodeURIComponent(JSON.stringify(publicUser(req.user)));
    res.redirect(`${CLIENT_URL}?oauthToken=${token}&oauthUser=${user}`);
  }
);

/* ─────────────────────────────────────────────────────────────────
   GITHUB OAUTH ROUTES
───────────────────────────────────────────────────────────────── */
app.get("/auth/github",
  (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID) {
      return res.redirect(`${CLIENT_URL}?authError=GitHub OAuth not configured`);
    }
    next();
  },
  passport.authenticate("github", { scope: ["user:email"] })
);

app.get("/auth/github/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: `${CLIENT_URL}?authError=GitHub sign-in failed`,
  }),
  (req, res) => {
    const token = makeToken(req.user._id);
    const user  = encodeURIComponent(JSON.stringify(publicUser(req.user)));
    res.redirect(`${CLIENT_URL}?oauthToken=${token}&oauthUser=${user}`);
  }
);

/* ─────────────────────────────────────────────────────────────────
   HEALTH CHECK
───────────────────────────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({
    status:    "ok",
    timestamp: new Date().toISOString(),
    db:        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    languages: Object.keys(LANG_CONFIG),
    oauth: {
      google: !!process.env.GOOGLE_CLIENT_ID,
      github: !!process.env.GITHUB_CLIENT_ID,
    },
  });
});

/* ═════════════════════════════════════════════════════════════════
   ████████╗  IDE  RUNNER
═════════════════════════════════════════════════════════════════ */
const LANG_CONFIG = {
  python: {
    image: "python:3.11-slim",
    ext: "py",
    runCmd: (f) => `python -u /app/${f}`,
  },
  javascript: {
    image: "node:20-slim",
    ext: "js",
    runCmd: (f) => `node /app/${f}`,
  },
  typescript: {
    image: "node:20-slim",
    ext: "ts",
    runCmd: (f) =>
      `sh -c "cd /tmp && npm install --save-dev ts-node typescript @types/node --prefer-offline --silent 2>/dev/null; ./node_modules/.bin/ts-node --skipProject /app/${f}"`,
  },
  java: {
    image: "eclipse-temurin:21-jdk-alpine",
    ext: "java",
    fixedFilename: "Main.java",
    runCmd: (f) =>
      `sh -c "mkdir -p /tmp/jclass && javac /app/${f} -d /tmp/jclass 2>&1 && java -cp /tmp/jclass Main"`,
    preprocess: (code) =>
      code.replace(/public\s+class\s+\w+/g, (m, _, str) => "public class Main"),
  },
  c: {
    image: "gcc:13",
    ext: "c",
    runCmd: (f) => `sh -c "gcc -o /tmp/prog /app/${f} -lm -std=c11 2>&1 && /tmp/prog"`,
  },
  cpp: {
    image: "gcc:13",
    ext: "cpp",
    runCmd: (f) => `sh -c "g++ -o /tmp/prog /app/${f} -lm -std=c++17 2>&1 && /tmp/prog"`,
  },
  rust: {
    image: "rust:1.78-slim",
    ext: "rs",
    runCmd: (f) => `sh -c "rustc /app/${f} -o /tmp/prog 2>&1 && /tmp/prog"`,
  },
};

function getFilename(cfg, suffix) {
  return cfg.fixedFilename || `code_${suffix}.${cfg.ext}`;
}

function dockerArgs(cfg, filename, workDir) {
  return [
    "run", "--rm", "-i",
    "--network", "none",
    "--memory", "512m",
    "--cpus", "1.0",
    "-v", `${workDir}:/app:ro`,
    "--workdir", "/app",
    cfg.image,
    "sh", "-c", `timeout 30s ${cfg.runCmd(filename)}`,
  ];
}

/* Active interactive sessions */
const sessions = new Map();

/* ── POST /run  (batch) ── */
app.post("/run", requireAuth, async (req, res) => {
  const { code, language = "python", stdin = "" } = req.body;
  if (!code?.trim()) return res.status(400).json({ output: "No code provided." });

  const lang = language.toLowerCase().trim();
  const cfg  = LANG_CONFIG[lang];
  if (!cfg) return res.json({ output: `Unsupported language: ${lang}` });

  const suffix  = Date.now();
  const code2   = cfg.preprocess ? cfg.preprocess(code) : code;
  const fname   = getFilename(cfg, suffix);
  const workDir = path.join(__dirname, `tmp_${suffix}`);

  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, fname), code2, "utf8");

  const proc = spawn("docker", dockerArgs(cfg, fname, workDir), { timeout: 90000 });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data",  (d) => { out += d; });
  if (stdin) proc.stdin.write(stdin.endsWith("\n") ? stdin : stdin + "\n");
  proc.stdin.end();

  const cleanup = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {} };
  proc.on("close", () => { cleanup(); res.json({ output: out.trim() || "(no output)" }); });
  proc.on("error", (e) => { cleanup(); res.json({ output: `Docker error: ${e.message}` }); });
});

/* ── POST /run-interactive/start ── */
app.post("/run-interactive/start", requireAuth, (req, res) => {
  const { code, language = "python" } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "No code provided." });

  const lang = language.toLowerCase().trim();
  const cfg  = LANG_CONFIG[lang];
  if (!cfg) return res.status(400).json({ error: `Unsupported language: ${lang}` });

  const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const suffix    = Date.now();
  const code2     = cfg.preprocess ? cfg.preprocess(code) : code;
  const fname     = getFilename(cfg, suffix);
  const workDir   = path.join(__dirname, `tmp_${sessionId}`);

  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, fname), code2, "utf8");

  console.log(`[START] ${sessionId} lang=${lang} user=${req.user.email}`);
  const proc = spawn("docker", dockerArgs(cfg, fname, workDir));

  const buf       = [];   // output chunk buffer
  const listeners = [];   // SSE flush callbacks
  let   done      = false;

  const push = (chunk) => { buf.push(chunk); listeners.forEach((fn) => fn()); };

  proc.stdout.on("data", (d) => push({ type: "stdout", data: d.toString() }));
  proc.stderr.on("data", (d) => push({ type: "stderr", data: d.toString() }));
  proc.on("close", (code) => {
    done = true;
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    push({ type: "exit", code });
    console.log(`[EXIT] ${sessionId} code=${code}`);
  });
  proc.on("error", (err) => {
    done = true;
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    push({ type: "error", data: err.message });
  });

  sessions.set(sessionId, { proc, buf, listeners, isDone: () => done, workDir });

  // Auto-cleanup after 3 min
  setTimeout(() => {
    const s = sessions.get(sessionId);
    if (!s) return;
    try { s.proc.kill(); } catch (_) {}
    try { fs.rmSync(s.workDir, { recursive: true, force: true }); } catch (_) {}
    sessions.delete(sessionId);
    console.log(`[CLEANUP] ${sessionId}`);
  }, 180_000);

  res.json({ sessionId });
});

/* ── GET /run-interactive/output/:id  (SSE — auth via ?token=) ── */
app.get("/run-interactive/output/:sessionId", requireAuth, (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: "Session not found" });

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", CLIENT_URL);
  res.flushHeaders();

  let idx = 0;
  const flush = () => {
    while (idx < s.buf.length) {
      const chunk = s.buf[idx++];
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === "exit" || chunk.type === "error") { res.end(); return; }
    }
    if (s.isDone()) res.end();
  };

  flush();
  s.listeners.push(flush);
  req.on("close", () => {
    const i = s.listeners.indexOf(flush);
    if (i !== -1) s.listeners.splice(i, 1);
  });
});

/* ── POST /run-interactive/input/:id ── */
app.post("/run-interactive/input/:sessionId", requireAuth, (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: "Session not found" });
  const line = (req.body.input || "") + "\n";
  try { s.proc.stdin.write(line); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /run-interactive/:id ── */
app.delete("/run-interactive/:sessionId", requireAuth, (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (s) {
    try { s.proc.kill(); } catch (_) {}
    try { fs.rmSync(s.workDir, { recursive: true, force: true }); } catch (_) {}
    sessions.delete(req.params.sessionId);
  }
  res.json({ ok: true });
});

// Avatar proxy — fetches Google/GitHub avatars server-side to avoid browser CORS/CSP issues
app.get("/auth/avatar", requireAuth, async (req, res) => {
  const avatarUrl = req.user.avatar;
  if (!avatarUrl) return res.status(404).end();
  try {
    const https = require("https");
    const http2 = require("http");
    const mod   = avatarUrl.startsWith("https") ? https : http2;
    mod.get(avatarUrl, (imgRes) => {
      res.setHeader("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      imgRes.pipe(res);
    }).on("error", () => res.status(502).end());
  } catch { res.status(500).end(); }
});

/* ─────────────────────────────────────────────────────────────────
   SOCKET.IO — COLLABORATIVE EDITING
───────────────────────────────────────────────────────────────── */
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"], credentials: true },
});

// collabRooms: roomId -> { code, lang, users: Map<socketId, {name,avatar,color}> }
const collabRooms = new Map();

const USER_COLORS = [
  "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#ec4899","#84cc16","#14b8a6",
];

function getRoomColor(room) {
  const used = new Set([...room.users.values()].map(u => u.color));
  return USER_COLORS.find(c => !used.has(c)) || USER_COLORS[0];
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error("No token"));
  try {
    const payload = readToken(token);
    User.findById(payload.id).select("name email avatar").then(user => {
      if (!user) return next(new Error("User not found"));
      socket.user = { id: user._id.toString(), name: user.name, email: user.email, avatar: user.avatar };
      next();
    }).catch(() => next(new Error("Auth error")));
  } catch {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const { user } = socket;
  console.log(`[WS] ${user.name} connected (${socket.id})`);

  socket.on("collab:join", ({ roomId, code, lang }) => {
    [...socket.rooms].filter(r => r !== socket.id).forEach(r => socket.leave(r));
    socket.join(roomId);
    if (!collabRooms.has(roomId)) {
      collabRooms.set(roomId, { code: code || "", lang: lang || "python", users: new Map() });
    }
    const room = collabRooms.get(roomId);
    const color = getRoomColor(room);
    room.users.set(socket.id, { ...user, color, socketId: socket.id });
    socket.emit("collab:state", { code: room.code, lang: room.lang, users: [...room.users.values()] });
    socket.to(roomId).emit("collab:users", [...room.users.values()]);
    io.to(roomId).emit("collab:users", [...room.users.values()]);
    console.log(`[WS] ${user.name} joined room ${roomId} (${room.users.size} users)`);
  });

  socket.on("collab:code", ({ roomId, code }) => {
    const room = collabRooms.get(roomId);
    if (!room) return;
    room.code = code;
    socket.to(roomId).emit("collab:code", { code, from: socket.id });
  });

  socket.on("collab:lang", ({ roomId, lang }) => {
    const room = collabRooms.get(roomId);
    if (!room) return;
    room.lang = lang;
    socket.to(roomId).emit("collab:lang", { lang, from: socket.id });
  });

  socket.on("collab:cursor", ({ roomId, line, column }) => {
    const room = collabRooms.get(roomId);
    if (!room) return;
    const u = room.users.get(socket.id);
    if (u) { u.line = line; u.column = column; }
    socket.to(roomId).emit("collab:cursor", { socketId: socket.id, line, column, user: room.users.get(socket.id) });
  });

  socket.on("collab:leave", ({ roomId }) => leaveRoom(socket, roomId));

  socket.on("disconnect", () => {
    [...socket.rooms].filter(r => r !== socket.id).forEach(r => leaveRoom(socket, r));
    console.log(`[WS] ${user.name} disconnected`);
  });
});

function leaveRoom(socket, roomId) {
  const room = collabRooms.get(roomId);
  if (!room) return;
  room.users.delete(socket.id);
  socket.leave(roomId);
  if (room.users.size === 0) {
    collabRooms.delete(roomId);
    console.log(`[WS] Room ${roomId} closed (empty)`);
  } else {
    io.to(roomId).emit("collab:users", [...room.users.values()]);
  }
}

// REST: get a fresh room ID
app.get("/collab/new-room", requireAuth, (_req, res) => {
  const roomId = crypto.randomBytes(4).toString("hex").toUpperCase();
  res.json({ roomId });
});

/* ─────────────────────────────────────────────────────────────────
   START SERVER
───────────────────────────────────────────────────────────────── */
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   ☁️   CloudIDE Server  v6.0                 ║
║   Port    : ${PORT}                               ║
║   Client  : ${CLIENT_URL.padEnd(28)}  ║
║   Auth    : JWT + Email + Google + GitHub    ║
║   DB      : MongoDB                          ║
║   Collab  : Socket.io (real-time rooms)      ║
╚══════════════════════════════════════════════╝`);
});
