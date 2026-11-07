// Runs before the page paints, so the chosen theme never flashes the other one first.
// With no stored choice the site follows the operating system, live; a stored "light" or "dark" is the viewer's pick
// (theme-toggle.tsx stores one only while it differs from the operating system).
const script = `(() => {
  try {
    const stored = localStorage.getItem("theme");
    const choice = stored === "light" || stored === "dark" ? stored : "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = choice === "dark" || (choice === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = choice;
    };
    apply();
    if (choice === "system") media.addEventListener("change", apply);
  } catch (e) {}
})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
