import "./admin-plane.css";

/**
 * The admin plane's outermost wrapper: the signed-in console and the sign-in screen both render
 * through here. `.admin-plane` is only a marker for admin-plane.css, which since 2026-10-13 holds no
 * overrides — the console uses the app's colours — and `contents` keeps the wrapper out of layout, so
 * neither layout beneath it changes.
 */
export default function AdminPlaneLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-plane contents">{children}</div>;
}
