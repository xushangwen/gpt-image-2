interface Props {
  size?: number;
}

export default function Spinner({ size = 14 }: Props) {
  return (
    <i
      className="ri-loader-4-line"
      style={{ fontSize: size, lineHeight: 1, animation: "spin 1s linear infinite", display: "inline-block" }}
    />
  );
}
