export default function Icon({ name, size = 20, color, style }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, ...style }}
    >
      {name}
    </span>
  );
}
