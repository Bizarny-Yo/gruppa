import { useState } from "react";
import { get, post } from "../api.js";
import { Icon } from "../ui.jsx";

const MODES = [
  ["login", "Вход"],
  ["register", "Регистрация"],
  ["create", "Новая группа"],
];

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ code: "", name: "", password: "", groupName: "", program: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "create") {
        await post("/groups", {
          groupName: form.groupName,
          code: form.code,
          name: form.name,
          password: form.password,
          program: form.program || null,
        });
      } else {
        await post(mode === "login" ? "/auth/login" : "/auth/register", {
          code: form.code,
          name: form.name,
          password: form.password,
        });
      }
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
        {MODES.map(([id, label]) => (
          <button key={id} type="button" className={mode === id ? "on" : ""} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        {mode === "create" && (
          <>
            <div className="field">
              <label htmlFor="groupName">Название группы</label>
              <input id="groupName" value={form.groupName} onChange={set("groupName")} placeholder="05-605" required />
            </div>
            <div className="field">
              <label htmlFor="program">Направление и профиль</label>
              <input
                id="program"
                value={form.program}
                onChange={set("program")}
                placeholder="Математика и компьютерные науки · Наука о данных"
              />
              <span className="hint">Можно оставить пустым</span>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="code">Код группы</label>
          <input
            id="code"
            value={form.code}
            onChange={set("code")}
            placeholder="05-605"
            autoCapitalize="characters"
            required
          />
          <span className="hint">
            {mode === "create" ? "По нему студенты будут вступать" : "Код выдаёт староста"}
          </span>
        </div>

        <div className="field">
          <label htmlFor="name">Имя и фамилия</label>
          <input id="name" value={form.name} onChange={set("name")} placeholder="Альберт Валиуллин" autoComplete="name" required />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={set("password")}
            placeholder={mode === "login" ? "••••••••" : "минимум 8 символов"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "login" ? undefined : 8}
            required
          />
        </div>

        <button type="submit" className="btn primary block" disabled={busy}>
          {busy
            ? "Подождите…"
            : mode === "login"
              ? "Войти"
              : mode === "register"
                ? "Создать аккаунт"
                : "Создать группу"}
        </button>
      </form>

      <div className="card" style={{ background: "var(--bg-2)" }}>
        <div className="row between">
          <div>
            <strong style={{ fontSize: 13.5 }}>
              {mode === "create" ? "Староста другой группы?" : "Первый раз здесь?"}
            </strong>
            <div className="tiny muted">
              {mode === "create"
                ? "Ты станешь старостой новой группы"
                : "Код группы спроси у старосты — 05-605"}
            </div>
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => setMode(mode === "create" ? "login" : "create")}
            disabled={busy}
          >
            <Icon name="spark" size={15} /> {mode === "create" ? "Вход" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
