import { Icon } from "./ui.jsx";
import { STATUS } from "./api.js";

const PARITY_LABEL = { odd: "числитель", even: "знаменатель" };

export default function LessonCard({ lesson, onOpen, showParity = false }) {
  const st = lesson.myStatus ? STATUS[lesson.myStatus] : null;
  const coming = lesson.counts.going + lesson.counts.late;
  const total = lesson.studentsTotal || 0;

  return (
    <article
      className={`lesson ${lesson.status} tappable`}
      style={{ "--subj-color": lesson.subject.color }}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen?.()}
      role="button"
      tabIndex={0}
    >
      <div className="lesson-top">
        <div className="lesson-time">
          <strong>{lesson.start}</strong>
          <span>{lesson.end}</span>
        </div>

        <div className="lesson-main">
          <span className="pair-index">
            {lesson.pair} пара{lesson.subgroup ? ` · гр. ${lesson.subgroup}` : ""}
            {showParity && lesson.parity !== "all" ? ` · ${PARITY_LABEL[lesson.parity]}` : ""}
          </span>
          <strong>{lesson.subject.name}</strong>
          <div className="lesson-meta">
            {lesson.room && (
              <span>
                <Icon name="door" size={13} /> {lesson.room}
              </span>
            )}
            {lesson.teacher && (
              <span>
                <Icon name="user" size={13} /> {lesson.teacher}
              </span>
            )}
          </div>
        </div>

        {st && <span className={`status-pill ${lesson.myStatus}`}>{st.emoji} {st.short}</span>}
      </div>

      <div className="who">
        <span className={`status-pill ${lesson.status === "past" ? "" : "going"}`} style={lesson.status === "past" ? { background: "var(--card-2)", color: "var(--muted)", borderColor: "var(--line)" } : undefined}>
          {lesson.status === "past" ? "прошла" : lesson.status === "now" ? "идёт" : "скоро"}
        </span>
        <span>
          <strong>{coming}</strong> идут · отмечено {lesson.marked} из {total}
        </span>
      </div>
    </article>
  );
}
