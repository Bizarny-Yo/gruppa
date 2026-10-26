import { useState } from "react";
import { get, post } from "../api.js";
import { Icon } from "../ui.jsx";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ code: "", name: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(mode === "login" ? "/auth/login" : "/auth/register", form);
      const me = await get("/me");
      onAuth(me);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    setError("");
    try {
      await post("/auth/login", { code: "PMI21", name: "Артём Соколов", password: "demo1234" });
      onAuth(await get("/me"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-logo">
        <div className="mark">Г</div>
        <div>
          <h1>Группа</h1>
          <p className="sub">Расписание, посещаемость и «кто идёт» — в одном месте</p>
        </div>
      </div>

      <div className="segmented">
        <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
          Вход
        </button>
        <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
          Регистрация
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="code">Код группы</label>
          <input id="code" value={form.code} onChange={set("code")} placeholder="PMI21" autoCapitalize="characters" required />
          <span className="hint">Код выдаёт староста</span>
        </div>

        <div className="field">
          <label htmlFor="name">Имя и фамилия</label>
          <input id="name" value={form.name} onChange={set("name")} placeholder="Артём Соколов" autoComplete="name" required />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={set("password")}
            placeholder={mode === "register" ? "минимум 4 символа" : "••••••"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </div>

        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
      </form>

      <div className="card" style={{ background: "var(--bg-2)" }}>
        <div className="row between">
          <div>
            <strong style={{ fontSize: 13.5 }}>Посмотреть демо</strong>
            <div className="tiny muted">Группа ПМИ-21, 12 студентов, расписание</div>
          </div>
          <button type="button" className="btn sm" onClick={demo} disabled={busy}>
            <Icon name="spark" size={15} /> Открыть
          </button>
        </div>
      </div>
    </div>
  );
}
