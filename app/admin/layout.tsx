import "./admin-plane.css";

/**
 * The admin plane's outermost wrapper: the signed-in console and the sign-in screen both render
 * through here, so both get the admin accent (decision 1). `.admin-plane` is only a marker —
 * admin-plane.css re-points the design tokens on :root while it is on the page — and `contents`
 * keeps the wrapper out of layout, so neither layout beneath it changes.
 */
export default function AdminPlaneLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-plane contents">{children}</div>;
}
