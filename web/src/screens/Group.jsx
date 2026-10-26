import { useState } from "react";
import { get, post } from "../api.js";
import { useFetch, Icon, Avatar, Sheet, Spinner, ErrorBox } from "../ui.jsx";
import PushToggle from "../PushToggle.jsx";
import { WEEKDAYS_SHORT } from "../dates.js";

export default function Group({ me, onLogout, notify }) {
  const members = useFetch(() => get("/members"), []);
  const subjects = useFetch(() => get("/subjects"), []);
  const [sheet, setSheet] = useState(null); // "slot" | "subject"
  const isAdmin = me.user.role === "starosta";

  async function logout() {
    await post("/auth/logout", {}).catch(() => {});
    onLogout();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(me.group.code);
      notify("Код скопирован");
    } catch {
      notify("Не получилось скопировать", "err");
    }
  }

  return (
    <>
      <section className="card">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={me.user.name} color={me.user.color} size={52} ring />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>{me.user.name}</h1>
            <div className="tiny muted">{isAdmin ? "староста группы" : "студент"} · {me.group.name}</div>
          </div>
        </div>

        <div className="row between mt-lg wrap" style={{ gap: 10 }}>
          <div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>Код для вступления</div>
            <button type="button" className="code-pill" onClick={copyCode} title="Скопировать">
              {me.group.code} <Icon name="plus" size={13} style={{ transform: "rotate(45deg)", opacity: 0.6 }} />
            </button>
          </div>
          <button type="button" className="btn sm ghost" onClick={logout}>
            <Icon name="logout" size={15} /> Выйти
          </button>
        </div>
      </section>

      <div className="section">
        <PushToggle notify={notify} />
      </div>

      {isAdmin && (
        <div className="section">
          <div className="section-head">
            <h2>Управление</h2>
            <span className="tiny muted">только староста</span>
          </div>          <div className="grid-2">
            <button type="button" className="btn" onClick={() => setSheet("slot")}>
              <Icon name="plus" size={16} /> Пара
            </button>
            <button type="button" className="btn" onClick={() => setSheet("subject")}>
              <Icon name="book" size={16} /> Предмет
            </button>
            <a className="btn" href="/api/export/attendance.csv" download>
              <Icon name="download" size={16} /> Excel/CSV
            </a>
            <button type="button" className="btn ghost" onClick={() => notify("Скоро: перенос пары в один тап")}>
              <Icon name="spark" size={16} /> Ещё
            </button>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h2>Состав группы</h2>
          <span className="tiny muted">{(members.data ?? []).length} чел.</span>
        </div>
        {members.loading && !members.data ? (
          <Spinner text="Загружаем" />
        ) : members.error ? (
          <ErrorBox message={members.error} onRetry={members.reload} />
        ) : (
          <div className="card" style={{ padding: "4px 14px" }}>
            {(members.data ?? []).map((u) => (
              <div key={u.id} className="person">
                <Avatar name={u.name} color={u.color} size={32} />
                <div className="who-name">
                  <strong>{u.name}</strong>
                  <span>{u.role === "starosta" ? "староста" : "студент"}</span>
                </div>
                {u.id === me.user.id && <span className="status-pill going">это вы</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={sheet === "slot"} onClose={() => setSheet(null)} title="Добавить пару">
        <SlotForm
          subjects={subjects.data ?? []}
          onDone={() => {
            setSheet(null);
            notify("Пара добавлена");
          }}
          notify={notify}
        />
      </Sheet>

      <Sheet open={sheet === "subject"} onClose={() => setSheet(null)} title="Новый предмет">
        <SubjectForm
          onDone={() => {
            setSheet(null);
            subjects.reload();
            notify("Предмет добавлен");
          }}
          notify={notify}
        />
      </Sheet>
    </>
  );
}

function SlotForm({ subjects, onDone, notify }) {
  const [form, setForm] = useState({ subjectId: "", weekday: 1, pair: 1, room: "", parity: "all" });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/slots", form);
      onDone();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Предмет</label>
        <select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} required>
          <option value="">Выбери предмет</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>День</label>
          <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
            {WEEKDAYS_SHORT.map((d, i) => (
              <option key={d} value={i + 1}>{d}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Пара</label>
          <select value={form.pair} onChange={(e) => setForm({ ...form, pair: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}-я</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Аудитория</label>
          <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="402" />
        </div>
        <div className="field">
          <label>Неделя</label>
          <select value={form.parity} onChange={(e) => setForm({ ...form, parity: e.target.value })}>
            <option value="all">каждую</option>
            <option value="odd">числитель</option>
            <option value="even">знаменатель</option>
          </select>
        </div>
      </div>

      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? "Добавляем…" : "Добавить"}
      </button>
    </form>
  );
}

function SubjectForm({ onDone, notify }) {
  const [form, setForm] = useState({ name: "", teacher: "", color: "#6c8cff" });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/subjects", form);
      onDone();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Название</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Базы данных" required />
      </div>
      <div className="field">
        <label>Преподаватель</label>
        <input value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })} placeholder="доц. Лаврова Е. С." />
      </div>
      <div className="field">
        <label>Цвет</label>
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ height: 44, padding: 4 }} />
      </div>
      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? "Добавляем…" : "Добавить"}
      </button>
    </form>
  );
}
