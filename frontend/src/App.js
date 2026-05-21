import React, {
  useState, useEffect, useRef, useCallback,
  createContext, useContext,
} from "react";
import Editor from "@monaco-editor/react";
import { io as socketIO } from "socket.io-client";
import {
  FaPlay, FaStop, FaGithub, FaChevronDown, FaChevronRight,
  FaRobot, FaCog, FaSave, FaSignOutAlt, FaUser, FaLock, FaEye, FaEyeSlash,
  FaCode, FaPlus, FaTimes, FaTerminal, FaExpandAlt, FaCompressAlt,
  FaRegCopy, FaDownload, FaFolderOpen, FaFile,
  FaTrash, FaEdit, FaUpload, FaBolt, FaCoffee, FaEnvelope,
  FaCheckCircle, FaArrowLeft, FaExclamationTriangle, FaUsers, FaCopy,
} from "react-icons/fa";
import { SiPython, SiJavascript, SiTypescript, SiRust, SiCplusplus, SiC } from "react-icons/si";
import { VscFiles, VscSourceControl, VscDebugAlt, VscSearch } from "react-icons/vsc";

/* ─────────────────────────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────────────────────────── */
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

/* ─────────────────────────────────────────────────────────────────
   LANGUAGE CONFIG
───────────────────────────────────────────────────────────────── */
const LANGS = {
  python:     { icon: SiPython,     color: "#3b82f6", label: "Python",     version: "3.11",    monacoLang: "python",     ext: "py"   },
  javascript: { icon: SiJavascript, color: "#eab308", label: "JavaScript", version: "Node 20", monacoLang: "javascript", ext: "js"   },
  typescript: { icon: SiTypescript, color: "#60a5fa", label: "TypeScript", version: "5.4",     monacoLang: "typescript", ext: "ts"   },
  java:       { icon: FaCoffee,     color: "#f97316", label: "Java",       version: "21",      monacoLang: "java",       ext: "java" },
  c:          { icon: SiC,          color: "#6366f1", label: "C",          version: "C11",     monacoLang: "c",          ext: "c"    },
  cpp:        { icon: SiCplusplus,  color: "#a78bfa", label: "C++",        version: "C++17",   monacoLang: "cpp",        ext: "cpp"  },
  rust:       { icon: SiRust,       color: "#fb923c", label: "Rust",       version: "1.78",    monacoLang: "rust",       ext: "rs"   },
};

const DEFAULT_CODE = {
  python:     `# Python 3.11\nprint("Hello, World!")\nname = input("Enter your name: ")\nprint(f"Hello, {name}!")\n`,
  javascript: `// Node 20\nconst readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nconsole.log("Hello, World!");\nrl.question("Enter your name: ", name => {\n  console.log(\`Hello, \${name}!\`);\n  rl.close();\n});\n`,
  typescript: `// TypeScript 5.4\nimport * as readline from 'readline';\nconst rl = readline.createInterface({ input: process.stdin });\nconsole.log("Hello, World!");\nrl.question("Enter your name: ", (name: string) => {\n  console.log(\`Hello, \${name}!\`);\n  rl.close();\n});\n`,
  java:       `// Java 21\nimport java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println("Hello, World!");\n        System.out.print("Enter your name: ");\n        String name = sc.nextLine();\n        System.out.println("Hello, " + name + "!");\n    }\n}\n`,
  c:          `// C11\n#include <stdio.h>\n\nint main() {\n    char name[100];\n    printf("Hello, World!\\n");\n    printf("Enter your name: ");\n    fflush(stdout);\n    scanf("%99s", name);\n    printf("Hello, %s!\\n", name);\n    return 0;\n}\n`,
  cpp:        `// C++17\n#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string name;\n    cout << "Hello, World!" << endl;\n    cout << "Enter your name: ";\n    cin >> name;\n    cout << "Hello, " << name << "!" << endl;\n    return 0;\n}\n`,
  rust:       `// Rust 1.78\nuse std::io::{self, BufRead, Write};\n\nfn main() {\n    println!("Hello, World!");\n    print!("Enter your name: ");\n    io::stdout().flush().unwrap();\n    let stdin = io::stdin();\n    let name = stdin.lock().lines().next().unwrap().unwrap();\n    println!("Hello, {}!", name);\n}\n`,
};

const EXT_TO_LANG = { py:"python", js:"javascript", ts:"typescript", java:"java", c:"c", cpp:"cpp", cc:"cpp", rs:"rust" };

let _uid = 1;
const uid = () => _uid++;

/* ─────────────────────────────────────────────────────────────────
   AUTH CONTEXT
───────────────────────────────────────────────────────────────── */
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(null);
  const [loading, setLoading] = useState(true);

  /* On mount — handle OAuth redirect OR restore token from localStorage */
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search);
    const oauthToken = params.get("oauthToken");
    const oauthUser  = params.get("oauthUser");
    const authError  = params.get("authError");

    // Clear query params from URL without reload
    if (oauthToken || authError) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (authError) {
      // Will be shown on the sign-in page via a separate mechanism
      sessionStorage.setItem("authError", authError);
      setLoading(false);
      return;
    }

    if (oauthToken && oauthUser) {
      try {
        const parsed = JSON.parse(decodeURIComponent(oauthUser));
        localStorage.setItem("cide_token", oauthToken);
        setToken(oauthToken);
        setUser(parsed);
      } catch (_) {}
      setLoading(false);
      return;
    }

    // Restore from localStorage
    const stored = localStorage.getItem("cide_token");
    if (!stored) { setLoading(false); return; }

    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.user) { setToken(stored); setUser(d.user); }
        else        { localStorage.removeItem("cide_token"); }
      })
      .catch(() => localStorage.removeItem("cide_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((tok, usr) => {
    localStorage.setItem("cide_token", tok);
    setToken(tok);
    setUser(usr);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("cide_token");
    setToken(null);
    setUser(null);
  }, []);

  /* Authenticated fetch — auto-attaches token header */
  const apiFetch = useCallback(
    (url, opts = {}) => {
      const tok = localStorage.getItem("cide_token");
      return fetch(`${API_URL}${url}`, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          ...opts.headers,
        },
      });
    },
    []
  );

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, logout, apiFetch }}>
      {children}
    </AuthCtx.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────
   SIMPLE ROUTER (no react-router needed)
───────────────────────────────────────────────────────────────── */
function useRoute() {
  const [route, setRoute] = useState(() => {
    const p = window.location.pathname;
    if (p === "/verify-email")   return "verify-email";
    if (p === "/reset-password") return "reset-password";
    return "signin";
  });

  const navigate = useCallback((r) => {
    const pathMap = {
      "signin":         "/",
      "signup":         "/",
      "forgot":         "/",
      "verify-email":   "/verify-email",
      "reset-password": "/reset-password",
    };
    window.history.pushState({}, "", pathMap[r] || "/");
    setRoute(r);
  }, []);

  return { route, navigate };
}

/* ─────────────────────────────────────────────────────────────────
   SHARED UI ATOMS
───────────────────────────────────────────────────────────────── */
const T = {
  root:  { fontFamily:"'Geist',sans-serif",minHeight:"100vh",background:"#080808",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden" },
  grid:  { position:"fixed",inset:0,backgroundImage:"radial-gradient(circle,#1c1c1c 1px,transparent 1px)",backgroundSize:"24px 24px",pointerEvents:"none" },
  glow1: { position:"fixed",top:"15%",left:"50%",transform:"translateX(-50%)",width:600,height:400,background:"radial-gradient(ellipse,rgba(59,130,246,0.055) 0%,transparent 70%)",pointerEvents:"none" },
  glow2: { position:"fixed",bottom:"5%",right:"10%",width:500,height:400,background:"radial-gradient(ellipse,rgba(168,139,250,0.04) 0%,transparent 70%)",pointerEvents:"none" },
  card:  { width:440,background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:14,padding:"32px 36px",boxShadow:"0 28px 80px rgba(0,0,0,0.65)" },
  input: { width:"100%",boxSizing:"border-box",background:"#080808",border:"1px solid #1e1e1e",borderRadius:8,padding:"0 14px",height:44,color:"#d4d4d4",fontSize:13,fontFamily:"'Geist',sans-serif",outline:"none",transition:"border-color 0.15s" },
  btn:   { width:"100%",height:44,border:"none",borderRadius:8,fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",fontFamily:"'Geist',sans-serif",transition:"opacity 0.15s" },
  label: { display:"block",fontSize:11,fontWeight:500,color:"#555",marginBottom:6,letterSpacing:0.1 },
  link:  { background:"none",border:"none",color:"#666",fontSize:12,cursor:"pointer",fontFamily:"'Geist',sans-serif",textDecoration:"underline",textUnderlineOffset:2,padding:0 },
  sep:   { display:"flex",alignItems:"center",gap:12,color:"#252525",fontSize:11,margin:"20px 0" },
  oBtn:  { flex:1,height:40,background:"#111",border:"1px solid #1e1e1e",borderRadius:8,color:"#666",fontSize:12,fontWeight:500,display:"flex",alignItems:"center",justifyContent:"center",gap:7,cursor:"pointer",fontFamily:"'Geist',sans-serif",transition:"border-color 0.15s" },
};

function BgShell({ children }) {
  return (
    <div style={T.root}>
      <div style={T.grid}/><div style={T.glow1}/><div style={T.glow2}/>
      <div style={{ position:"relative",zIndex:1,padding:20,width:"100%" }}>
        {children}
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input::placeholder{color:#252525;}
        input:focus{border-color:#2e2e2e !important;}
        input:focus,button:focus{outline:none;}
        button:hover{opacity:0.8;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </div>
  );
}

function Logo({ subtitle = "Professional Edition" }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:30 }}>
      <div style={{ width:36,height:36,borderRadius:9,background:"#111",border:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"center" }}>
        <FaCode size={14} color="#e5e5e5"/>
      </div>
      <div>
        <div style={{ fontSize:16,fontWeight:700,color:"#e5e5e5",letterSpacing:-0.3 }}>CloudIDE</div>
        <div style={{ fontSize:10,color:"#333" }}>{subtitle}</div>
      </div>
    </div>
  );
}

function Flash({ type = "error", children }) {
  if (!children) return null;
  const cfg = {
    error:   { bg:"#190a0a", border:"#3d1414", color:"#fca5a5" },
    success: { bg:"#091509", border:"#14401a", color:"#86efac" },
    info:    { bg:"#080e19", border:"#1a2e50", color:"#93c5fd" },
    warning: { bg:"#190e05", border:"#3d2810", color:"#fcd34d" },
  }[type] || { bg:"#190a0a", border:"#3d1414", color:"#fca5a5" };
  return (
    <div style={{ background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:8,padding:"11px 14px",marginBottom:18,fontSize:12,color:cfg.color,lineHeight:1.65,display:"flex",gap:8,alignItems:"flex-start" }}>
      {type === "error"   && <FaExclamationTriangle size={12} style={{ flexShrink:0,marginTop:1 }}/>}
      {type === "success" && <FaCheckCircle          size={12} style={{ flexShrink:0,marginTop:1 }}/>}
      <span>{children}</span>
    </div>
  );
}

function Spinner() {
  return <div style={{ width:15,height:15,border:"2px solid rgba(0,0,0,0.2)",borderTopColor:"#080808",borderRadius:"50%",animation:"spin 0.6s linear infinite" }}/>;
}

function PasswordInput({ value, onChange, placeholder = "••••••••", onKeyDown }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...T.input, paddingRight:44 }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#444",display:"flex",padding:2 }}
      >
        {show ? <FaEyeSlash size={13}/> : <FaEye size={13}/>}
      </button>
    </div>
  );
}

