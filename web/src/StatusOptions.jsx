const OPTIONS = [
  ["going", "✅", "Иду"],
  ["late", "⏰", "Опоздаю"],
  ["absent", "🚫", "Не иду"],
  ["sick", "🤒", "Уваж."],
];

export default function StatusOptions({ value, onChange, disabled = false }) {
  return (
    <div className="quick">
      {OPTIONS.map(([key, emoji, label]) => (
        <button
          key={key}
          type="button"
          className={`option ${key}${value === key ? " on" : ""}`}
          onClick={() => onChange(key)}
          disabled={disabled}
          aria-pressed={value === key}
        >
          <span className="emoji">{emoji}</span>
          {label}
        </button>
      ))}
    </div>
  );
}
