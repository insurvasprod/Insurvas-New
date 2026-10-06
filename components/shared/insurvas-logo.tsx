import Image from "next/image";

type LogoVariant = "wordmark" | "symbol";
type LogoSize = "sidebar" | "auth" | "public" | "compact";
/** `dark` is for an ink or dark-mode background: the wordmark turns white and the isotype's sweep
 * stops at mid green instead of fading into the background. */
type LogoTone = "light" | "dark";

const SOURCE: Record<LogoVariant, Record<LogoTone, string>> = {
  wordmark: { light: "/brand/insurvas-logo.svg", dark: "/brand/insurvas-logo-on-dark.svg" },
  symbol: { light: "/brand/insurvas-isotype.svg", dark: "/brand/insurvas-isotype-on-dark.svg" },
};

/**
 * The single Insurvas brand mark used by the public, agent, partner, and staff shells.
 *
 * The files in public/brand are cut from the designer's master (`insurvas-logo-source.svg`, the
 * "Data Highway" isotype and the wordmark) by viewBox only, so the paths and proportions stay
 * exactly as delivered. `tone` picks the variant for the background the mark sits on; with no
 * tone it follows the theme, which is right everywhere except a surface that is always dark (the
 * ink sidebar rail).
 */
export function InsurvasLogo({
  size = "sidebar",
  variant = "wordmark",
  tone,
  alt = "",
  className = "",
}: {
  size?: LogoSize;
  variant?: LogoVariant;
  tone?: LogoTone;
  alt?: string;
  className?: string;
}) {
  const decorative = !alt;
  const sizeClass = `insurvas-logo-${size}`;
  const variantClass = `insurvas-logo-${variant}`;
  // The theme-following pair renders both files and CSS shows one; only the light copy carries the
  // alt text, so a screen reader never hears the name twice.
  const image = (which: LogoTone, extra = "", label = alt) => (
    <Image
      src={SOURCE[variant][which]}
      alt={label}
      fill
      unoptimized
      priority={size === "auth" || size === "public"}
      className={`insurvas-logo-image ${extra}`.trim()}
    />
  );

  return (
    <span
      className={`insurvas-logo ${variantClass} ${sizeClass} ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
    >
      {tone ? image(tone) : (
        <>
          {image("light", "insurvas-logo-theme-light")}
          {image("dark", "insurvas-logo-theme-dark", "")}
        </>
      )}
    </span>
  );
}
