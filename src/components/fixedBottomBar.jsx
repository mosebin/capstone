import Button from './button';

export default function FixedBottomBar({ loading, onNext }) {
  return (
    <div style={{
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 80,
      textAlign: 'center',
      padding: '18px 0 24px',
      background: 'linear-gradient(180deg, rgba(17,17,17,0) 0%, rgba(17,17,17,0.82) 28%, rgba(17,17,17,0.96) 100%)',
      pointerEvents: 'none',
    }}>
      <Button onClick={onNext} disabled={loading}>
        다음으로
      </Button>
    </div>
  );
}
