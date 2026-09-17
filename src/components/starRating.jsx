export default function StarRating({ count = 0, interactive = false, onChange, size = 18, color = '#CBFF00' }) {
  const active = Number(count) > 0;

  return (
    <button
      type="button"
      aria-label={active ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      aria-pressed={active}
      disabled={!interactive}
      onClick={interactive ? (event) => {
        event.stopPropagation();
        onChange?.(active ? 0 : 1);
      } : undefined}
      style={{
        display: 'inline-flex', padding: 0,
        background: 'none', border: 'none',
        color: active ? color : '#3b3b3b',
        fontSize: size, lineHeight: 1,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'color .15s, transform .15s',
      }}
    >★</button>
  );
}
