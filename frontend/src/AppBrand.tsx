type Props = {
  onClick?: () => void;
};

export default function AppBrand({ onClick }: Props) {
  const inner = (
    <>
      <span className="app-brand-name">Cine</span>
      <span className="app-brand-ai">AI</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="app-brand" onClick={onClick} title="Home">
        {inner}
      </button>
    );
  }

  return <div className="app-brand app-brand-static">{inner}</div>;
}