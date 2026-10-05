import Image from "next/image";

type LogoVariant = "wordmark" | "symbol";
type LogoSize = "sidebar" | "auth" | "public" | "compact";

const SOURCE_BY_VARIANT: Record<LogoVariant, string> = {
  wordmark: "/insurvas-logo-orange.png",
  symbol: "/insurvas-symbol-orange.png",
};

/**
 * The single Insurvas brand mark used by the public, agent, partner, and staff shells.
 * The source files are tightly cropped transparent assets so the mark stays optically balanced
 * when it moves between a rail, an auth header, and the compact collapsed-rail state.
 */
export function InsurvasLogo({
  size = "sidebar",
  variant = "wordmark",
  alt = "",
  className = "",
}: {
  size?: LogoSize;
  variant?: LogoVariant;
  alt?: string;
  className?: string;
}) {
  const decorative = !alt;
  const sizeClass = `insurvas-logo-${size}`;
  const variantClass = `insurvas-logo-${variant}`;

  return (
    <span
      className={`insurvas-logo ${variantClass} ${sizeClass} ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
    >
      <Image
        src={SOURCE_BY_VARIANT[variant]}
        alt={alt}
        fill
        priority={size === "auth" || size === "public"}
        sizes={variant === "symbol" ? "32px" : "160px"}
        className="insurvas-logo-image"
      />
    </span>
  );
}