function OAuthButtons() {
  return (
    <>
      <div style={T.sep}>
        <div style={{ flex:1,height:1,background:"#1a1a1a" }}/>
        <span>or continue with</span>
        <div style={{ flex:1,height:1,background:"#1a1a1a" }}/>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button style={T.oBtn} onClick={() => window.location.href = `${API_URL}/auth/google`}>
          {/* Google "G" SVG — no icon library needed */}
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path fill="#ea4335" d="M5.27 9.76A7.08 7.08 0 0 1 19.05 10.8h-6.51V13.5h9.26A9.84 9.84 0 1 1 4.63 7.04l.64 2.72z"/>
            <path fill="#4285f4" d="M5.27 9.76l-.64-2.72A9.84 9.84 0 0 0 2.15 12c0 1.62.39 3.14 1.07 4.49L6.3 14a7.05 7.05 0 0 1-.52-2c0-.76.14-1.49.38-2.18l.11-.06z"/>
            <path fill="#fbbc04" d="M12 4.92a7.04 7.04 0 0 1 4.72 1.82l3.51-3.5A9.82 9.82 0 0 0 12 2.08 9.84 9.84 0 0 0 4.63 7.04l3.64 2.72A7.08 7.08 0 0 1 12 4.92z"/>
            <path fill="#34a853" d="M12 19.08a7.08 7.08 0 0 1-5.72-2.91L3.22 18.53A9.84 9.84 0 0 0 12 21.92a9.82 9.82 0 0 0 8.23-4.42l-3.68-2.86A7.05 7.05 0 0 1 12 19.08z"/>
          </svg>
          Google
        </button>
        <button style={T.oBtn} onClick={() => window.location.href = `${API_URL}/auth/github`}>
          <FaGithub size={14} color="#aaa"/>
          GitHub
        </button>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PAGE: SIGN IN
───────────────────────────────────────────────────────────────── */
function SignIn({ navigate }) {
  const { login } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(sessionStorage.getItem("authError") || "");
  const [info,     setInfo]     = useState("");

  useEffect(() => { sessionStorage.removeItem("authError"); }, []);

  const submit = async () => {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true); setError(""); setInfo("");
    try {
      const res  = await fetch(`${API_URL}/auth/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.notVerified) {
          setError("");
          setInfo(`Email not verified. Check your inbox, or `);
          return;
        }
        setError(data.error || "Sign in failed.");
      } else {
        login(data.token, data.user);
      }
    } catch { setError("Cannot connect to server. Is it running?"); }
    setLoading(false);
  };

  const resend = async () => {
    if (!email) { setError("Enter your email first."); return; }
    await fetch(`${API_URL}/auth/resend-verification`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setInfo("");
    setError("");
    setError(""); // clear
    setInfo("✅ Verification email resent! Check your inbox.");
  };

  return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:440, margin:"0 auto", animation:"fadeUp 0.35s ease" }}>
        <Logo/>
        <h2 style={{ margin:"0 0 4px",fontSize:22,fontWeight:700,color:"#e5e5e5",letterSpacing:-0.4 }}>Welcome back</h2>
        <p style={{ margin:"0 0 24px",fontSize:13,color:"#444" }}>Sign in to your workspace</p>

        <Flash type="error">{error}</Flash>
        {info && (
          <div style={{ background:"#080e19",border:"1px solid #1a2e50",borderRadius:8,padding:"11px 14px",marginBottom:18,fontSize:12,color:"#93c5fd",lineHeight:1.65 }}>
            {info}
            {info.includes("or ") && (
              <button onClick={resend} style={{ ...T.link, color:"#93c5fd", fontWeight:600 }}>resend verification email</button>
            )}
          </div>
        )}

        <div style={{ marginBottom:14 }}>
          <label style={T.label}>Email</label>
          <input style={T.input} type="email" value={email} placeholder="you@example.com"
            onChange={e => { setEmail(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && submit()} autoFocus/>
        </div>

        <div style={{ marginBottom:22 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <label style={T.label}>Password</label>
            <button style={T.link} onClick={() => navigate("forgot")}>Forgot password?</button>
          </div>
          <PasswordInput
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && submit()}
          />
        </div>

        <button onClick={submit} disabled={loading || !email || !password}
          style={{ ...T.btn, background:"#e5e5e5", color:"#080808", opacity: (!email || !password) ? 0.4 : 1 }}>
          {loading ? <Spinner/> : <><FaBolt size={11}/> Sign In</>}
        </button>

        <OAuthButtons/>

        <p style={{ margin:"22px 0 0", textAlign:"center", fontSize:13, color:"#444" }}>
          No account?{" "}
          <button style={{ ...T.link, color:"#aaa", fontWeight:600 }} onClick={() => navigate("signup")}>
            Create one free
          </button>
        </p>
      </div>
    </BgShell>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PAGE: SIGN UP
───────────────────────────────────────────────────────────────── */
function SignUp({ navigate }) {
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  // Password strength
  const strength = !password ? 0
    : password.length < 8  ? 1
    : /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password) ? 3
    : 2;
  const strLabel = ["", "Weak", "Fair", "Strong"];
  const strColor = ["", "#ef4444", "#f59e0b", "#22c55e"];

  const submit = async () => {
    if (!name.trim()) { setError("Please enter your full name."); return; }
    if (!email.trim()) { setError("Please enter your email."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/signup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Sign up failed.");
      else         setDone(true);
    } catch { setError("Cannot connect to server. Is it running?"); }
    setLoading(false);
  };

  if (done) return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:440, margin:"0 auto", textAlign:"center", animation:"fadeUp 0.35s ease" }}>
        <div style={{ width:64,height:64,borderRadius:"50%",background:"#091509",border:"1px solid #14401a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
          <FaEnvelope size={26} color="#22c55e"/>
        </div>
        <h2 style={{ color:"#e5e5e5", marginBottom:8, fontSize:20, fontWeight:700 }}>Check your inbox!</h2>
        <p style={{ color:"#555", lineHeight:1.75, marginBottom:28, fontSize:14 }}>
          We sent a verification link to <strong style={{ color:"#888" }}>{email}</strong>.
          Click it to activate your account, then sign in.
        </p>
        <button onClick={() => navigate("signin")} style={{ ...T.btn, background:"#1a1a1a", color:"#aaa", border:"1px solid #222" }}>
          <FaArrowLeft size={11}/> Back to Sign In
        </button>
      </div>
    </BgShell>
  );

  return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:440, margin:"0 auto", animation:"fadeUp 0.35s ease" }}>
        <Logo/>
        <h2 style={{ margin:"0 0 4px",fontSize:22,fontWeight:700,color:"#e5e5e5",letterSpacing:-0.4 }}>Create your account</h2>
        <p style={{ margin:"0 0 24px",fontSize:13,color:"#444" }}>Start coding in the cloud — free</p>

        <Flash type="error">{error}</Flash>

        <div style={{ marginBottom:14 }}>
          <label style={T.label}>Full Name</label>
          <input style={T.input} value={name} placeholder="Jane Smith"
            onChange={e => { setName(e.target.value); setError(""); }} autoFocus/>
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={T.label}>Email</label>
          <input style={T.input} type="email" value={email} placeholder="you@example.com"
            onChange={e => { setEmail(e.target.value); setError(""); }}/>
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={T.label}>Password</label>
          <PasswordInput value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="Min. 8 characters"/>
          {password && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:7 }}>
              <div style={{ flex:1, height:2, background:"#1a1a1a", borderRadius:1 }}>
                <div style={{ width:`${(strength/3)*100}%`, height:"100%", background:strColor[strength], borderRadius:1, transition:"all 0.3s" }}/>
              </div>
              <span style={{ fontSize:10, color:strColor[strength], fontWeight:700, minWidth:32 }}>{strLabel[strength]}</span>
            </div>
          )}
        </div>

        <div style={{ marginBottom:24 }}>
          <label style={T.label}>Confirm Password</label>
          <input
            style={{ ...T.input, borderColor: confirm && confirm !== password ? "#ef4444" : "#1e1e1e" }}
            type="password" value={confirm} placeholder="Repeat password"
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && submit()}
          />
          {confirm && confirm !== password && (
            <div style={{ fontSize:11, color:"#ef4444", marginTop:5 }}>Passwords don't match</div>
          )}
        </div>

        <button onClick={submit} disabled={loading || !name || !email || !password || !confirm}
          style={{ ...T.btn, background:"#e5e5e5", color:"#080808", opacity:(!name||!email||!password||!confirm)?0.4:1 }}>
          {loading ? <Spinner/> : <><FaCheckCircle size={11}/> Create Account</>}
        </button>

        <OAuthButtons/>

        <p style={{ margin:"22px 0 0", textAlign:"center", fontSize:13, color:"#444" }}>
          Already have an account?{" "}
          <button style={{ ...T.link, color:"#aaa", fontWeight:600 }} onClick={() => navigate("signin")}>Sign in</button>
        </p>
      </div>
    </BgShell>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PAGE: VERIFY EMAIL  (opened via link in email)
───────────────────────────────────────────────────────────────── */
function VerifyEmail({ navigate }) {
  const { login } = useAuth();
  const [status, setStatus] = useState("loading"); // loading | success | error
  const [msg,    setMsg]    = useState("");

  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const token   = params.get("token");
    const userId  = params.get("userId");

    if (!token || !userId) {
      setStatus("error");
      setMsg("Invalid verification link — missing token or user ID.");
      return;
    }

    fetch(`${API_URL}/auth/verify-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, userId }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.token) {
          login(d.token, d.user);
          setStatus("success");
        } else if (d.alreadyVerified) {
          setStatus("error");
          setMsg("Email already verified. Please sign in.");
        } else {
          setStatus("error");
          setMsg(d.error || "Verification failed.");
        }
      })
      .catch(() => { setStatus("error"); setMsg("Server error. Please try again."); });
  }, [login]);

  return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:420, margin:"0 auto", textAlign:"center", animation:"fadeUp 0.35s ease" }}>
        {status === "loading" && (
          <>
            <div style={{ width:48,height:48,border:"3px solid #1a1a1a",borderTopColor:"#aaa",borderRadius:"50%",animation:"spin 0.9s linear infinite",margin:"0 auto 20px" }}/>
            <p style={{ color:"#555", fontSize:14 }}>Verifying your email…</p>
          </>
        )}
        {status === "success" && (
          <>
            <div style={{ width:64,height:64,borderRadius:"50%",background:"#091509",border:"1px solid #14401a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
              <FaCheckCircle size={28} color="#22c55e"/>
            </div>
            <h2 style={{ color:"#e5e5e5", marginBottom:8, fontSize:20, fontWeight:700 }}>Email Verified!</h2>
            <p style={{ color:"#555", marginBottom:24, fontSize:14, lineHeight:1.7 }}>Your account is ready. Taking you to the IDE…</p>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ width:64,height:64,borderRadius:"50%",background:"#190a0a",border:"1px solid #3d1414",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
              <FaTimes size={26} color="#ef4444"/>
            </div>
            <h2 style={{ color:"#e5e5e5", marginBottom:8, fontSize:20, fontWeight:700 }}>Verification Failed</h2>
            <p style={{ color:"#f87171", marginBottom:24, fontSize:13, lineHeight:1.7 }}>{msg}</p>
            <button onClick={() => navigate("signin")} style={{ ...T.btn, background:"#1a1a1a", color:"#aaa", border:"1px solid #222" }}>
              <FaArrowLeft size={11}/> Back to Sign In
            </button>
          </>
        )}
      </div>
    </BgShell>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PAGE: FORGOT PASSWORD
───────────────────────────────────────────────────────────────── */
function ForgotPassword({ navigate }) {
  const [email,   setEmail]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [sent,    setSent]    = useState(false);

  const submit = async () => {
    if (!email.trim()) { setError("Please enter your email."); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Something went wrong.");
      else         setSent(true);
    } catch { setError("Cannot connect to server."); }
    setLoading(false);
  };

  return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:420, margin:"0 auto", animation:"fadeUp 0.35s ease" }}>
        <Logo/>
        <button onClick={() => navigate("signin")} style={{ ...T.link, display:"flex", alignItems:"center", gap:5, marginBottom:20, color:"#444" }}>
          <FaArrowLeft size={10}/> Back to Sign In
        </button>

        {!sent ? (
          <>
            <h2 style={{ margin:"0 0 6px",fontSize:21,fontWeight:700,color:"#e5e5e5" }}>Forgot password?</h2>
            <p style={{ margin:"0 0 24px",fontSize:13,color:"#444",lineHeight:1.65 }}>
              Enter the email for your account and we'll send a reset link.
            </p>
            <Flash type="error">{error}</Flash>
            <div style={{ marginBottom:20 }}>
              <label style={T.label}>Email</label>
              <input style={T.input} type="email" value={email} placeholder="you@example.com"
                onChange={e => { setEmail(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && submit()} autoFocus/>
            </div>
            <button onClick={submit} disabled={loading || !email}
              style={{ ...T.btn, background:"#e5e5e5", color:"#080808", opacity:!email?0.4:1 }}>
              {loading ? <Spinner/> : <><FaEnvelope size={11}/> Send Reset Link</>}
            </button>
          </>
        ) : (
          <div style={{ textAlign:"center", paddingTop:8 }}>
            <div style={{ width:64,height:64,borderRadius:"50%",background:"#091509",border:"1px solid #14401a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
              <FaEnvelope size={26} color="#22c55e"/>
            </div>
            <h2 style={{ color:"#e5e5e5", marginBottom:8, fontSize:20, fontWeight:700 }}>Check your inbox</h2>
            <p style={{ color:"#555", lineHeight:1.75, marginBottom:28, fontSize:13 }}>
              If an account exists for <strong style={{ color:"#888" }}>{email}</strong>,
              you'll receive a password reset link within a few minutes.
              Also check your spam folder.
            </p>
            <button onClick={() => navigate("signin")} style={{ ...T.btn, background:"#1a1a1a", color:"#aaa", border:"1px solid #222" }}>
              <FaArrowLeft size={11}/> Back to Sign In
            </button>
          </div>
        )}
      </div>
    </BgShell>
  );
}

/* ─────────────────────────────────────────────────────────────────
   PAGE: RESET PASSWORD  (opened via link in email)
───────────────────────────────────────────────────────────────── */
function ResetPassword({ navigate }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  const params  = new URLSearchParams(window.location.search);
  const token   = params.get("token");
  const userId  = params.get("userId");

  const submit = async () => {
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId, password }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Reset failed.");
      else         setDone(true);
    } catch { setError("Cannot connect to server."); }
    setLoading(false);
  };

  if (!token || !userId) return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:420, margin:"0 auto", textAlign:"center" }}>
        <Flash type="error">Invalid reset link. Please request a new one.</Flash>
        <button onClick={() => navigate("forgot")} style={{ ...T.btn, background:"#1a1a1a", color:"#aaa", border:"1px solid #222", marginTop:8 }}>
          Request New Link
        </button>
      </div>
    </BgShell>
  );

  return (
    <BgShell>
      <div style={{ ...T.card, maxWidth:420, margin:"0 auto", animation:"fadeUp 0.35s ease" }}>
        <Logo/>
        {!done ? (
          <>
            <h2 style={{ margin:"0 0 6px",fontSize:21,fontWeight:700,color:"#e5e5e5" }}>Set a new password</h2>
            <p style={{ margin:"0 0 24px",fontSize:13,color:"#444" }}>Choose a strong password for your account.</p>
            <Flash type="error">{error}</Flash>
            <div style={{ marginBottom:14 }}>
              <label style={T.label}>New Password</label>
              <PasswordInput value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="Min. 8 characters"/>
            </div>
            <div style={{ marginBottom:24 }}>
              <label style={T.label}>Confirm New Password</label>
              <input
                style={{ ...T.input, borderColor: confirm && confirm !== password ? "#ef4444" : "#1e1e1e" }}
                type="password" value={confirm} placeholder="Repeat password"
                onChange={e => { setConfirm(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && submit()}
              />
            </div>
            <button onClick={submit} disabled={loading || !password || !confirm}
              style={{ ...T.btn, background:"#e5e5e5", color:"#080808", opacity:(!password||!confirm)?0.4:1 }}>
              {loading ? <Spinner/> : <><FaLock size={11}/> Reset Password</>}
            </button>
          </>
        ) : (
          <div style={{ textAlign:"center" }}>
            <div style={{ width:64,height:64,borderRadius:"50%",background:"#091509",border:"1px solid #14401a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px" }}>
              <FaCheckCircle size={28} color="#22c55e"/>
            </div>
            <h2 style={{ color:"#e5e5e5", marginBottom:8, fontSize:20, fontWeight:700 }}>Password Reset!</h2>
            <p style={{ color:"#555", marginBottom:28, fontSize:14, lineHeight:1.7 }}>
              Your password has been changed. You can now sign in with your new password.
            </p>
            <button onClick={() => navigate("signin")} style={{ ...T.btn, background:"#e5e5e5", color:"#080808" }}>
              <FaBolt size={11}/> Sign In
            </button>
          </div>
        )}
      </div>
    </BgShell>
  );
}

/* ─────────────────────────────────────────────────────────────────
   IDE HELPERS
───────────────────────────────────────────────────────────────── */
function useTick(ms = 1000) {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return t;
}
function useAnimVal(target) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const id = setInterval(() => { cur.current += (target - cur.current) * 0.1; setV(Math.round(cur.current)); }, 50);
    return () => clearInterval(id);
  }, [target]);
  return v;
}
function Spark({ data, color }) {
  const W = 52, H = 22, min = Math.min(...data), range = (Math.max(...data) - min) || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 2)}`).join(" ");
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function MetricRow({ label, value, unit, color, data, pct }) {
  const anim = useAnimVal(value);
  return (
    <div style={{ padding:"9px 0",borderBottom:"1px solid #1a1a1a" }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
        <span style={{ fontSize:9,color:"#444",letterSpacing:0.8,textTransform:"uppercase",fontWeight:600 }}>{label}</span>
        <span style={{ fontSize:11,color,fontFamily:"'JetBrains Mono',monospace",fontWeight:600 }}>{anim}{unit}</span>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:7 }}>
        <div style={{ flex:1,height:2,background:"#1a1a1a",borderRadius:1 }}>
          <div style={{ width:`${Math.min(pct,100)}%`,height:"100%",background:color,borderRadius:1,transition:"width 1.2s ease" }}/>
        </div>
        <Spark data={data} color={color}/>
      </div>
    </div>
  );
}
function FileIcon({ name, lang, size = 12 }) {
  if (lang && LANGS[lang]) { const I = LANGS[lang].icon; return <I size={size} color={LANGS[lang].color}/>; }
  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_LANG[ext]) { const l = EXT_TO_LANG[ext]; const I = LANGS[l].icon; return <I size={size} color={LANGS[l].color}/>; }
  return <FaFile size={size} color="#555"/>;
}

/* ─────────────────────────────────────────────────────────────────
   COLLABORATIVE EDITING HOOK
───────────────────────────────────────────────────────────────── */
function useCollab({ token, activeFile, setFiles, activeId }) {
  const socketRef      = useRef(null);
  const changeLangRef  = useRef(null);   // set by IDE after changeLang is defined
  const [roomId,       setRoomId]      = useState(null);
  const [collabUsers,  setCollabUsers] = useState([]);
  const [cursors,      setCursors]     = useState({});
  const isRemoteChange = useRef(false);

  const getSocket = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;
    const s = socketIO(API_URL, { auth: { token }, transports: ["websocket"] });
    socketRef.current = s;

    s.on("collab:state", ({ code, lang, users }) => {
      isRemoteChange.current = true;
      setFiles(fs => fs.map(f => f.id === activeId ? { ...f, code, lang, saved: false } : f));
      if (changeLangRef.current) changeLangRef.current(lang);
      setCollabUsers(users);
      isRemoteChange.current = false;
    });
    s.on("collab:users",  (users) => setCollabUsers(users));
    s.on("collab:code",   ({ code }) => {
      isRemoteChange.current = true;
      setFiles(fs => fs.map(f => f.id === activeId ? { ...f, code, saved: false } : f));
      isRemoteChange.current = false;
    });
    s.on("collab:lang", ({ lang }) => {
      isRemoteChange.current = true;
      if (changeLangRef.current) changeLangRef.current(lang);
      isRemoteChange.current = false;
    });
    s.on("collab:cursor", ({ socketId, line, column, user: cu }) => {
      setCursors(p => ({ ...p, [socketId]: { line, column, user: cu } }));
    });
    s.on("disconnect", () => { setCollabUsers([]); setCursors({}); setRoomId(null); });
    return s;
  }, [token, activeId, setFiles]);

  const joinRoom = useCallback((rid, code, lang) => {
    const s = getSocket();
    s.emit("collab:join", { roomId: rid, code, lang });
    setRoomId(rid);
    setCursors({});
  }, [getSocket]);

  const leaveRoom = useCallback(() => {
    if (!roomId) return;
    socketRef.current?.emit("collab:leave", { roomId });
    setRoomId(null);
    setCollabUsers([]);
    setCursors({});
  }, [roomId]);

  const emitCode = useCallback((code) => {
    if (!roomId || isRemoteChange.current) return;
    socketRef.current?.emit("collab:code", { roomId, code });
  }, [roomId]);

  const emitLang = useCallback((lang) => {
    if (!roomId || isRemoteChange.current) return;
    socketRef.current?.emit("collab:lang", { roomId, lang });
  }, [roomId]);

  const emitCursor = useCallback((line, column) => {
    if (!roomId) return;
    socketRef.current?.emit("collab:cursor", { roomId, line, column });
  }, [roomId]);

  useEffect(() => () => socketRef.current?.disconnect(), []);

  return { roomId, collabUsers, cursors, joinRoom, leaveRoom, emitCode, emitLang, emitCursor, isRemoteChange, changeLangRef };
}

/* ─────────────────────────────────────────────────────────────────
   IDE
───────────────────────────────────────────────────────────────── */
function IDE() {
  const { user, logout, apiFetch } = useAuth();

  /* files */
  const [files,   setFiles]   = useState([{ id: uid(), name: "main.py", lang: "python", code: DEFAULT_CODE.python, saved: true }]);
  const [activeId, setActiveId] = useState(files[0].id);
  const activeFile = files.find(f => f.id === activeId) || files[0];

  /* terminal */
  const [running,      setRunning]      = useState(false);
  const [termLines,    setTermLines]    = useState([]);
  const [termInput,    setTermInput]    = useState("");
  const [inputReady,   setInputReady]   = useState(false);
  const [execMs,       setExecMs]       = useState(null);
  const [termExpanded, setTermExpanded] = useState(false);
  const sessionRef   = useRef(null);
  const sseRef       = useRef(null);
  const outBufRef    = useRef("");
  const startTimeRef = useRef(null);

  /* sidebar */
  const [panel,        setPanel]        = useState("files");
  const [userMenu,     setUserMenu]     = useState(false);
  const [newFileModal, setNewFileModal] = useState(false);
  const [newFileName,  setNewFileName]  = useState("");
  const [newFileLang,  setNewFileLang]  = useState("python");
  const [renameId,     setRenameId]     = useState(null);
  const [renameVal,    setRenameVal]    = useState("");
  const [ctxMenu,      setCtxMenu]      = useState(null);

  /* metrics */
  const [cpuH] = useState(() => Array.from({ length:16 }, () => Math.random()*55+15));
  const [memH] = useState(() => Array.from({ length:16 }, () => Math.random()*40+30));
  const [netH] = useState(() => Array.from({ length:16 }, () => Math.random()*65+8));
  const [stats, setStats] = useState({ cpu:32, mem:54, net:18 });
  useEffect(() => {
    const id = setInterval(() => setStats(p => ({
      cpu: Math.min(90, Math.max(5, p.cpu + (Math.random()-0.5)*8)),
      mem: Math.min(88, Math.max(18, p.mem + (Math.random()-0.5)*4)),
      net: Math.min(95, Math.max(2,  p.net + (Math.random()-0.5)*12)),
    })), 2400);
    return () => clearInterval(id);
  }, []);

  const termBodyRef  = useRef(null);
  const termInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const clock = useTick();

  useEffect(() => { if (termBodyRef.current) termBodyRef.current.scrollTop = termBodyRef.current.scrollHeight; }, [termLines, inputReady]);
  useEffect(() => { if (inputReady && termInputRef.current) termInputRef.current.focus(); }, [inputReady]);

  const addLine = useCallback((type, text) => setTermLines(p => [...p, { type, text }]), []);

  /* ── file ops ── */
  const saveFile    = useCallback(() => setFiles(fs => fs.map(f => f.id===activeId ? {...f,saved:true} : f)), [activeId]);
  const closeTab    = id => setFiles(fs => { const n=fs.filter(f=>f.id!==id); if(id===activeId&&n.length)setActiveId(n[n.length-1].id); return n; });
  const deleteFile  = id => { setFiles(fs => { const n=fs.filter(f=>f.id!==id); if(id===activeId)setActiveId(n[0]?.id||null); return n.length?n:[{id:uid(),name:"main.py",lang:"python",code:DEFAULT_CODE.python,saved:true}]; }); setCtxMenu(null); };
  const startRename = id => { const f=files.find(x=>x.id===id); setRenameId(id); setRenameVal(f?.name||""); setCtxMenu(null); };
  const finishRename = id => { if(renameVal.trim()){const ext=renameVal.trim().split(".").pop()?.toLowerCase(),lang=EXT_TO_LANG[ext]||files.find(f=>f.id===id)?.lang||"python";setFiles(fs=>fs.map(f=>f.id===id?{...f,name:renameVal.trim(),lang}:f));} setRenameId(null); };
  const createFile  = () => {
    const ext=LANGS[newFileLang]?.ext||"py", raw=newFileName.trim()||`untitled.${ext}`, name=raw.includes(".")?raw:`${raw}.${ext}`, id=uid();
    setFiles(fs=>[...fs,{id,name,lang:newFileLang,code:DEFAULT_CODE[newFileLang]||"",saved:true}]);
    setActiveId(id); setNewFileModal(false); setNewFileName(""); setNewFileLang("python");
  };
  const openFromDisk = e => {
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{const ext=file.name.split(".").pop()?.toLowerCase(),lang=EXT_TO_LANG[ext]||"python",id=uid();setFiles(fs=>[...fs,{id,name:file.name,lang,code:ev.target.result,saved:true}]);setActiveId(id);};
    reader.readAsText(file); e.target.value="";
  };
  const downloadFile = () => { const b=new Blob([activeFile.code],{type:"text/plain"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=activeFile.name;a.click();URL.revokeObjectURL(a.href); };
  const copyCode     = () => navigator.clipboard.writeText(activeFile.code).catch(()=>{});
  const changeLang = useCallback(lang => {
    const ext=LANGS[lang]?.ext||"py", base=activeFile.name.includes(".")?activeFile.name.replace(/\.[^.]+$/,`.${ext}`):`${activeFile.name}.${ext}`;
    const isDefault=Object.values(DEFAULT_CODE).includes(activeFile.code)||!activeFile.code.trim();
    setFiles(fs=>fs.map(f=>f.id===activeId?{...f,lang,name:base,code:isDefault?(DEFAULT_CODE[lang]||""):activeFile.code,saved:false}:f));
  }, [activeFile, activeId]);

  /* ── stop session ── */
  const stopSession = useCallback(async () => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current=null; }
    if (sessionRef.current) {
      try { await apiFetch(`/run-interactive/${sessionRef.current}`, { method:"DELETE" }); } catch(_){}
      sessionRef.current = null;
    }
    setRunning(false); setInputReady(false); outBufRef.current="";
  }, [apiFetch]);

  /* ── run code ── */
  const runCode = async () => {
    if (running) { stopSession(); return; }

    setTermLines([]); setTermInput(""); setExecMs(null);
    setRunning(true); setInputReady(false); outBufRef.current="";
    startTimeRef.current = Date.now();

    const ts = () => new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    addLine("sys", `[${ts()}] Starting ${LANGS[activeFile.lang]?.label} ${LANGS[activeFile.lang]?.version}...`);
    if (["java","rust","typescript"].includes(activeFile.lang))
      addLine("sys", `⏳ Compiling — first run may take 15-30s...`);

    /* start session */
    let sid;
    try {
      const res  = await apiFetch("/run-interactive/start", {
        method: "POST",
        body: JSON.stringify({ code: activeFile.code, language: activeFile.lang }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to start");
      sid = data.sessionId;
    } catch(e) {
      addLine("err", `❌ ${e.message}`);
      setRunning(false); return;
    }
    sessionRef.current = sid;
    addLine("sys", `[${ts()}] Running — type input below when prompted ↓`);

    /* SSE — pass token as query param because EventSource can't set headers */
    const tok = localStorage.getItem("cide_token");
    const sse = new EventSource(`${API_URL}/run-interactive/output/${sid}?token=${tok}`);
    sseRef.current = sse;

    const finish = () => {
      if (outBufRef.current.trim()) { addLine("out", outBufRef.current); }
      outBufRef.current = "";
      const ms = Date.now() - startTimeRef.current;
      setExecMs(ms);
      addLine("sys", `[${ts()}] Exited · ${ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(2)}s`}`);
      setRunning(false); setInputReady(false); sessionRef.current=null; sseRef.current=null;
    };

    sse.onmessage = e => {
      const chunk = JSON.parse(e.data);
      if (chunk.type === "stdout" || chunk.type === "stderr") {
        outBufRef.current += chunk.data;
        const parts = outBufRef.current.split("\n");
        outBufRef.current = parts.pop(); // keep incomplete line
        parts.forEach(ln => addLine(chunk.type === "stderr" ? "err" : "out", ln));
        /* show prompt and open input bar */
        if (outBufRef.current.length > 0 && /[:?>\]]\s*$/.test(outBufRef.current)) {
          addLine(chunk.type === "stderr" ? "err" : "out", outBufRef.current);
          outBufRef.current = "";
          setInputReady(true);
        }
      }
      if (chunk.type === "exit" || chunk.type === "error") {
        if (chunk.type === "error") addLine("err", `Runtime error: ${chunk.data}`);
        finish(); sse.close();
      }
    };
    sse.onerror = () => { finish(); sse.close(); };
  };

  /* ── send input ── */
  const sendInput = async () => {
    if (!sessionRef.current || !running) return;
    const val = termInput;
    setTermInput(""); setInputReady(false);
    addLine("in", val);
    try {
      await apiFetch(`/run-interactive/input/${sessionRef.current}`, {
        method: "POST",
        body: JSON.stringify({ input: val }),
      });
    } catch(e) { addLine("err", `Input error: ${e.message}`); }
  };

  /* collab */
  const [collabModal,  setCollabModal]  = useState(false);
  const [joinInput,    setJoinInput]    = useState("");
  const [collabStatus, setCollabStatus] = useState(""); // "creating" | "joining" | ""
  const [collabCopied, setCollabCopied] = useState(false);

  const { token } = useAuth();

  const collab = useCollab({
    token,
    activeFile,
    setFiles,
    activeId,
  });

  // Keep changeLangRef in sync so the hook can call it
  useEffect(() => { collab.changeLangRef.current = changeLang; }, [changeLang, collab.changeLangRef]);

  // Emit code changes to collab room
  const updateCode = useCallback(c => {
    setFiles(fs => fs.map(f => f.id === activeId ? { ...f, code: c || "", saved: false } : f));
    collab.emitCode(c || "");
  }, [activeId, collab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Emit lang changes to collab room
  const changeLangCollab = useCallback(lang => {
    changeLang(lang);
    collab.emitLang(lang);
  }, [changeLang, collab]);

  const createRoom = async () => {
    setCollabStatus("creating");
    try {
      const res = await apiFetch("/collab/new-room");
      const { roomId } = await res.json();
      collab.joinRoom(roomId, activeFile.code, activeFile.lang);
      setCollabStatus("");
    } catch { setCollabStatus(""); }
  };

  const joinRoom = () => {
    const rid = joinInput.trim().toUpperCase();
    if (!rid) return;
    setCollabStatus("joining");
    collab.joinRoom(rid, activeFile.code, activeFile.lang);
    setJoinInput(""); setCollabStatus(""); setCollabModal(false);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(collab.roomId || "").then(() => {
      setCollabCopied(true); setTimeout(() => setCollabCopied(false), 2000);
    });
  };
  const lineColor = { out:"#d4d4d4", err:"#f87171", sys:"#555", in:"#eab308" };
  const lineCount = activeFile.code.split("\n").length;
  const LCfg      = LANGS[activeFile.lang] || LANGS.python;
  const LIcon     = LCfg.icon;
  const initials  = user?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() || "U";
  const avatarSrc = user?.avatar ? `${API_URL}/auth/avatar?token=${localStorage.getItem("cide_token")}` : null;

  return (
    <div style={S.root} onClick={() => { setUserMenu(false); setCtxMenu(null); }}>

      {/* ── TITLEBAR ── */}
      <div style={S.titlebar}>
        <div style={S.tbLeft}>
          <div style={S.winDots}>
            <span style={{...S.dot,background:"#ef4444"}}/><span style={{...S.dot,background:"#f59e0b"}}/><span style={{...S.dot,background:"#22c55e"}}/>
          </div>
          <div style={S.brand}><div style={S.brandBox}><FaCode size={11} color="#fff"/></div><span style={S.brandTxt}>CloudIDE</span></div>
        </div>

        <div style={S.tabs}>
          {files.map(f => { const cfg=LANGS[f.lang],Icon=cfg?.icon; return (
            <div key={f.id} onClick={() => setActiveId(f.id)} style={{...S.tab,...(f.id===activeId?S.tabOn:{})}}>
              {Icon&&<Icon size={11} color={f.id===activeId?cfg.color:"#444"}/>}
              <span style={{maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
              {!f.saved&&<span style={S.dot2}/>}
              <button style={S.tabX} onClick={e=>{e.stopPropagation();closeTab(f.id);}}><FaTimes size={9}/></button>
            </div>); })}
          <button style={S.tabNew} onClick={() => setNewFileModal(true)}><FaPlus size={9}/></button>
        </div>

        <div style={S.tbRight}>
          {/* Collab user avatars */}
          {collab.collabUsers.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:3, marginRight:4 }}>
              {collab.collabUsers.slice(0,5).map(u => (
                <div key={u.socketId} title={u.name}
                  style={{ width:20, height:20, borderRadius:5, border:`2px solid ${u.color}`,
                    background:"#1a1a1a", display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:8, fontWeight:700, color:u.color, overflow:"hidden", flexShrink:0 }}>
                  {u.avatar
                    ? <img src={u.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    : u.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                </div>
              ))}
            </div>
          )}
          {/* Collab button */}
          <button onClick={() => setCollabModal(true)}
            style={{ display:"flex",alignItems:"center",gap:5,background:collab.roomId?"#0a1a0a":"transparent",
              border:`1px solid ${collab.roomId?"#142814":"#181818"}`,borderRadius:5,padding:"3px 8px",
              cursor:"pointer",fontSize:10,color:collab.roomId?"#22c55e":"#444",fontFamily:"'Geist',sans-serif" }}>
            <FaUsers size={10} color={collab.roomId?"#22c55e":"#444"}/>
            {collab.roomId ? `Room ${collab.roomId}` : "Collab"}
          </button>
          <div style={S.livePill}><span style={S.liveDot}/>Live</div>
          <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
            <button onClick={() => setUserMenu(x=>!x)} style={S.userBtn}>
              {avatarSrc
                ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer"
                    onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}
                    style={{width:22,height:22,borderRadius:5,objectFit:"cover"}}/>
                : null}
              <div style={{...S.userAv, display: avatarSrc ? "none" : "flex"}}>{initials}</div>
              <span style={S.userTxt}>{user?.name?.split(" ")[0]}</span>
              <FaChevronDown size={9} color="#444"/>
            </button>
            {userMenu && (
              <div style={S.ddMenu}>
                <div style={S.ddTop}>
                  {avatarSrc
                    ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer"
                        onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}
                        style={{width:34,height:34,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                    : null}
                  <div style={{...S.ddAv, display: avatarSrc ? "none" : "flex"}}>{initials}</div>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:"#d4d4d4"}}>{user?.name}</div>
                    <div style={{fontSize:10,color:"#444",marginTop:1}}>{user?.email}</div>
                    <div style={{fontSize:9,color:"#333",marginTop:2,textTransform:"capitalize"}}>via {user?.provider}</div>
                  </div>
                </div>
                <div style={S.ddDiv}/>
                <button style={S.ddItem}><FaUser size={11} color="#444"/><span>Profile</span></button>
                <button style={S.ddItem}><FaCog  size={11} color="#444"/><span>Settings</span></button>
                <div style={S.ddDiv}/>
                <button onClick={logout} style={{...S.ddItem,color:"#f87171"}}><FaSignOutAlt size={11} color="#f87171"/><span>Sign out</span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={S.body}>

        {/* ACTIVITY BAR */}
        <div style={S.actBar}>
          {[["files",VscFiles],["search",VscSearch],["git",VscSourceControl],["debug",VscDebugAlt],["ai",FaRobot]].map(([id,Icon]) => (
            <button key={id} onClick={() => setPanel(p=>p===id?null:id)} style={{...S.actBtn,...(panel===id?S.actOn:{})}}>
              <Icon size={18}/>{panel===id&&<div style={S.actBar2}/>}
            </button>))}
          <div style={{flex:1}}/><button style={S.actBtn}><FaCog size={16}/></button>
        </div>

        {/* SIDEBAR */}
        {panel && (
          <div style={S.sidebar} onClick={e=>e.stopPropagation()}>
            {panel==="files" && (
              <>
                <div style={S.sbHead}><span style={S.sbTitle}>Explorer</span>
                  <div style={{display:"flex",gap:4}}>
                    <button style={S.sbBtn} onClick={() => setNewFileModal(true)}><FaPlus size={10}/></button>
                    <button style={S.sbBtn} onClick={() => fileInputRef.current?.click()}><FaUpload size={10}/></button>
                  </div>
                </div>
                <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={openFromDisk} accept=".py,.js,.ts,.java,.c,.cpp,.cc,.rs"/>
                <div style={{flex:1,overflowY:"auto",padding:"4px 0"}}>
                  <div style={S.treeSection}><FaFolderOpen size={9} color="#555"/><span>WORKSPACE</span></div>
                  {files.map(f => (
                    <div key={f.id} onContextMenu={e=>{e.preventDefault();setCtxMenu({id:f.id,x:e.clientX,y:e.clientY});}}>
                      {renameId===f.id ? (
                        <div style={{...S.treeRow,paddingLeft:20}}>
                          <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                            onBlur={()=>finishRename(f.id)} onKeyDown={e=>{if(e.key==="Enter")finishRename(f.id);if(e.key==="Escape")setRenameId(null);}}
                            style={{flex:1,background:"#1a1a1a",border:"1px solid #333",borderRadius:3,color:"#d4d4d4",fontSize:11,padding:"1px 5px",outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
                        </div>
                      ) : (
                        <div onClick={() => setActiveId(f.id)} style={{...S.treeRow,...(f.id===activeId?S.treeRowOn:{}),paddingLeft:20}}>
                          <FileIcon name={f.name} lang={f.lang} size={12}/>
                          <span style={{flex:1,fontSize:12,marginLeft:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                          {!f.saved&&<span style={{width:5,height:5,borderRadius:"50%",background:"#888",flexShrink:0}}/>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{padding:"8px 10px",borderTop:"1px solid #141414",display:"flex",gap:6}}>
                  <button onClick={() => setNewFileModal(true)} style={S.sbAction}><FaPlus size={9}/><span>New</span></button>
                  <button onClick={() => fileInputRef.current?.click()} style={S.sbAction}><FaUpload size={9}/><span>Open</span></button>
                </div>
              </>
            )}
            {panel==="ai" && (
              <>
                <div style={S.sbHead}><span style={S.sbTitle}>AI Assistant</span></div>
                <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
                  <div style={{flex:1,padding:"10px",overflowY:"auto"}}>
                    <div style={{background:"#141414",borderRadius:7,padding:"10px",fontSize:11,color:"#666",lineHeight:1.7,display:"flex",gap:7}}>
                      <FaRobot size={11} color="#444" style={{flexShrink:0,marginTop:2}}/>
                      <span>Hi {user?.name?.split(" ")[0]}! I can help debug, explain, or refactor your code.</span>
                    </div>
                  </div>
                  <div style={{padding:"8px",borderTop:"1px solid #141414",display:"flex",gap:6}}>
                    <textarea placeholder="Ask AI..." rows={2} style={{flex:1,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:6,color:"#aaa",fontSize:11,fontFamily:"'Geist',sans-serif",padding:"6px 8px",resize:"none",outline:"none"}}/>
                    <button style={{background:"#1a1a1a",border:"none",color:"#555",borderRadius:6,padding:"0 10px",cursor:"pointer",display:"flex",alignItems:"center"}}><FaPlay size={9}/></button>
                  </div>
                </div>
              </>
            )}
            {(panel==="search"||panel==="git"||panel==="debug") && (
              <><div style={S.sbHead}><span style={S.sbTitle}>{panel==="search"?"Search":panel==="git"?"Source Control":"Debug"}</span></div>
              <div style={{padding:"14px",fontSize:11,color:"#2a2a2a"}}>Coming soon</div></>
            )}
          </div>
        )}

        {/* EDITOR COLUMN */}
        <div style={S.edCol}>

          {/* TOOLBAR */}
          <div style={S.edBar}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#444"}}>
                <LIcon size={11} color={LCfg.color}/><FaChevronRight size={8} color="#2a2a2a"/><span style={{color:"#666"}}>{activeFile.name}</span>
              </div>
              <div style={S.sep}/><span style={S.meta}>{lineCount} lines</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{display:"flex",gap:2,marginRight:4,maxWidth:500,overflowX:"auto"}}>
                {Object.entries(LANGS).map(([key,cfg]) => { const I=cfg.icon; return (
                  <button key={key} onClick={() => changeLangCollab(key)} title={`${cfg.label} ${cfg.version}`}
                    style={{...S.langBtn,...(activeFile.lang===key?{background:"#1a1a1a",borderColor:"#2a2a2a"}:{}),flexShrink:0}}>
                    <I size={11} color={activeFile.lang===key?cfg.color:"#3a3a3a"}/>
                    <span style={{color:activeFile.lang===key?"#aaa":"#3a3a3a",fontSize:10}}>{cfg.label}</span>
                  </button>); })}
              </div>
              <div style={S.sep}/>
              <button onClick={copyCode}    style={S.ico} title="Copy"><FaRegCopy  size={11}/></button>
              <button onClick={saveFile}    style={S.ico} title="Save"><FaSave     size={11}/></button>
              <button onClick={downloadFile} style={S.ico} title="Download"><FaDownload size={11}/></button>
              <div style={S.sep}/>
              <button onClick={runCode} style={{...S.runBtn,...(running?S.runStop:S.runGo)}}>
                {running?<><FaStop size={10}/><span>Stop</span></>:<><FaPlay size={10}/><span>Run</span></>}
              </button>
            </div>
          </div>

          {/* MONACO */}
          <div style={{flex:1,overflow:"hidden",position:"relative"}}>
            <Editor key={activeFile.id} height="100%" theme="vs-dark" language={LCfg.monacoLang}
              value={activeFile.code} onChange={updateCode}
              onMount={(editor) => {
                editor.onDidChangeCursorPosition(e => {
                  collab.emitCursor(e.position.lineNumber, e.position.column);
                });
              }}
              options={{fontSize:13,fontFamily:"'JetBrains Mono',monospace",fontLigatures:true,lineNumbers:"on",minimap:{enabled:false},scrollBeyondLastLine:false,renderLineHighlight:"line",cursorBlinking:"smooth",tabSize:4,wordWrap:"on",padding:{top:16,bottom:16},scrollbar:{verticalScrollbarSize:4,horizontalScrollbarSize:4},overviewRulerBorder:false}}/>
            {/* Remote cursor labels */}
            {collab.roomId && Object.entries(collab.cursors).map(([sid, {line, user: cu}]) => cu && (
              <div key={sid} style={{position:"absolute",top:0,right:8,pointerEvents:"none",zIndex:10,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,paddingTop:6}}>
                <div style={{display:"flex",alignItems:"center",gap:4,background:cu.color+"22",border:`1px solid ${cu.color}44`,borderRadius:4,padding:"2px 7px"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:cu.color,flexShrink:0}}/>
                  <span style={{fontSize:9,color:cu.color,fontFamily:"'Geist',sans-serif",fontWeight:600}}>{cu.name?.split(" ")[0]} · L{line}</span>
                </div>
              </div>
            ))}
          </div>

          {/* INTERACTIVE TERMINAL */}
          <div style={{...S.term,height:termExpanded?"55%":"34%"}}>
            <div style={S.termBar}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <FaTerminal size={9} color="#555"/>
                <span style={{fontSize:11,color:"#555"}}>Terminal</span>
                {running && <span style={{fontSize:9,color:"#22c55e",background:"#0a1a0a",border:"1px solid #142814",borderRadius:4,padding:"1px 7px",display:"flex",alignItems:"center",gap:4}}><span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"pulse 1s ease-in-out infinite"}}/>running</span>}
                {inputReady && running && <span style={{fontSize:9,color:"#eab308",background:"#1a1500",border:"1px solid #3a2800",borderRadius:4,padding:"1px 7px"}}>⌨ waiting for input</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {execMs!==null && <span style={S.timeBadge}>{execMs<1000?`${execMs}ms`:`${(execMs/1000).toFixed(2)}s`}</span>}
                <button style={S.ico} onClick={() => { setTermLines([]); setExecMs(null); }}><span style={{fontSize:9,color:"#444"}}>Clear</span></button>
                <button style={S.ico} onClick={() => setTermExpanded(x=>!x)}>{termExpanded?<FaCompressAlt size={9} color="#444"/>:<FaExpandAlt size={9} color="#444"/>}</button>
              </div>
            </div>

            <div ref={termBodyRef} style={S.termBody} onClick={() => { if(inputReady&&termInputRef.current)termInputRef.current.focus(); }}>
              <div style={{color:"#222",fontSize:11,marginBottom:8}}>{user?.name?.split(" ")[0]?.toLowerCase()}@cloudide:~$ <span style={{color:"#2a2a2a"}}>ready</span></div>
              {termLines.length===0&&!running&&<div style={{color:"#2a2a2a",fontSize:12}}>Press <span style={{color:"#3a3a3a"}}>Run</span> to execute. Programs using <span style={{color:"#555"}}>input()</span> work directly — type here when prompted.</div>}

              {termLines.map((line,i) => (
                <div key={i} style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.85,color:lineColor[line.type]||"#d4d4d4",wordBreak:"break-all",whiteSpace:"pre-wrap"}}>
                  {line.type==="in"&&<span style={{color:"#555",userSelect:"none"}}>{">"} </span>}{line.text}
                </div>
              ))}

              {running&&!inputReady&&(
                <div style={{display:"flex",gap:4,alignItems:"center",marginTop:4}}>
                  {[0,1,2].map(i=><div key={i} style={{width:3,height:3,borderRadius:"50%",background:"#333",animation:`fade 1.1s ${i*0.18}s ease-in-out infinite`}}/>)}
                  <span style={{fontSize:10,color:"#333",marginLeft:4}}>Running...</span>
                </div>
              )}

              {inputReady&&running&&(
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6,padding:"6px 12px",background:"#060e06",border:"1px solid #22c55e44",borderRadius:5}}>
                  <span style={{color:"#22c55e",fontSize:13,fontFamily:"'JetBrains Mono',monospace",userSelect:"none",flexShrink:0}}>{">"}</span>
                  <input ref={termInputRef} value={termInput} onChange={e=>setTermInput(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();sendInput();}}}
                    style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#eab308",fontSize:13,fontFamily:"'JetBrains Mono',monospace",caretColor:"#22c55e"}}
                    placeholder="type your input and press Enter…" autoFocus/>
                  <button onClick={sendInput} style={{background:"#0a2a0a",border:"1px solid #22c55e44",borderRadius:4,color:"#22c55e",fontSize:10,padding:"4px 12px",cursor:"pointer",fontFamily:"'Geist',sans-serif",flexShrink:0}}>Enter ↵</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={S.rightPanel}>
          <div style={{padding:"12px 14px 6px"}}>
            <div style={S.mpHead}>Environment</div>
            {[["Runtime",`${LCfg.label} ${LCfg.version}`],["Container","Docker · Isolated"],["Status",running?"● Running":"○ Idle"],["Auth","JWT · 7d"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                <span style={{fontSize:10,color:"#3a3a3a"}}>{k}</span>
                <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:k==="Status"?(running?"#22c55e":"#555"):"#666"}}>{v}</span>
              </div>))}
          </div>
          <div style={S.mpDiv}/>
          <div style={{padding:"10px 14px 6px"}}>
            <div style={S.mpHead}>Resources</div>
            <MetricRow label="CPU"    value={Math.round(stats.cpu)} unit="%"    color="#3b82f6" data={cpuH} pct={stats.cpu}/>
            <MetricRow label="Memory" value={Math.round(stats.mem)} unit="%"    color="#8b5cf6" data={memH} pct={stats.mem}/>
            <MetricRow label="Network" value={Math.round(stats.net)} unit=" MB/s" color="#10b981" data={netH} pct={stats.net}/>
          </div>
          <div style={S.mpDiv}/>
          <div style={{padding:"10px 14px 6px"}}>
            <div style={S.mpHead}>Open Files</div>
            {files.slice(0,6).map(f=>{const cfg=LANGS[f.lang],I=cfg?.icon;return(
              <div key={f.id} onClick={()=>setActiveId(f.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",cursor:"pointer"}}>
                {I&&<I size={10} color={f.id===activeId?cfg.color:"#333"}/>}
                <span style={{fontSize:10,color:f.id===activeId?"#888":"#333",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                {!f.saved&&<span style={{width:4,height:4,borderRadius:"50%",background:"#555",flexShrink:0}}/>}
              </div>);})}
          </div>
          <div style={{flex:1}}/><div style={S.mpDiv}/>
          <div style={{padding:"10px 14px",textAlign:"center"}}>
            <div style={{fontSize:15,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:"#444",letterSpacing:1}}>{clock.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
            <div style={{fontSize:9,color:"#222",marginTop:3}}>{clock.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})}</div>
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={S.statusBar}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#444"}}><span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block"}}/>main</div>
          <span style={S.sb}>Docker</span><span style={S.sb}>{files.length} file{files.length!==1?"s":""}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <span style={S.sb}>Ln {lineCount}</span><span style={S.sb}>UTF-8</span>
          <div style={{display:"flex",alignItems:"center",gap:4}}><LIcon size={10} color={LCfg.color}/><span style={{...S.sb,color:"#444"}}>{LCfg.label} {LCfg.version}</span></div>
        </div>
      </div>

      {/* NEW FILE MODAL */}
      {newFileModal && (
        <div style={S.overlay} onClick={() => setNewFileModal(false)}>
          <div style={S.modal} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <span style={{fontSize:14,fontWeight:600,color:"#d4d4d4"}}>New File</span>
              <button onClick={() => setNewFileModal(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#555",display:"flex"}}><FaTimes size={12}/></button>
            </div>
            <label style={{display:"block",fontSize:11,color:"#444",marginBottom:6}}>File Name</label>
            <input autoFocus value={newFileName} onChange={e=>setNewFileName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createFile()}
              placeholder={`untitled.${LANGS[newFileLang]?.ext||"py"}`}
              style={{width:"100%",background:"#080808",border:"1px solid #1e1e1e",borderRadius:7,padding:"0 12px",height:38,color:"#d4d4d4",fontSize:13,fontFamily:"'JetBrains Mono',monospace",outline:"none",marginBottom:16}}/>
            <label style={{display:"block",fontSize:11,color:"#444",marginBottom:8}}>Language</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:20}}>
              {Object.entries(LANGS).map(([key,cfg])=>{const I=cfg.icon;return(
                <button key={key} onClick={()=>setNewFileLang(key)} style={{display:"flex",alignItems:"center",gap:6,background:newFileLang===key?"#1a1a1a":"#0a0a0a",border:`1px solid ${newFileLang===key?cfg.color:"#1e1e1e"}`,borderRadius:6,padding:"6px 10px",cursor:"pointer",fontFamily:"'Geist',sans-serif"}}>
                  <I size={13} color={newFileLang===key?cfg.color:"#444"}/><span style={{fontSize:11,color:newFileLang===key?"#aaa":"#444"}}>{cfg.label}</span>
                </button>);})}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setNewFileModal(false)} style={{background:"transparent",border:"1px solid #1e1e1e",borderRadius:6,padding:"7px 16px",fontSize:12,color:"#555",cursor:"pointer",fontFamily:"'Geist',sans-serif"}}>Cancel</button>
              <button onClick={createFile} style={{background:"#e5e5e5",border:"none",borderRadius:6,padding:"7px 16px",fontSize:12,fontWeight:600,color:"#0a0a0a",cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"'Geist',sans-serif"}}><FaPlus size={10}/> Create</button>
            </div>
          </div>
        </div>
      )}

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <div style={{...S.ctxMenu,top:ctxMenu.y,left:ctxMenu.x}} onClick={e=>e.stopPropagation()}>
          <button style={S.ctxItem} onClick={()=>startRename(ctxMenu.id)}><FaEdit size={10} color="#555"/><span>Rename</span></button>
          <button style={S.ctxItem} onClick={()=>{setActiveId(ctxMenu.id);setCtxMenu(null);}}><FaFile size={10} color="#555"/><span>Open</span></button>
          <div style={{height:1,background:"#1a1a1a",margin:"2px 0"}}/>
          <button style={{...S.ctxItem,color:"#f87171"}} onClick={()=>deleteFile(ctxMenu.id)}><FaTrash size={10} color="#f87171"/><span>Delete</span></button>
        </div>
      )}

      {/* COLLAB MODAL */}
      {collabModal && (
        <div style={S.overlay} onClick={() => setCollabModal(false)}>
          <div style={{...S.modal, width:460}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <FaUsers size={14} color="#22c55e"/>
                <span style={{fontSize:14,fontWeight:600,color:"#d4d4d4"}}>Collaborative Editing</span>
              </div>
              <button onClick={() => setCollabModal(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#555",display:"flex"}}><FaTimes size={12}/></button>
            </div>

            {collab.roomId ? (
              <div>
                <div style={{background:"#091509",border:"1px solid #14401a",borderRadius:8,padding:"14px 16px",marginBottom:16}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontSize:11,color:"#22c55e",fontWeight:600}}>● Session Active</span>
                    <span style={{fontSize:10,color:"#444"}}>{collab.collabUsers.length} user{collab.collabUsers.length!==1?"s":""} online</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{flex:1,background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:6,padding:"8px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:"#e5e5e5",letterSpacing:3,textAlign:"center",fontWeight:700}}>
                      {collab.roomId}
                    </div>
                    <button onClick={copyRoomId}
                      style={{background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:6,padding:"8px 12px",cursor:"pointer",color:collabCopied?"#22c55e":"#666",fontSize:11,fontFamily:"'Geist',sans-serif",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
                      <FaCopy size={10}/>{collabCopied?"Copied!":"Copy ID"}
                    </button>
                  </div>
                  <p style={{fontSize:10,color:"#444",marginTop:8,lineHeight:1.6}}>Share this room ID with your collaborator. Both editors sync in real-time.</p>
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:"#3a3a3a",fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>In This Room</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {collab.collabUsers.map(u => (
                      <div key={u.socketId} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 10px",background:"#111",borderRadius:6,border:`1px solid ${u.color}22`}}>
                        <div style={{width:26,height:26,borderRadius:6,border:`2px solid ${u.color}`,background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:u.color,overflow:"hidden",flexShrink:0}}>
                          {u.avatar?<img src={u.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:u.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:"#d4d4d4",fontWeight:500}}>{u.name}</div>
                          <div style={{fontSize:10,color:"#444"}}>{u.email}</div>
                        </div>
                        <div style={{width:6,height:6,borderRadius:"50%",background:u.color}}/>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => { collab.leaveRoom(); setCollabModal(false); }}
                  style={{width:"100%",height:38,border:"1px solid #3d1414",borderRadius:6,background:"#190a0a",color:"#f87171",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Geist',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <FaTimes size={10}/> Leave Session
                </button>
              </div>
            ) : (
              <div>
                <p style={{fontSize:12,color:"#555",lineHeight:1.7,marginBottom:20}}>
                  Start a session and share the room ID, or enter a friend's ID to join their session. Code, language, and cursors all sync live.
                </p>
                <div style={{background:"#080e08",border:"1px solid #142814",borderRadius:8,padding:"16px",marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#22c55e",marginBottom:6}}>Create a New Room</div>
                  <p style={{fontSize:11,color:"#444",lineHeight:1.6,marginBottom:12}}>You'll get a room ID to share. Your current file's code is the starting point.</p>
                  <button onClick={() => { createRoom(); setCollabModal(false); }}
                    disabled={collabStatus==="creating"}
                    style={{width:"100%",height:38,border:"none",borderRadius:6,background:"#22c55e",color:"#080808",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Geist',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6,opacity:collabStatus==="creating"?0.6:1}}>
                    {collabStatus==="creating"
                      ? <><div style={{width:12,height:12,border:"2px solid rgba(0,0,0,0.3)",borderTopColor:"#080808",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/> Creating…</>
                      : <><FaUsers size={11}/> Create Room</>}
                  </button>
                </div>
                <div style={{background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:8,padding:"16px"}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#888",marginBottom:6}}>Join an Existing Room</div>
                  <p style={{fontSize:11,color:"#444",lineHeight:1.6,marginBottom:10}}>Enter the room ID your collaborator shared with you.</p>
                  <div style={{display:"flex",gap:8}}>
                    <input value={joinInput} onChange={e=>setJoinInput(e.target.value.toUpperCase())}
                      onKeyDown={e=>e.key==="Enter"&&joinRoom()}
                      placeholder="e.g. A3F9C2B1" maxLength={8}
                      style={{flex:1,background:"#080808",border:"1px solid #1e1e1e",borderRadius:6,padding:"0 12px",height:38,color:"#d4d4d4",fontSize:13,fontFamily:"'JetBrains Mono',monospace",outline:"none",letterSpacing:2}}/>
                    <button onClick={joinRoom} disabled={!joinInput.trim()}
                      style={{height:38,padding:"0 16px",border:"none",borderRadius:6,background:"#e5e5e5",color:"#080808",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Geist',sans-serif",opacity:!joinInput.trim()?0.4:1}}>
                      Join
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#1f1f1f;border-radius:2px;}
        input::placeholder,textarea::placeholder{color:#252525;}
        input:focus,textarea:focus,button:focus{outline:none;}
        button:hover{opacity:0.8;}
        @keyframes fade{0%,100%{opacity:0.15}50%{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:0.35}50%{opacity:1}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes modalIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
      `}</style>
    </div>
  );
}

/* IDE styles */
const S = {
  root:{fontFamily:"'Geist',sans-serif",height:"100vh",background:"#0a0a0a",color:"#e5e5e5",display:"flex",flexDirection:"column",overflow:"hidden"},
  titlebar:{height:40,background:"#0f0f0f",borderBottom:"1px solid #181818",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",flexShrink:0,zIndex:20},
  tbLeft:{display:"flex",alignItems:"center",gap:14,minWidth:180},
  winDots:{display:"flex",gap:6},
  dot:{width:11,height:11,borderRadius:"50%",cursor:"pointer"},
  dot2:{width:5,height:5,borderRadius:"50%",background:"#666",flexShrink:0},
  brand:{display:"flex",alignItems:"center",gap:7},
  brandBox:{width:21,height:21,background:"#e5e5e5",borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center"},
  brandTxt:{fontSize:13,fontWeight:700,color:"#c4c4c4",letterSpacing:-0.3},
  tabs:{display:"flex",alignItems:"center",flex:1,justifyContent:"center",overflow:"hidden"},
  tab:{display:"flex",alignItems:"center",gap:5,padding:"0 12px",height:40,fontSize:11,color:"#484848",cursor:"pointer",border:"none",background:"transparent",borderBottom:"2px solid transparent",whiteSpace:"nowrap",flexShrink:0,fontFamily:"'Geist',sans-serif"},
  tabOn:{color:"#c4c4c4",borderBottomColor:"#c4c4c4",background:"#0a0a0a"},
  tabX:{background:"none",border:"none",color:"#444",padding:1,display:"flex",alignItems:"center",borderRadius:2,cursor:"pointer",marginLeft:2},
  tabNew:{background:"none",border:"none",color:"#333",padding:"0 8px",height:40,display:"flex",alignItems:"center",cursor:"pointer",flexShrink:0},
  tbRight:{display:"flex",alignItems:"center",gap:6,minWidth:180,justifyContent:"flex-end"},
  livePill:{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#22c55e",background:"#0a1a0a",border:"1px solid #142814",borderRadius:5,padding:"2px 8px",fontWeight:500},
  liveDot:{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"pulse 2s ease-in-out infinite"},
  ico:{background:"none",border:"none",color:"#484848",cursor:"pointer",padding:5,display:"flex",alignItems:"center",borderRadius:4},
  userBtn:{display:"flex",alignItems:"center",gap:7,background:"transparent",border:"1px solid #181818",borderRadius:7,padding:"4px 9px",cursor:"pointer"},
  userAv:{width:22,height:22,borderRadius:5,background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#666"},
  userTxt:{fontSize:12,fontWeight:500,color:"#666"},
  ddMenu:{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#0f0f0f",border:"1px solid #181818",borderRadius:10,width:230,boxShadow:"0 20px 60px rgba(0,0,0,0.8)",zIndex:200,overflow:"hidden",animation:"slideIn 0.12s ease"},
  ddTop:{display:"flex",alignItems:"center",gap:10,padding:"14px"},
  ddAv:{width:34,height:34,borderRadius:8,background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#555",flexShrink:0},
  ddDiv:{height:1,background:"#141414",margin:"2px 0"},
  ddItem:{display:"flex",alignItems:"center",gap:9,width:"100%",background:"transparent",border:"none",color:"#666",cursor:"pointer",padding:"9px 14px",fontSize:12,fontFamily:"'Geist',sans-serif",textAlign:"left"},
  body:{display:"flex",flex:1,overflow:"hidden"},
  actBar:{width:44,background:"#0f0f0f",borderRight:"1px solid #181818",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:4,flexShrink:0},
  actBtn:{width:44,height:44,background:"none",border:"none",color:"#303030",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"},
  actOn:{color:"#c4c4c4"},
  actBar2:{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",width:2,height:18,background:"#c4c4c4",borderRadius:"0 1px 1px 0"},
  sidebar:{width:224,background:"#0f0f0f",borderRight:"1px solid #181818",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"},
  sbHead:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px 8px",borderBottom:"1px solid #141414",flexShrink:0},
  sbTitle:{fontSize:9,fontWeight:700,color:"#3a3a3a",letterSpacing:1,textTransform:"uppercase"},
  sbBtn:{background:"none",border:"none",color:"#3a3a3a",cursor:"pointer",padding:3,display:"flex",alignItems:"center",borderRadius:3},
  treeSection:{display:"flex",alignItems:"center",gap:5,padding:"4px 14px",fontSize:9,color:"#2a2a2a",fontWeight:700,letterSpacing:0.8},
  treeRow:{display:"flex",alignItems:"center",padding:"4px 14px",cursor:"pointer",gap:0},
  treeRowOn:{background:"#141414"},
  sbAction:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,background:"#141414",border:"1px solid #1a1a1a",borderRadius:5,padding:"5px 0",fontSize:10,color:"#555",cursor:"pointer",fontFamily:"'Geist',sans-serif"},
  edCol:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  edBar:{height:36,background:"#0f0f0f",borderBottom:"1px solid #181818",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 10px",flexShrink:0},
  sep:{width:1,height:13,background:"#181818",margin:"0 3px"},
  meta:{fontSize:10,color:"#2a2a2a",fontFamily:"'JetBrains Mono',monospace"},
  langBtn:{background:"transparent",border:"1px solid transparent",cursor:"pointer",borderRadius:5,padding:"2px 8px",display:"flex",alignItems:"center",gap:4,fontFamily:"'Geist',sans-serif"},
  runBtn:{display:"flex",alignItems:"center",gap:6,border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Geist',sans-serif"},
  runGo:{background:"#e5e5e5",color:"#0a0a0a"},
  runStop:{background:"#1a0808",color:"#f87171",border:"1px solid #2a1010"},
  term:{background:"#080808",borderTop:"1px solid #181818",display:"flex",flexDirection:"column",flexShrink:0,transition:"height 0.2s ease"},
  termBar:{height:34,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 10px",borderBottom:"1px solid #111",flexShrink:0},
  timeBadge:{fontSize:10,color:"#22c55e",background:"#0a1a0a",border:"1px solid #142814",borderRadius:4,padding:"1px 7px",fontFamily:"'JetBrains Mono',monospace"},
  termBody:{flex:1,overflowY:"auto",padding:"10px 16px",fontFamily:"'JetBrains Mono',monospace",cursor:"text"},
  rightPanel:{width:194,background:"#0f0f0f",borderLeft:"1px solid #181818",display:"flex",flexDirection:"column",flexShrink:0,overflowY:"auto"},
  mpHead:{fontSize:9,fontWeight:700,color:"#2a2a2a",letterSpacing:1,textTransform:"uppercase",marginBottom:8},
  mpDiv:{height:1,background:"#141414"},
  statusBar:{height:22,background:"#0f0f0f",borderTop:"1px solid #141414",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",flexShrink:0},
  sb:{fontSize:10,color:"#2a2a2a"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300},
  modal:{background:"#0f0f0f",border:"1px solid #1e1e1e",borderRadius:12,padding:"24px",width:440,boxShadow:"0 24px 80px rgba(0,0,0,0.8)",animation:"modalIn 0.15s ease"},
  ctxMenu:{position:"fixed",background:"#111",border:"1px solid #1a1a1a",borderRadius:8,width:160,boxShadow:"0 12px 40px rgba(0,0,0,0.8)",zIndex:400,overflow:"hidden",animation:"slideIn 0.1s ease"},
  ctxItem:{display:"flex",alignItems:"center",gap:9,width:"100%",background:"transparent",border:"none",color:"#666",cursor:"pointer",padding:"8px 12px",fontSize:12,fontFamily:"'Geist',sans-serif",textAlign:"left"},
};

/* ─────────────────────────────────────────────────────────────────
   ROOT — router + auth gate
───────────────────────────────────────────────────────────────── */
function AppRouter() {
  const { user, loading } = useAuth();
  const { route, navigate } = useRoute();

  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#080808",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16 }}>
      <div style={{ width:36,height:36,border:"3px solid #1a1a1a",borderTopColor:"#aaa",borderRadius:"50%",animation:"spin 0.8s linear infinite" }}/>
      <span style={{ color:"#333",fontSize:12,fontFamily:"'Geist',sans-serif" }}>Loading CloudIDE…</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // Authenticated → show IDE regardless of route
  if (user) return <IDE/>;

  // Public routes
  if (route === "verify-email")   return <VerifyEmail   navigate={navigate}/>;
  if (route === "reset-password") return <ResetPassword navigate={navigate}/>;
  if (route === "signup")         return <SignUp         navigate={navigate}/>;
  if (route === "forgot")         return <ForgotPassword navigate={navigate}/>;
  return <SignIn navigate={navigate}/>;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter/>
    </AuthProvider>
  );
}
