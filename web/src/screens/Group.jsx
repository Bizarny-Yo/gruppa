import { useEffect, useState } from "react";
import { get, post, patch, del } from "../api.js";
import { useFetch, Icon, Avatar, Sheet, Spinner, ErrorBox } from "../ui.jsx";
import PushToggle from "../PushToggle.jsx";
import { WEEKDAYS_SHORT } from "../dates.js";

const ACTION_LABEL = {
  "homework.add": "добавил ДЗ",
  "homework.approve": "одобрил ДЗ",
  "homework.reject": "отклонил ДЗ",
  "file.add": "загрузил файл",
  "file.approve": "одобрил файл",
  "file.reject": "отклонил файл",
  "announcement.add": "создал объявление",
  "announcement.delete": "удалил объявление",
  "deadline.add": "добавил дедлайн",
  "deadline.delete": "удалил дедлайн",
  "member.remove": "исключил из группы",
  "group.code": "сменил код группы",
  "attendance.day": "отметил день",
  "profile.name": "сменил имя",
};

const fmtTime = (iso) =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Group({ me, onLogout, onRefresh, notify }) {
  const members = useFetch(() => get("/members"), []);
  const subjects = useFetch(() => get("/subjects"), []);
  const subgroups = useFetch(() => get("/subgroups"), []);
  const bans = useFetch(() => get("/bans"), []);
  const moderation = useFetch(() => (me.user.role === "starosta" ? get("/moderation") : Promise.resolve(null)), []);
  const audit = useFetch(() => (me.user.role === "starosta" ? get("/audit") : Promise.resolve(null)), []);
  const [sheet, setSheet] = useState(null); // "slot" | "subject"
  const [nameSheet, setNameSheet] = useState(false);
  const [nameValue, setNameValue] = useState(me.user.name);
  const [savingName, setSavingName] = useState(false);
  const [selectedSubgroup, setSelectedSubgroup] = useState(me.user.subgroup ?? null);
  const [removing, setRemoving] = useState(null);
  const [codeSheet, setCodeSheet] = useState(false);
  const [codeValue, setCodeValue] = useState(me.group.code);
  const [savingCode, setSavingCode] = useState(false);

  async function saveCode(e) {
    e.preventDefault();
    setSavingCode(true);
    try {
      const r = await patch("/group", { code: codeValue.trim() });
      setCodeSheet(false);
      notify(`Новый код: ${r.code}`);
      onRefresh?.();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setSavingCode(false);
    }
  }

  function randomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    setCodeValue(out);
  }
  const isAdmin = me.user.role === "starosta";

  useEffect(() => {
    setSelectedSubgroup(me.user.subgroup ?? null);
  }, [me.user.subgroup]);

  const subgroupList = subgroups.data?.length
    ? subgroups.data
    : [
        { code: "А", label: "А" },
        { code: "Б", label: "Б" },
      ];
  const currentSubgroup = subgroupList.find((g) => g.code === selectedSubgroup) ?? null;

  const pending = moderation.data ?? { homework: [], files: [] };
  const pendingCount = (pending.homework?.length ?? 0) + (pending.files?.length ?? 0);

  async function saveName(e) {
    e.preventDefault();
    setSavingName(true);
    try {
      await patch("/me", { name: nameValue.trim() });
      setNameSheet(false);
      notify("Имя обновлено");
      onRefresh?.();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setSavingName(false);
    }
  }

  async function removeMember() {
    if (!removing) return;
    try {
      await del(`/members/${removing.id}`);
      notify(`${removing.name} исключён и заблокирован`);
      setRemoving(null);
      members.reload();
      bans.reload();
      onRefresh?.();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function moderate(type, id, decision) {
    try {
      await post(`/moderation/${type}/${id}`, { decision });
      moderation.reload();
      audit.reload();
      notify(decision === "approve" ? "Одобрено" : "Отклонено");
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function unban(id, name) {
    try {
      await del(`/bans/${id}`);
      bans.reload();
      notify(`${name} разблокирован`);
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function logout() {
    await post("/auth/logout", {}).catch(() => {});
    onLogout();
  }

  async function chooseSubgroup(value) {
    const prev = selectedSubgroup;
    setSelectedSubgroup(value); // мгновенно подсвечиваем, не ждём сервер
    try {
      await post("/me/subgroup", { subgroup: value });
      notify(`Подгруппа: ${value}`);
      onRefresh?.();
    } catch (err) {
      setSelectedSubgroup(prev);
      notify(err.message, "err");
    }
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
            <div className="tiny muted">
              {isAdmin ? "староста" : "студент"} · группа {me.group.name}
            </div>
            {me.group.program && (
              <div className="tiny muted">
                {me.group.program}
                {me.group.profile ? ` · ${me.group.profile}` : ""}
              </div>
            )}
            <button
              type="button"
              className="link"
              style={{ fontSize: 12, marginTop: 6 }}
              onClick={() => {
                setNameValue(me.user.name);
                setNameSheet(true);
              }}
            >
              Изменить имя
            </button>
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

      <div className="section">
        <section className="card">
          <div className="row between">
            <div>
              <strong style={{ fontSize: 14 }}>Подгруппа</strong>
              <div className="tiny muted">
                {currentSubgroup
                  ? `Сейчас: ${currentSubgroup.label}${currentSubgroup.teacher ? ` · ${currentSubgroup.teacher}` : ""}`
                  : "Выбери свою — уберём лишние пары из расписания"}
              </div>
            </div>
          </div>
          <div className="segmented" style={{ marginTop: 12, marginBottom: 0 }}>
            {subgroupList.map((g) => (
              <button
                key={g.code}
                type="button"
                className={selectedSubgroup === g.code ? "on" : ""}
                onClick={() => chooseSubgroup(g.code)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </section>
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
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCodeValue(me.group.code);
                setCodeSheet(true);
              }}
            >
              <Icon name="settings" size={16} /> Код
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
                {isAdmin && u.id !== me.user.id && u.role !== "starosta" && (
                  <button type="button" className="icon-btn" onClick={() => setRemoving(u)} aria-label={`Удалить ${u.name}`} title="Удалить из группы">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="section">
          <div className="section-head">
            <h2>Чёрный список</h2>
            <span className="tiny muted">{(bans.data ?? []).length || "пусто"}</span>
          </div>

          {(bans.data ?? []).length === 0 ? (
            <div className="tiny muted" style={{ padding: "2px 2px 6px" }}>
              Сюда попадают исключённые — зайти снова они не смогут, пока ты не разбанишь
            </div>
          ) : (
            <div className="card" style={{ padding: "4px 14px" }}>
              {(bans.data ?? []).map((b) => (
                <div key={b.id} className="person">
                  <span
                    className="file-icon"
                    style={{
                      background: "rgb(255 107 107 / 10%)",
                      borderColor: "rgb(255 107 107 / 25%)",
                      color: "var(--bad)",
                    }}
                  >
                    <Icon name="x" size={15} />
                  </span>

                  <div className="who-name">
                    <strong>{b.name}</strong>
                    <span>
                      исключён{" "}
                      {new Date(b.created_at).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>

                  <button type="button" className="btn sm ghost" onClick={() => unban(b.id, b.name)}>
                    разбанить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="section">
          <div className="section-head">
            <h2>На модерации</h2>
            <span className="tiny muted">{pendingCount || "пусто"}</span>
          </div>

          {pendingCount === 0 ? (
            <div className="tiny muted" style={{ padding: "2px 2px 6px" }}>
              Всё, что добавляют студенты — ДЗ и файлы — сначала попадает сюда
            </div>
          ) : (
            <div className="card" style={{ padding: "6px 14px" }}>
              {pending.homework.map((h) => (
                <div key={`h${h.id}`} className="person">
                  <span className="file-icon">
                    <Icon name="book" size={15} />
                  </span>
                  <div className="who-name">
                    <strong>{h.title}</strong>
                    <span>
                      ДЗ · {h.author_name ?? "—"}
                      {h.subject ? ` · ${h.subject}` : ""}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn sm" onClick={() => moderate("homework", h.id, "approve")}>
                      одобрить
                    </button>
                    <button type="button" className="icon-btn" onClick={() => moderate("homework", h.id, "reject")} aria-label="Отклонить">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {pending.files.map((f) => (
                <div key={`f${f.id}`} className="person">
                  <span className="file-icon">
                    <Icon name="folder" size={15} />
                  </span>
                  <div className="who-name">
                    <strong>{f.name}</strong>
                    <span>
                      файл · {f.uploader_name ?? "—"}
                      {f.subject ? ` · ${f.subject}` : ""}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn sm" onClick={() => moderate("files", f.id, "approve")}>
                      одобрить
                    </button>
                    <button type="button" className="icon-btn" onClick={() => moderate("files", f.id, "reject")} aria-label="Отклонить">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="section">
          <div className="section-head">
            <h2>Журнал изменений</h2>
            <span className="tiny muted">{(audit.data ?? []).length} записей</span>
          </div>

          {(audit.data ?? []).length === 0 ? (
            <div className="tiny muted" style={{ padding: "2px 2px 6px" }}>
              Здесь появятся действия: кто что добавил, изменил или удалил
            </div>
          ) : (
            <div className="card" style={{ padding: "4px 14px" }}>
              {(audit.data ?? []).slice(0, 15).map((a) => (
                <div key={a.id} className="person">
                  <div className="who-name">
                    <strong>{a.actor_name}</strong>
                    <span>
                      {ACTION_LABEL[a.action] ?? a.action}
                      {a.target ? `: ${a.target}` : ""}
                      {a.detail ? ` · ${a.detail}` : ""}
                    </span>
                  </div>
                  <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
                    {fmtTime(a.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Sheet open={Boolean(removing)} onClose={() => setRemoving(null)} title="Исключить из группы">
        {removing && (
          <>
            <p style={{ marginTop: 0, fontSize: 14 }}>
              <strong>{removing.name}</strong> выйдет из группы и попадёт в <strong>чёрный список</strong>:
              зарегистрироваться заново с этим именем он не сможет.
            </p>
            <p className="tiny muted">
              Вместе с ним удалятся его отметки и подписка на уведомления. Снять блокировку можно
              в разделе «Чёрный список» ниже.
            </p>
            <div className="row" style={{ gap: 10, marginTop: 8 }}>
              <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => setRemoving(null)}>
                Отмена
              </button>
              <button type="button" className="btn danger" style={{ flex: 1 }} onClick={removeMember}>
                Исключить
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={codeSheet} onClose={() => setCodeSheet(false)} title="Код группы">
        <form onSubmit={saveCode}>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Кто знает код — может вступить в группу и видеть состав. Если код совпадает с номером
            группы, его знает любой в вузе. Смени на случайный.
          </p>

          <div className="field">
            <label htmlFor="groupcode">Код для вступления</label>
            <input
              id="groupcode"
              value={codeValue}
              onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
              maxLength={20}
              required
            />
            <span className="hint">3–20 символов: буквы, цифры, дефис</span>
          </div>

          <button type="button" className="btn ghost block" onClick={randomCode} style={{ marginBottom: 10 }}>
            <Icon name="spark" size={15} /> Сгенерировать случайный
          </button>

          <button type="submit" className="btn primary block" disabled={savingCode}>
            {savingCode ? "Сохраняем…" : "Сохранить код"}
          </button>

          <p className="tiny" style={{ color: "var(--warn)", marginBottom: 0, marginTop: 12 }}>
            Код нужен при каждом входе. Сообщи новый код группе — иначе они не смогут зайти снова.
            У тех, кто уже вошёл, сессия не слетит.
          </p>
        </form>
      </Sheet>

      <Sheet open={nameSheet} onClose={() => setNameSheet(false)} title="Изменить имя">
        <form onSubmit={saveName}>
          <div className="field">
            <label htmlFor="username">Имя и фамилия</label>
            <input
              id="username"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              minLength={2}
              maxLength={60}
              required
            />
            <span className="hint">Так тебя увидят в списке группы и в отметках</span>
          </div>
          <button type="submit" className="btn primary block" disabled={savingName}>
            {savingName ? "Сохраняем…" : "Сохранить"}
          </button>
        </form>
      </Sheet>

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
